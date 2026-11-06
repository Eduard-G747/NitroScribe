import { create } from 'zustand'
import type { AppInfo, CalendarSnapshot } from '@shared/api'
import { shiftWeek, weekOf } from '@shared/insights'
import { isLocalUrl } from '@shared/net'
import { providerPreset } from '@shared/providers'
import type {
  ActionItem,
  AiStreamEvent,
  AppCommand,
  CalendarEvent,
  ChatMessage,
  ImportPreview,
  ImportRequest,
  Meeting,
  MeetingPatch,
  MeetingSummary,
  RecordingState,
  SettingsPatch,
  SettingsView,
  ThemePreference,
  UpdateInfo,
  WhisperStatus
} from '@shared/types'
import { MEDIA_FILE, decodeRecording } from './audio'
import { enhancedToEditorHtml } from './markdown'

/** A decoded recording waiting for the user to confirm its details. */
export interface AudioPreview {
  kind: 'audio'
  fileName: string
  durationMs: number
  pcm: Int16Array
  title: string
  date?: string
}
import { Recorder, type Levels } from './recorder'

const api = window.api

export type Route =
  | { name: 'home' }
  | { name: 'notes' }
  | { name: 'actions' }
  | { name: 'people' }
  | { name: 'person'; key: string }
  | { name: 'digest'; week: string }
  | { name: 'meeting'; id: string }
export type SettingsTab = 'general' | 'transcription' | 'ai' | 'templates' | 'calendar' | 'data'
export type Panel = 'transcript' | 'chat' | null

export interface ToastItem {
  id: number
  kind: 'error' | 'info' | 'success'
  message: string
}

export interface EnhanceState {
  meetingId: string
  requestId: string
  text: string
}

interface Store {
  booted: boolean
  view: SettingsView | null
  info: AppInfo | null
  meetings: MeetingSummary[]
  route: Route
  current: Meeting | null
  notesMode: 'mine' | 'ai'
  recording: RecordingState
  levels: Levels
  systemAudio: boolean
  whisper: WhisperStatus | null
  calendar: CalendarSnapshot
  panel: Panel
  globalChatOpen: boolean
  globalChat: ChatMessage[]
  settingsOpen: boolean
  settingsTab: SettingsTab
  toasts: ToastItem[]
  enhancing: EnhanceState | null
  pendingAsk: { question: string; scope: 'meeting' | 'global'; nonce: number } | null
  searchOpen: boolean
  sidebarCollapsed: boolean
  identifying: boolean
  /** Import dialog: closed, picking a file, or reviewing a parsed transcript / decoded recording. */
  importing: null | 'choose' | ImportPreview | AudioPreview
  /** Decoding a dropped recording. */
  decoding: boolean
  /** Uploaded recordings being transcribed, by meeting id. */
  audioJobs: Record<string, { progress: number; summarize: boolean; templateId: string }>
  /** A newer NitroScribe release, if one is out. */
  update: UpdateInfo | null
  startAudioImport(preview: AudioPreview, opts: { title: string; startedAt: string; summarize: boolean; templateId: string }): Promise<void>
  cancelAudioImport(meetingId: string): void

  boot(): Promise<void>
  openImport(preview?: ImportPreview): void
  closeImport(): void
  importDroppedFile(file: File): Promise<void>
  finishImport(req: ImportRequest, opts: { summarize: boolean; templateId: string }): Promise<void>
  goNotes(): Promise<void>
  goActions(): Promise<void>
  /** Opens a page that isn't a meeting (people, a person, a weekly digest). */
  go(route: Exclude<Route, { name: 'meeting' }>): Promise<void>
  /** A transcript line to scroll to once the meeting is open. */
  jumpTo: { meetingId: string; segmentId: string } | null
  openMeetingAt(id: string, segmentId: string): Promise<void>
  /** Meeting whose follow-up email dialog is open. */
  followUpFor: string | null
  setFollowUp(meetingId: string | null): void
  /** Progress while action items are extracted from several meetings. */
  scanning: { done: number; total: number } | null
  findActionItems(meetingIds: string[]): Promise<void>
  /** Edits an action item (null deletes it). */
  updateActionItem(meetingId: string, itemId: string, patch: Partial<ActionItem> | null): void
  setSearchOpen(open: boolean): void
  toggleSidebar(): void
  setTheme(theme: ThemePreference): void
  renameSpeaker(speakerId: string, name: string, remember: boolean): Promise<void>
  identifySpeakers(): Promise<void>
  ask(question: string, scope: 'meeting' | 'global'): void
  consumeAsk(): void
  goHome(): Promise<void>
  openMeeting(id: string): Promise<void>
  newMeeting(opts?: { record?: boolean; event?: CalendarEvent }): Promise<void>
  patchCurrent(patch: MeetingPatch): void
  flushPending(): Promise<void>
  startRecording(meetingId?: string): Promise<void>
  stopRecording(): Promise<void>
  enhance(opts?: { templateId?: string; meetingId?: string }): Promise<void>
  cancelEnhance(): void
  deleteMeeting(id: string): Promise<void>
  setNotesMode(mode: 'mine' | 'ai'): void
  setPanel(panel: Panel): void
  setGlobalChat(open: boolean): void
  setGlobalMessages(messages: ChatMessage[]): void
  openSettings(tab?: SettingsTab): void
  closeSettings(): void
  updateSettings(patch: SettingsPatch): Promise<void>
  toast(kind: ToastItem['kind'], message: string): void
  dismissToast(id: number): void
}

// --- AI stream routing ---------------------------------------------------------------------
const streamHandlers = new Map<string, (e: AiStreamEvent) => void>()
const streamBuffer = new Map<string, AiStreamEvent[]>()

export function onAiStream(requestId: string, handler: (e: AiStreamEvent) => void): void {
  streamHandlers.set(requestId, handler)
  const early = streamBuffer.get(requestId)
  streamBuffer.delete(requestId)
  early?.forEach(handler)
  if (early?.some((e) => e.done)) streamHandlers.delete(requestId)
}

api.ai.onStream((e) => {
  const handler = streamHandlers.get(e.requestId)
  if (handler) {
    handler(e)
    if (e.done) streamHandlers.delete(e.requestId)
    return
  }
  const list = streamBuffer.get(e.requestId) ?? []
  if (list.length < 2000) list.push(e)
  streamBuffer.set(e.requestId, list)
})

export function aiReady(view: SettingsView | null): boolean {
  if (!view) return false
  const id = view.settings.ai.provider
  const cfg = view.settings.ai.providers[id]
  if (view.settings.privacy.localOnly && !isLocalUrl(cfg?.baseUrl ?? '')) return false
  return !!cfg?.model?.trim() && !!cfg.baseUrl?.trim() && (!providerPreset(id).needsKey || view.keys[id])
}

let recorder: Recorder | null = null
let pending: { id: string; patch: MeetingPatch } | null = null
let pendingTimer: ReturnType<typeof setTimeout> | null = null
let toastId = 0
let lastLevels = 0

const idleRecording: RecordingState = {
  status: 'idle',
  meetingId: null,
  sessionStartedAt: null,
  priorDurationMs: 0,
  pendingSeconds: 0,
  engine: 'idle'
}

function upsert(list: MeetingSummary[], s: MeetingSummary): MeetingSummary[] {
  const next = list.filter((m) => m.id !== s.id)
  next.push(s)
  return next.sort((a, b) => (b.startedAt ?? b.createdAt).localeCompare(a.startedAt ?? a.createdAt))
}

export const useApp = create<Store>((set, get) => {
  async function beginCapture(): Promise<boolean> {
    const t = get().view?.settings.transcription
    const rec = new Recorder()
    rec.onLevels = (levels) => {
      const now = performance.now()
      if (now - lastLevels > 70) {
        lastLevels = now
        set({ levels })
      }
    }
    rec.onTrackEnded = (message) => get().toast('error', message)
    try {
      await rec.start({ micDeviceId: t?.micDeviceId || undefined, captureSystem: t?.captureSystemAudio ?? true, noiseSuppression: t?.noiseSuppression ?? true })
    } catch (err) {
      await rec.stop()
      console.warn('audio capture failed', err)
      const denied = (err as Error).name === 'NotAllowedError'
      get().toast(
        'error',
        denied
          ? api.platform === 'darwin'
            ? 'macOS blocked the microphone. Allow NitroScribe in System Settings → Privacy & Security → Microphone.'
            : 'Windows blocked the microphone. Turn on Settings → Privacy & security → Microphone → "Let desktop apps access your microphone".'
          : `Could not access the microphone: ${(err as Error).message}`
      )
      return false
    }
    recorder = rec
    set({ systemAudio: rec.systemAudio })
    if ((t?.captureSystemAudio ?? true) && !rec.systemAudio) {
      get().toast('info', "Only your microphone is being transcribed: your computer's audio could not be captured.")
    }
    return true
  }

  function handleCommand(c: AppCommand) {
    const s = get()
    if (c.type === 'new-meeting') void s.newMeeting({ record: c.record })
    else if (c.type === 'open-meeting') void s.openMeeting(c.id)
    else if (c.type === 'start-from-event') void s.newMeeting({ record: true, event: c.event })
    else if (c.type === 'stop-recording') void s.stopRecording()
    else if (c.type === 'open-settings') s.openSettings()
    else if (c.type === 'open-digest') void s.go({ name: 'digest', week: shiftWeek(weekOf(new Date()), -1) })
  }

  return {
    booted: false,
    view: null,
    info: null,
    meetings: [],
    route: { name: 'home' },
    current: null,
    notesMode: 'mine',
    recording: idleRecording,
    levels: { mic: 0, sys: 0 },
    systemAudio: false,
    whisper: null,
    calendar: { events: [], errors: [] },
    panel: null,
    globalChatOpen: false,
    globalChat: [],
    settingsOpen: false,
    settingsTab: 'general',
    toasts: [],
    enhancing: null,
    pendingAsk: null,
    searchOpen: false,
    sidebarCollapsed: localStorage.getItem('sidebarCollapsed') === '1',
    identifying: false,
    importing: null,
    decoding: false,
    audioJobs: {},
    update: null,

    openImport: (preview) => set({ importing: preview ?? 'choose', searchOpen: false }),
    closeImport: () => set({ importing: null }),

    async importDroppedFile(file) {
      try {
        if (MEDIA_FILE.test(file.name)) {
          set({ decoding: true, importing: get().importing ?? 'choose' })
          const { pcm, durationMs } = await decodeRecording(file)
          const described = await api.imports.describe(file.name)
          // Without a date in the name, the file's modified time is roughly when the recording ended.
          const date = described.date ?? new Date((file.lastModified || Date.now()) - durationMs).toISOString()
          set({ importing: { kind: 'audio', fileName: file.name, durationMs, pcm, title: described.title, date } })
        } else {
          set({ importing: await api.imports.parse(new Uint8Array(await file.arrayBuffer()), file.name) })
        }
      } catch (err) {
        get().toast('error', (err as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
      } finally {
        set({ decoding: false })
      }
    },

    async startAudioImport(preview, { title, startedAt, summarize, templateId }) {
      const meeting = await api.imports.audioStart({ title, startedAt, fileName: preview.fileName, durationMs: preview.durationMs })
      set((s) => ({ importing: null, audioJobs: { ...s.audioJobs, [meeting.id]: { progress: 0, summarize, templateId } } }))
      await get().openMeeting(meeting.id)
      get().setPanel('transcript')
      // 30 s per message; slice() copies, so only that part of the buffer crosses to the main process.
      const chunk = 16000 * 30
      try {
        for (let i = 0; i < preview.pcm.length; i += chunk) {
          if (!get().audioJobs[meeting.id]) return
          await api.imports.audioPush(meeting.id, preview.pcm.slice(i, i + chunk))
        }
        await api.imports.audioFinish(meeting.id)
      } catch (err) {
        get().toast('error', (err as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
      }
    },

    cancelAudioImport(meetingId) {
      void api.imports.audioCancel(meetingId)
    },

    async finishImport(req, { summarize, templateId }) {
      const meeting = await api.imports.create(req)
      set({ importing: null })
      await get().openMeeting(meeting.id)
      get().toast('success', `Imported ${meeting.transcript.length} lines`)
      if (summarize && aiReady(get().view)) await get().enhance({ meetingId: meeting.id, templateId })
    },

    async goNotes() {
      await get().flushPending()
      set({ route: { name: 'notes' }, current: null, panel: null })
    },

    async goActions() {
      await get().go({ name: 'actions' })
    },

    async go(route) {
      await get().flushPending()
      set({ route, current: null, panel: null, globalChatOpen: false })
    },

    jumpTo: null,

    async openMeetingAt(id, segmentId) {
      set({ searchOpen: false })
      await get().openMeeting(id)
      set({ panel: 'transcript', jumpTo: { meetingId: id, segmentId } })
    },

    followUpFor: null,
    setFollowUp: (followUpFor) => set({ followUpFor }),

    scanning: null,

    async findActionItems(meetingIds) {
      if (get().scanning || !meetingIds.length) return
      if (!aiReady(get().view)) {
        get().toast('info', 'Connect an AI model first to find action items.')
        get().openSettings('ai')
        return
      }
      set({ scanning: { done: 0, total: meetingIds.length } })
      let found = 0
      for (const id of meetingIds) {
        try {
          found += (await api.ai.actionItems(id)).filter((i) => !i.done).length
        } catch (err) {
          get().toast('error', (err as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
          break
        } finally {
          set((s) => ({ scanning: s.scanning && { ...s.scanning, done: s.scanning.done + 1 } }))
        }
      }
      set({ scanning: null })
      get().toast('success', found ? `Found ${found} open action item${found === 1 ? '' : 's'}` : 'No action items found')
    },

    updateActionItem(meetingId, itemId, patch) {
      const summary = get().meetings.find((m) => m.id === meetingId)
      if (!summary) return
      const actionItems = patch
        ? summary.actionItems.map((i) => (i.id === itemId ? { ...i, ...patch, edited: true } : i))
        : summary.actionItems.filter((i) => i.id !== itemId)
      set((s) => ({ meetings: s.meetings.map((m) => (m.id === meetingId ? { ...m, actionItems } : m)) }))
      void api.meetings.update(meetingId, { actionItems }).catch((err: Error) => get().toast('error', err.message))
    },

    setSearchOpen: (searchOpen) => set({ searchOpen }),

    toggleSidebar() {
      const sidebarCollapsed = !get().sidebarCollapsed
      localStorage.setItem('sidebarCollapsed', sidebarCollapsed ? '1' : '0')
      set({ sidebarCollapsed })
    },

    setTheme: (theme) => void get().updateSettings({ general: { theme } }),

    async renameSpeaker(speakerId, name, remember) {
      const cur = get().current
      if (!cur) return
      try {
        const speakers = await api.speakers.rename(cur.id, speakerId, name, remember)
        const latest = get().current
        if (latest?.id === cur.id) set({ current: { ...latest, speakers } })
      } catch (err) {
        get().toast('error', (err as Error).message)
      }
    },

    async identifySpeakers() {
      const cur = get().current
      if (!cur) return
      if (!aiReady(get().view)) {
        get().toast('info', 'Connect an AI model first to identify speakers.')
        get().openSettings('ai')
        return
      }
      set({ identifying: true })
      try {
        const n = await api.speakers.identify(cur.id)
        get().toast(n ? 'success' : 'info', n ? `Named ${n} speaker${n === 1 ? '' : 's'} from the conversation` : "Couldn't tell who's who from the conversation. Click a speaker to name them.")
      } catch (err) {
        get().toast('error', (err as Error).message)
      } finally {
        set({ identifying: false })
      }
    },

    ask(question, scope) {
      const q = question.trim()
      if (!q) return
      set({ pendingAsk: { question: q, scope, nonce: Date.now() }, ...(scope === 'meeting' ? { panel: 'chat' as const } : { globalChatOpen: true }) })
    },

    consumeAsk: () => set({ pendingAsk: null }),

    async boot() {
      const [view, meetings, recording, whisper, calendar, info] = await Promise.all([
        api.settings.get(),
        api.meetings.list(),
        api.recording.state(),
        api.whisper.status(),
        api.calendar.snapshot(),
        api.app.info()
      ])
      set({ view, meetings, recording, whisper, calendar, info, booted: true })

      api.meetings.onChanged((summary) =>
        set((s) => {
          const current = s.current
          const titleFromMain = current?.id === summary.id && !current.title.trim() && summary.title.trim()
          return { meetings: upsert(s.meetings, summary), current: titleFromMain ? { ...current, title: summary.title } : current }
        })
      )
      api.meetings.onDeleted((id) => {
        set((s) => ({ meetings: s.meetings.filter((m) => m.id !== id) }))
        if (get().current?.id === id) void get().goHome()
      })
      api.recording.onState((recording) => set({ recording }))
      void api.app.updateInfo().then((update) => update && set({ update }))
      api.app.onUpdate((update) => set({ update }))
      api.imports.onAudioProgress((e) => {
        const job = get().audioJobs[e.meetingId]
        if (!job) return
        if (!e.done) {
          set((s) => ({ audioJobs: { ...s.audioJobs, [e.meetingId]: { ...job, progress: e.progress } } }))
          return
        }
        set((s) => {
          const { [e.meetingId]: _done, ...rest } = s.audioJobs
          return { audioJobs: rest }
        })
        if (e.error) {
          if (e.error !== 'Stopped') get().toast('error', `Transcription failed: ${e.error}`)
          return
        }
        get().toast('success', 'Recording transcribed')
        if (job.summarize && aiReady(get().view)) void get().enhance({ meetingId: e.meetingId, templateId: job.templateId })
      })
      api.recording.onSegments((e) =>
        set((s) => {
          if (s.current?.id !== e.meetingId) return {}
          const relabeled = e.relabeled ?? {}
          const kept = s.current.transcript
            .filter((x) => !e.removed.includes(x.id))
            .map((x) => (relabeled[x.id] ? { ...x, speakerId: relabeled[x.id] } : x))
          return {
            current: {
              ...s.current,
              transcript: [...kept, ...e.added].sort((a, b) => a.start - b.start),
              speakers: e.speakers ?? s.current.speakers
            }
          }
        })
      )
      api.recording.onFinished((meetingId) => {
        const s = get()
        if (!s.view?.settings.ai.autoEnhance || !aiReady(s.view)) return
        const summary = s.meetings.find((m) => m.id === meetingId)
        if (summary && summary.segmentCount > 0) void s.enhance({ meetingId })
      })
      api.settings.onChanged((view) => set({ view }))
      api.whisper.onStatus((whisper) => set({ whisper }))
      api.calendar.onEvents((events) => set((s) => ({ calendar: { ...s.calendar, events } })))
      api.app.onCommand(handleCommand)
      api.app.onToast((t) => get().toast(t.kind, t.message))

      // If the window was reloaded mid-recording, pick the audio capture back up.
      if (recording.status === 'recording' && recording.meetingId) {
        await get().openMeeting(recording.meetingId)
        if (!(await beginCapture())) await api.recording.stop('audio capture could not restart after a reload')
      }
    },

    async goHome() {
      await get().flushPending()
      set({ route: { name: 'home' }, current: null, panel: null, globalChatOpen: false })
    },

    async openMeeting(id) {
      await get().flushPending()
      const m = await api.meetings.get(id)
      if (!m) {
        get().toast('error', 'That meeting could not be found.')
        return
      }
      if (m.enhancedMarkdown && !m.enhancedHtml) {
        m.enhancedHtml = enhancedToEditorHtml(m.enhancedMarkdown, m.notesMarkdown)
        void api.meetings.update(id, { enhancedHtml: m.enhancedHtml })
      }
      const s = get()
      const keepPanel = s.current?.id === id ? s.panel : null
      set({
        route: { name: 'meeting', id },
        current: m,
        notesMode: m.enhancedMarkdown ? 'ai' : 'mine',
        panel: keepPanel,
        globalChatOpen: false
      })
    },

    async newMeeting(opts = {}) {
      const { event } = opts
      const m = await api.meetings.create(event ? { title: event.title, attendees: event.attendees, calendarEvent: event } : {})
      await get().openMeeting(m.id)
      if (!opts.record) return
      if (get().recording.status !== 'idle') {
        get().toast('info', 'Another meeting is still recording. Stop it to start transcribing this one.')
        return
      }
      await get().startRecording(m.id)
    },

    patchCurrent(patch) {
      const cur = get().current
      if (!cur) return
      set({ current: { ...cur, ...patch } })
      pending = pending && pending.id === cur.id ? { id: cur.id, patch: { ...pending.patch, ...patch } } : { id: cur.id, patch }
      if (pendingTimer) clearTimeout(pendingTimer)
      pendingTimer = setTimeout(() => void get().flushPending(), 450)
    },

    async flushPending() {
      if (pendingTimer) clearTimeout(pendingTimer)
      pendingTimer = null
      const p = pending
      pending = null
      if (p) await api.meetings.update(p.id, p.patch).catch((err: Error) => get().toast('error', `Could not save: ${err.message}`))
    },

    async startRecording(meetingId) {
      const id = meetingId ?? get().current?.id
      if (!id) return
      const s = get()
      if (s.whisper && !s.whisper.installing && !s.whisper.installedModels.includes(s.view!.settings.transcription.model)) {
        s.toast('error', 'Set up local transcription first (Settings → Transcription).')
        s.openSettings('transcription')
        return
      }
      try {
        await api.recording.start(id)
      } catch (err) {
        s.toast('error', (err as Error).message)
        return
      }
      if (!(await beginCapture())) await api.recording.stop('audio capture could not start')
    },

    async stopRecording() {
      const rec = recorder
      recorder = null
      await rec?.stop()
      set({ levels: { mic: 0, sys: 0 } })
      await api.recording.stop('stop button').catch((err: Error) => get().toast('error', err.message))
    },

    async enhance(opts = {}) {
      const s = get()
      const meetingId = opts.meetingId ?? s.current?.id
      if (!meetingId) return
      if (!aiReady(s.view)) {
        s.toast('info', 'Connect an AI model first to generate notes.')
        s.openSettings('ai')
        return
      }
      if (s.enhancing) return
      await s.flushPending()
      const fromCurrent = s.current?.id === meetingId ? s.current.templateId : undefined
      const templateId = opts.templateId ?? fromCurrent ?? s.view!.settings.defaultTemplateId
      let requestId: string
      try {
        requestId = await api.ai.enhance({ meetingId, templateId })
      } catch (err) {
        s.toast('error', (err as Error).message)
        return
      }
      set({ enhancing: { meetingId, requestId, text: '' } })
      if (get().current?.id === meetingId) set({ notesMode: 'ai' })
      onAiStream(requestId, (e) => {
        if (e.delta) {
          set((st) => (st.enhancing?.requestId === requestId ? { enhancing: { ...st.enhancing, text: st.enhancing.text + e.delta } } : {}))
          return
        }
        if (!e.done) return
        set({ enhancing: null })
        if (e.error) {
          if (e.error !== 'Stopped') get().toast('error', `Could not generate notes: ${e.error}`)
          const cur = get().current
          if (cur?.id === meetingId && !cur.enhancedMarkdown) set({ notesMode: 'mine' })
          return
        }
        const cur = get().current
        if (cur?.id === meetingId && e.text) {
          const html = enhancedToEditorHtml(e.text, cur.notesMarkdown)
          set({ current: { ...cur, enhancedMarkdown: e.text, enhancedHtml: html, enhancedAt: new Date().toISOString(), templateId }, notesMode: 'ai' })
          void api.meetings.update(meetingId, { enhancedHtml: html })
        }
      })
    },

    cancelEnhance() {
      const e = get().enhancing
      if (e) void api.ai.cancel(e.requestId)
    },

    async deleteMeeting(id) {
      try {
        if (pending?.id === id) pending = null
        await api.meetings.remove(id)
      } catch (err) {
        get().toast('error', (err as Error).message)
      }
    },

    setNotesMode: (notesMode) => set({ notesMode }),
    setPanel: (panel) => set({ panel }),
    setGlobalChat: (globalChatOpen) => set({ globalChatOpen }),
    setGlobalMessages: (globalChat) => set({ globalChat }),
    openSettings: (tab) => set((s) => ({ settingsOpen: true, settingsTab: tab ?? s.settingsTab })),
    closeSettings: () => set({ settingsOpen: false }),

    async updateSettings(patch) {
      try {
        set({ view: await api.settings.update(patch) })
      } catch (err) {
        get().toast('error', (err as Error).message)
      }
    },

    toast(kind, message) {
      const id = ++toastId
      set((s) => ({ toasts: [...s.toasts.filter((t) => t.message !== message), { id, kind, message }].slice(-4) }))
      setTimeout(() => get().dismissToast(id), kind === 'error' ? 9000 : 5000)
    },

    dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
  }
})
