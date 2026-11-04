import {
  BrowserWindow,
  Menu,
  Notification,
  app,
  clipboard,
  desktopCapturer,
  dialog,
  ipcMain,
  nativeTheme,
  systemPreferences,
  safeStorage,
  session,
  shell,
  type MenuItemConstructorOptions
} from 'electron'
import { existsSync, promises as fs } from 'node:fs'
import { basename, join, sep } from 'node:path'
import { meetingFileBase, meetingDate, transcriptToText } from '@shared/format'
import { hostOf } from '@shared/net'
import type {
  AppCommand,
  AudioImportProgress,
  AudioImportRequest,
  CalendarEvent,
  ImportRequest,
  Meeting,
  MeetingPatch,
  MeetingSpeaker,
  SaveFileRequest,
  Settings,
  UpdateInfo
} from '@shared/types'
import { MAX_IMPORT_BYTES, meetingFromImport, previewFile, previewText } from './import'
import { fileTitle, findDate } from './import/parse'
import { UpdateChecker } from './updates'
import { AiService } from './ai/service'
import { CalendarService, fetchIcs, parseIcs } from './calendar'
import { RecordingController } from './recording'
import createEmbedWorker from './speakers/embed-worker?nodeWorker'
import { createWorkerEmbedder } from './speakers/embedder'
import { VoiceLibrary } from './speakers/voices'
import { MeetingStore } from './store/meetings'
import { SettingsStore, type SecretCipher } from './store/settings'
import { AppTray } from './tray'
import { initLog, log } from './util/log'
import { WhisperManager } from './whisper/manager'

const startHidden = process.argv.includes('--hidden')
const devServer = !app.isPackaged ? process.env.ELECTRON_RENDERER_URL : undefined
// Lets tests (or a portable setup) keep all data in a separate folder.
if (process.env.NITROSCRIBE_DATA_DIR) app.setPath('userData', process.env.NITROSCRIBE_DATA_DIR)

const MAC = process.platform === 'darwin'
// System-audio capture on macOS (ScreenCaptureKit); Windows uses WASAPI loopback without flags.
if (MAC) app.commandLine.appendSwitch('enable-features', 'MacLoopbackAudioForScreenShare,MacSckSystemAudioLoopbackOverride')

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  if (process.platform === 'win32') app.setAppUserModelId('com.eduar.nitroscribe')
  void app.whenReady().then(main)
}

function resource(name: string): string {
  return join(__dirname, '../../resources', name).replace(`app.asar${sep}`, `app.asar.unpacked${sep}`)
}

const cipher: SecretCipher = {
  encrypt: (plain) =>
    safeStorage.isEncryptionAvailable()
      ? `enc:${safeStorage.encryptString(plain).toString('base64')}`
      : `b64:${Buffer.from(plain, 'utf8').toString('base64')}`,
  decrypt: (encoded) =>
    encoded.startsWith('enc:')
      ? safeStorage.decryptString(Buffer.from(encoded.slice(4), 'base64'))
      : Buffer.from(encoded.replace(/^b64:/, ''), 'base64').toString('utf8')
}

function toInt16(v: unknown): Int16Array {
  if (v instanceof Int16Array) return v
  if (ArrayBuffer.isView(v)) return new Int16Array(new Uint8Array(v.buffer, v.byteOffset, v.byteLength).slice().buffer)
  if (v instanceof ArrayBuffer) return new Int16Array(v)
  return new Int16Array(0)
}

function meetingMarkdown(m: Meeting, userName: string): string {
  return [
    `# ${m.title || 'Untitled meeting'}`,
    '',
    `*${meetingDate(m).toLocaleString()}*${m.attendees.length ? `  \nAttendees: ${m.attendees.join(', ')}` : ''}`,
    '',
    m.enhancedMarkdown ? `## AI notes\n\n${m.enhancedMarkdown}\n` : '',
    m.notesMarkdown.trim() ? `## My notes\n\n${m.notesMarkdown}\n` : '',
    m.transcript.length ? `## Transcript\n\n${transcriptToText(m, userName)}\n` : ''
  ]
    .filter(Boolean)
    .join('\n')
}

async function main() {
  const dataDir = app.getPath('userData')
  const logsDir = join(dataDir, 'logs')
  initLog(logsDir)
  log(`NitroScribe ${app.getVersion()} starting (electron ${process.versions.electron})`)
  const settings = new SettingsStore(dataDir, cipher)
  const meetings = new MeetingStore(join(dataDir, 'meetings'), (p) => shell.trashItem(p))
  const whisper = new WhisperManager(join(dataDir, 'whisper'), logsDir)
  const voices = new VoiceLibrary(dataDir)
  await Promise.all([settings.init(), meetings.init(), voices.init()])
  await whisper.init()
  const recorder = new RecordingController(meetings, settings, whisper, voices, (modelPath) => createWorkerEmbedder(createEmbedWorker, modelPath))
  const ai = new AiService(meetings, settings)
  const calendar = new CalendarService(() => settings.get().calendars)

  let win: BrowserWindow | null = null
  let quitting = false
  let cleanedUp = false

  const send = (channel: string, payload?: unknown) => {
    if (win && !win.isDestroyed()) win.webContents.send(channel, payload)
  }
  const showWindow = () => {
    if (!win) return
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
  }
  const command = (c: AppCommand) => {
    showWindow()
    send('app:command', c)
  }

  const applyLoginItem = (s: Settings) => {
    if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: s.general.launchAtLogin, ...(MAC ? { openAsHidden: true } : { args: ['--hidden'] }) })
  }
  applyLoginItem(settings.get())

  // The theme setting drives nativeTheme, which also flips `prefers-color-scheme` in the renderer.
  const themeColors = () => (nativeTheme.shouldUseDarkColors ? { color: '#292929', symbolColor: '#b9b8b2' } : { color: '#fdfdfc', symbolColor: '#57564f' })
  nativeTheme.themeSource = settings.get().general.theme
  nativeTheme.on('updated', () => {
    if (!win || win.isDestroyed()) return
    if (!MAC) win.setTitleBarOverlay({ ...themeColors(), height: 44 })
    win.setBackgroundColor(themeColors().color)
  })

  // --- Window ---------------------------------------------------------------------------
  win = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 940,
    minHeight: 600,
    show: false,
    title: 'NitroScribe',
    backgroundColor: themeColors().color,
    icon: resource('icon.png'),
    titleBarStyle: 'hidden',
    // macOS draws its own traffic lights; Windows gets the caption-button overlay.
    ...(MAC ? { trafficLightPosition: { x: 16, y: 15 } } : { titleBarOverlay: { ...themeColors(), height: 44 } }),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      spellcheck: true
    }
  })
  win.on('ready-to-show', () => {
    if (!startHidden) win?.show()
  })
  // Renderer problems end up in the app log, which makes field issues diagnosable.
  win.webContents.on('console-message', (e) => {
    if (e.level === 'warning' || e.level === 'error') log(`renderer ${e.level}: ${e.message.slice(0, 500)}`)
  })
  win.webContents.on('render-process-gone', (_e, details) => log(`renderer gone: ${details.reason} (exit ${details.exitCode})`))
  /** Asks before quitting while a meeting is still being recorded. */
  const confirmQuit = (): boolean => {
    if (recorder.getState().status === 'idle' || !win) return true
    const choice = dialog.showMessageBoxSync(win, {
      type: 'warning',
      buttons: ['Keep recording', 'Quit anyway'],
      defaultId: 0,
      cancelId: 0,
      title: 'NitroScribe',
      message: 'A meeting is still being transcribed.',
      detail: 'If you quit now, the rest of this meeting will not be transcribed.'
    })
    return choice === 1
  }
  win.on('close', (e) => {
    if (quitting) return
    if (settings.get().general.closeToTray) {
      e.preventDefault()
      win?.hide()
    } else if (!confirmQuit()) {
      e.preventDefault()
    }
  })
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e, url) => {
    if (devServer && url.startsWith(devServer)) return
    e.preventDefault()
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
  })
  if (devServer) void win.loadURL(devServer)
  else void win.loadFile(join(__dirname, '../renderer/index.html'))

  const menu: MenuItemConstructorOptions[] = [
    ...(MAC ? ([{ role: 'appMenu' }] as MenuItemConstructorOptions[]) : []),
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        ...(app.isPackaged ? [] : ([{ role: 'reload' }, { role: 'toggleDevTools' }] as MenuItemConstructorOptions[])),
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' }
      ]
    },
    { role: 'windowMenu' }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(menu))

  // System audio: grant getDisplayMedia() with WASAPI loopback, without a picker.
  session.defaultSession.setDisplayMediaRequestHandler(
    (_request, callback) => {
      desktopCapturer
        .getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } })
        .then((sources) => callback(sources[0] ? { video: sources[0], audio: 'loopback' } : {}))
        .catch(() => callback({}))
    },
    { useSystemPicker: false }
  )
  const allowed = new Set(['media', 'display-capture', 'notifications', 'clipboard-sanitized-write', 'fullscreen'])
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb, details) => {
    // Microphone yes, camera never.
    const wantsVideo = permission === 'media' && 'mediaTypes' in details && details.mediaTypes?.includes('video')
    cb(allowed.has(permission) && !wantsVideo)
  })
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => allowed.has(permission))
  // The window never talks to the internet (only the dev server while developing). AI, calendar and
  // model downloads run in the main process, where Local-only mode is enforced.
  const devHost = devServer ? new URL(devServer).host : null
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] }, (details, cb) => {
    const ok = !!devHost && new URL(details.url).host === devHost
    if (!ok) log(`blocked a network request from the window to ${hostOf(details.url)}`)
    cb({ cancel: !ok })
  })

  // --- Tray -----------------------------------------------------------------------------
  app.on('activate', () => showWindow())
  const tray = new AppTray(
    { idle: resource('tray.png'), recording: resource('tray-recording.png') },
    {
      show: showWindow,
      newMeeting: () => command({ type: 'new-meeting', record: true }),
      stopRecording: () => {
        log('stop requested from the tray')
        command({ type: 'stop-recording' })
      },
      quit: () => {
        if (!confirmQuit()) return
        quitting = true
        app.quit()
      }
    }
  )

  // --- Events to renderer ---------------------------------------------------------------
  meetings.on('changed', (s) => send('meetings:changed', s))
  meetings.on('deleted', (id) => send('meetings:deleted', id))
  meetings.on('saveError', (err: Error) => {
    log('meeting save failed:', err)
    send('app:toast', { kind: 'error', message: `Could not save a meeting: ${err.message}` })
  })
  recorder.on('state', (s) => {
    send('recording:state', s)
    tray.setRecording(s.status !== 'idle')
  })
  recorder.on('segments', (e) => send('recording:segments', e))
  recorder.on('finished', (id: string) => {
    send('recording:finished', id)
    // Generating notes names speakers first; without auto notes, name them on their own.
    const { ai: aiSettings } = settings.get()
    if (aiSettings.autoNameSpeakers && !aiSettings.autoEnhance) {
      ai.identifySpeakers(id).catch((err: Error) => log(`speaker identification skipped: ${err.message}`))
    }
  })
  recorder.on('error', (message: string) => send('app:toast', { kind: 'error', message }))
  recorder.on('notice', (message: string) => send('app:toast', { kind: 'info', message }))

  // Update reminders: a daily look at the repo's latest GitHub release (no data about the user is sent).
  const updates = new UpdateChecker(() => settings.get().updates.check)
  updates.on('available', (info: UpdateInfo, isNew: boolean) => {
    send('app:update', info)
    if (!isNew || settings.get().updates.dismissed === info.version || !Notification.isSupported()) return
    const n = new Notification({ title: `NitroScribe ${info.version} is available`, body: 'Click to download the update.', icon: resource('icon.png') })
    n.on('click', () => void shell.openExternal(info.url))
    n.show()
  })
  updates.start()
  recorder.on('fileProgress', (e: AudioImportProgress) => send('import:audioProgress', e))
  ai.on('stream', (e) => send('ai:stream', e))
  ai.on('speakersNamed', (meetingId: string, speakers: Record<string, MeetingSpeaker>) => {
    for (const s of Object.values(speakers)) if (s.nameSource === 'ai') recorder.nameSpeaker(meetingId, s.id, s.name, 'ai')
    send('recording:segments', { meetingId, added: [], removed: [], speakers })
  })
  settings.on('changed', (view) => {
    send('settings:changed', view)
    applyLoginItem(view.settings)
    if (nativeTheme.themeSource !== view.settings.general.theme) nativeTheme.themeSource = view.settings.general.theme
  })
  whisper.on('status', (s) => send('whisper:status', s))
  calendar.on('events', (events) => send('calendar:events', events))
  calendar.on('starting', (event: CalendarEvent) => {
    if (!settings.get().notifyMeetings || !Notification.isSupported() || recorder.getState().status !== 'idle') return
    const n = new Notification({ title: event.title, body: 'Starting now. Click to take notes and transcribe.', icon: resource('icon.png') })
    n.on('click', () => command({ type: 'start-from-event', event }))
    n.show()
  })
  calendar.start()

  app.on('second-instance', showWindow)

  // --- IPC ------------------------------------------------------------------------------
  const handle = (channel: string, fn: (...args: never[]) => unknown) =>
    ipcMain.handle(channel, (_e, ...args) => (fn as (...a: unknown[]) => unknown)(...args))

  handle('meetings:list', () => meetings.list())
  handle('meetings:get', (id: string) => meetings.get(id))
  handle('meetings:create', (init?: Partial<Meeting>) => meetings.create(init))

  handle('import:pick', async () => {
    const res = await dialog.showOpenDialog(win!, {
      title: 'Import a transcript',
      properties: ['openFile'],
      filters: [
        { name: 'Transcripts', extensions: ['txt', 'vtt', 'srt', 'docx', 'md', 'json', 'text'] },
        { name: 'All files', extensions: ['*'] }
      ]
    })
    const path = res.filePaths[0]
    if (res.canceled || !path) return null
    if ((await fs.stat(path)).size > MAX_IMPORT_BYTES) throw new Error('This file is too big to be a transcript (25 MB max).')
    return previewFile(await fs.readFile(path), basename(path))
  })
  handle('import:parse', (data: Uint8Array | string, fileName: string) =>
    typeof data === 'string' ? previewText(data) : previewFile(Buffer.from(data), basename(String(fileName)))
  )
  handle('import:create', async (req: ImportRequest) => {
    const m = await meetings.create(meetingFromImport(req))
    log(`imported a transcript: ${m.transcript.length} lines, format ${m.source?.format}`)
    return m
  })
  // Uploaded recordings: the window decodes the audio to 16 kHz PCM and streams it here in chunks.
  handle('import:describe', (fileName: string) => ({ title: fileTitle(String(fileName)), date: findDate(String(fileName)) }))
  handle('import:audioStart', async (req: AudioImportRequest) => {
    const startedAt = new Date(String(req.startedAt))
    if (Number.isNaN(startedAt.getTime())) throw new Error('Pick when the recording was made.')
    recorder.checkFileReady()
    const iso = startedAt.toISOString()
    const m = await meetings.create({
      title: String(req.title ?? '').slice(0, 300).trim(),
      createdAt: iso,
      startedAt: iso,
      durationMs: Math.max(0, Math.round(Number(req.durationMs) || 0)),
      source: { kind: 'import', fileName: String(req.fileName ?? '').slice(0, 260) || undefined, format: 'Audio recording', importedAt: new Date().toISOString() }
    })
    await recorder.startFile(m.id, m.durationMs)
    return m
  })
  handle('import:audioPush', (meetingId: string, pcm: unknown) => recorder.pushFile(meetingId, toInt16(pcm)))
  handle('import:audioFinish', (meetingId: string) => void recorder.finishFile(meetingId))
  handle('import:audioCancel', (meetingId: string) => recorder.cancelFile(meetingId))
  handle('meetings:update', async (id: string, patch: MeetingPatch) => {
    await meetings.update(id, patch)
  })
  handle('meetings:remove', async (id: string) => {
    if (recorder.getState().meetingId === id) throw new Error('Stop the recording before deleting this meeting.')
    recorder.cancelFile(id)
    await meetings.delete(id)
  })
  handle('meetings:search', (q: string) => meetings.search(q))

  handle('recording:start', async (id: string) => {
    // macOS asks for microphone access once; Windows handles it in its privacy settings.
    if (MAC && !(await systemPreferences.askForMediaAccess('microphone'))) {
      throw new Error('macOS blocked the microphone. Allow NitroScribe in System Settings → Privacy & Security → Microphone.')
    }
    return recorder.start(id)
  })
  handle('recording:stop', (reason?: string) => {
    log(`stop requested by the window${reason ? `: ${reason}` : ''}`)
    return recorder.stop()
  })
  handle('recording:state', () => recorder.getState())
  ipcMain.on('recording:audio', (_e, mic: unknown, sys: unknown) => recorder.push(toInt16(mic), sys ? toInt16(sys) : null))

  handle('speakers:rename', async (meetingId: string, speakerId: string, name: string, remember: boolean) => {
    const m = await meetings.get(meetingId)
    if (!m) throw new Error('Meeting not found')
    const clean = name.trim().slice(0, 60)
    const speaker: MeetingSpeaker = { ...(m.speakers?.[speakerId] ?? { id: speakerId }), name: clean || undefined, nameSource: clean ? 'manual' : undefined }
    if (clean && remember && settings.get().transcription.rememberVoices && speaker.embedding?.length) {
      speaker.voiceId = (await voices.remember(clean, speaker.embedding, speaker.voiceId)).id
    }
    const speakers = { ...(m.speakers ?? {}), [speakerId]: speaker }
    await meetings.update(meetingId, { speakers })
    recorder.nameSpeaker(meetingId, speakerId, speaker.name, 'manual', speaker.voiceId)
    return speakers
  })
  handle('speakers:identify', (meetingId: string) => ai.identifySpeakers(meetingId))
  handle('voices:list', () => voices.list().map(({ id, name, samples, updatedAt }) => ({ id, name, samples, updatedAt })))
  handle('voices:remove', (id: string) => voices.remove(id))

  handle('ai:enhance', (req: Parameters<AiService['enhance']>[0]) => ai.enhance(req))
  handle('ai:chat', (req: Parameters<AiService['chat']>[0]) => ai.chat(req))
  handle('ai:cancel', (id: string) => ai.cancel(id))
  handle('ai:models', (provider: Parameters<AiService['models']>[0]) => ai.models(provider))
  handle('ai:test', (provider: Parameters<AiService['test']>[0]) => ai.test(provider))

  handle('settings:get', () => settings.view())
  handle('settings:update', (patch: Parameters<SettingsStore['update']>[0]) => {
    // Only the names of changed settings are logged, never their values.
    const paths = (o: object, prefix = ''): string[] =>
      Object.entries(o).flatMap(([k, v]) => (v && typeof v === 'object' && !Array.isArray(v) ? paths(v, `${prefix}${k}.`) : [`${prefix}${k}`]))
    log('settings changed:', paths(patch).join(', '))
    return settings.update(patch)
  })
  handle('settings:setKey', (provider: Parameters<SettingsStore['setKey']>[0], key: string) => settings.setKey(provider, key))

  handle('whisper:status', () => whisper.getStatus())
  handle('whisper:install', (model: Parameters<WhisperManager['install']>[0]) => whisper.install(model))
  handle('whisper:cancel', () => whisper.cancelInstall())
  handle('whisper:deleteModel', (model: Parameters<WhisperManager['deleteModel']>[0]) => whisper.deleteModel(model))

  handle('calendar:snapshot', () => ({ events: calendar.getEvents(), errors: calendar.getErrors() }))
  handle('calendar:refresh', async () => ({ events: await calendar.refresh(), errors: calendar.getErrors() }))
  handle('calendar:test', async (url: string) => {
    try {
      const events = parseIcs(await fetchIcs(url), new Date(Date.now() - 12 * 3600_000), new Date(Date.now() + 14 * 24 * 3600_000))
      return { ok: true, message: `Connected: ${events.length} event${events.length === 1 ? '' : 's'} in the next two weeks.` }
    } catch (err) {
      return { ok: false, message: (err as Error).message }
    }
  })

  handle('files:save', async (req: SaveFileRequest) => {
    const res = await dialog.showSaveDialog(win!, { defaultPath: join(app.getPath('documents'), req.defaultName), filters: req.filters })
    if (res.canceled || !res.filePath) return null
    await fs.writeFile(res.filePath, req.content, 'utf8')
    return res.filePath
  })
  handle('files:exportAll', async () => {
    const res = await dialog.showOpenDialog(win!, { title: 'Export all meetings as Markdown', properties: ['openDirectory', 'createDirectory'] })
    if (res.canceled || !res.filePaths[0]) return null
    let count = 0
    for (const summary of meetings.list()) {
      const m = await meetings.get(summary.id)
      if (!m) continue
      let file = join(res.filePaths[0], `${meetingFileBase(m)}.md`)
      if (existsSync(file)) file = file.replace(/\.md$/, ` (${m.id.slice(0, 6)}).md`)
      await fs.writeFile(file, meetingMarkdown(m, settings.get().userName), 'utf8')
      count++
    }
    return count
  })
  handle('files:copy', (text: string) => clipboard.writeText(text))

  handle('app:info', () => ({ version: app.getVersion(), platform: process.platform, dataDir, logsDir }))
  handle('app:updateInfo', () => updates.latest)
  handle('app:openUpdate', () => updates.latest && shell.openExternal(updates.latest.url))
  handle('app:openExternal', async (url: string) => {
    if (/^https?:\/\//i.test(url)) await shell.openExternal(url)
  })
  handle('app:openFolder', async (which: 'data' | 'logs') => {
    const dir = which === 'logs' ? logsDir : dataDir
    await fs.mkdir(dir, { recursive: true })
    await shell.openPath(dir)
  })

  // --- Shutdown -------------------------------------------------------------------------
  app.on('before-quit', (e) => {
    quitting = true
    if (cleanedUp) return
    e.preventDefault()
    void (async () => {
      try {
        await recorder.abort()
        meetings.flushSync()
      } finally {
        whisper.dispose()
        recorder.dispose()
        calendar.stop()
        updates.stop()
        tray.destroy()
        cleanedUp = true
        app.quit()
      }
    })()
  })
  app.on('window-all-closed', () => app.quit())
}
