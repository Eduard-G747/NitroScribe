import { execFile } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { existsSync } from 'node:fs'
import { providerPreset } from '@shared/providers'
import type { Meeting, MeetingSpeaker, RecordingState, SegmentsEvent, WhisperStatus } from '@shared/types'
import { OnlineDiarizer } from './speakers/cluster'
import type { Embedder } from './speakers/embedder'
import type { VoiceLibrary } from './speakers/voices'
import type { MeetingStore } from './store/meetings'
import type { SettingsStore } from './store/settings'
import { TranscriptionSession, type Diarization } from './transcription/session'
import { SAMPLE_RATE } from './transcription/wav'
import { log } from './util/log'
import type { WhisperManager } from './whisper/manager'

// Windows' built-in "Power saver" plan (same GUID in every language) throttles the CPU and GPU.
const POWER_SAVER_GUID = 'a1841308-3541-4fab-bc81-f71556f20b4a'

function powerSaverActive(): Promise<boolean> {
  if (process.platform !== 'win32') return Promise.resolve(false)
  return new Promise((resolve) =>
    execFile('powercfg', ['/getactivescheme'], { windowsHide: true, timeout: 5000 }, (err, out) => resolve(!err && out.toLowerCase().includes(POWER_SAVER_GUID)))
  )
}

const ENGINE: Record<WhisperStatus['server'], RecordingState['engine']> = {
  stopped: 'idle',
  starting: 'starting',
  ready: 'ready',
  error: 'error'
}

/** Owns the single active recording: feeds audio into a TranscriptionSession and persists results. */
export class RecordingController extends EventEmitter {
  private state: RecordingState = {
    status: 'idle',
    meetingId: null,
    sessionStartedAt: null,
    priorDurationMs: 0,
    pendingSeconds: 0,
    engine: 'idle'
  }
  private session: TranscriptionSession | null = null
  private fileJob: { meetingId: string; session: TranscriptionSession } | null = null
  private embedder: Embedder | null = null
  private powerSaverNoticeShown = false

  constructor(
    private meetings: MeetingStore,
    private settings: SettingsStore,
    private whisper: WhisperManager,
    private voices: VoiceLibrary,
    private createEmbedder: (modelPath: string) => Embedder
  ) {
    super()
    whisper.on('status', (s: WhisperStatus) => {
      if (this.state.status !== 'idle') this.set({ engine: ENGINE[s.server], error: s.server === 'error' ? s.error : undefined })
    })
  }

  getState(): RecordingState {
    return { ...this.state }
  }

  private set(patch: Partial<RecordingState>) {
    this.state = { ...this.state, ...patch }
    this.emit('state', this.getState())
  }

  private emitSegments(e: SegmentsEvent) {
    this.emit('segments', e)
  }

  private diarization(speakers: MeetingSpeaker[]): Diarization | undefined {
    if (!this.settings.get().transcription.separateSpeakers || !existsSync(this.whisper.speakerModelPath)) return undefined
    try {
      this.embedder ??= this.createEmbedder(this.whisper.speakerModelPath)
    } catch (err) {
      log('speaker separation unavailable:', err as Error)
      return undefined
    }
    return { embedder: this.embedder, diarizer: new OnlineDiarizer(speakers, this.voices.list()) }
  }

  private assertEngine() {
    const t = this.settings.get().transcription
    if (!this.whisper.isReady(t.model) && !this.whisper.isInstalling) {
      throw new Error('Local transcription is not set up yet. Open Settings → Transcription to download the speech model.')
    }
  }

  /** A transcription session that saves into `meetingId` and streams segments to the window. */
  private createSession(meetingId: string, meeting: Meeting, timeBaseMs: number, onProgress?: (endMs: number) => void): TranscriptionSession {
    const t = this.settings.get().transcription
    const config = { model: t.model, useGpu: t.useGpu, gpuDevice: t.gpuDevice }
    const diarization = this.diarization(Object.values(meeting.speakers ?? {}))
    log(`session for meeting ${meetingId}: model ${t.model}, language ${t.language}, gpu ${t.useGpu}, speakers ${diarization ? 'on' : 'off'}`)
    return new TranscriptionSession(
      {
        timeBaseMs,
        language: t.language,
        vocabulary: t.vocabulary,
        context: meeting.transcript.slice(-6).map((s) => s.text).join(' ')
      },
      {
        transcribe: (wav, params) => this.whisper.transcribe(wav, params, config),
        onSegments: (added, removed) => {
          void this.meetings.applySegments(meetingId, added, removed)
          this.emitSegments({ meetingId, added, removed })
          if (onProgress && added.length) onProgress(added.reduce((m, s) => Math.max(m, s.end), 0))
        },
        onSpeakers: async (incoming) => {
          const speakers = await this.meetings.mergeSpeakers(meetingId, incoming)
          this.emitSegments({ meetingId, added: [], removed: [], speakers })
        },
        onRelabel: async (relabeled, incoming) => {
          const speakers = await this.meetings.relabel(meetingId, relabeled, incoming)
          this.emitSegments({ meetingId, added: [], removed: [], relabeled, speakers })
        },
        onPending: (pendingSeconds) => !onProgress && this.set({ pendingSeconds }),
        onError: (message) => {
          log('transcription error:', message)
          this.emit('error', message)
        },
        onWindow: (w) =>
          log(`window: ${w.speechSeconds.toFixed(1)}s speech in ${w.ms} ms (lang ${w.requested} -> ${w.language}, ${w.segments} segments)`)
      },
      undefined,
      undefined,
      diarization
    )
  }

  async start(meetingId: string): Promise<RecordingState> {
    if (this.state.status === 'recording' && this.state.meetingId === meetingId) return this.getState()
    if (this.state.status !== 'idle') throw new Error('Another meeting is still being recorded or finished. Stop it first.')
    if (this.fileJob) throw new Error('A recording file is still being transcribed. Wait for it to finish first.')
    this.assertEngine()
    const t = this.settings.get().transcription
    const config = { model: t.model, useGpu: t.useGpu, gpuDevice: t.gpuDevice }
    const now = Date.now()
    const meeting = await this.meetings.markStarted(meetingId, new Date(now).toISOString())
    const sinceStart = now - Date.parse(meeting.startedAt ?? new Date(now).toISOString())
    const lastEnd = meeting.transcript.reduce((m, s) => Math.max(m, s.end), 0)
    // Continue the meeting's timeline, unless its date was edited, in which case pick up after the last line.
    const timeBaseMs = sinceStart >= lastEnd && sinceStart - lastEnd < 12 * 3_600_000 ? sinceStart : lastEnd + (lastEnd ? 1000 : 0)
    this.session = this.createSession(meetingId, meeting, timeBaseMs)
    log(`recording started: meeting ${meetingId}`)
    this.set({
      status: 'recording',
      meetingId,
      sessionStartedAt: now,
      priorDurationMs: meeting.durationMs,
      pendingSeconds: 0,
      engine: 'starting',
      error: undefined
    })
    this.whisper.ensureServer(config).catch((err: Error) => this.set({ engine: 'error', error: err.message }))
    void powerSaverActive().then((on) => {
      if (!on) return
      log('power plan: Power saver')
      if (this.powerSaverNoticeShown) return
      this.powerSaverNoticeShown = true
      this.emit('notice', 'Windows is in Power saver mode, which makes transcription much slower. Switch to the Balanced plan for faster transcripts.')
    })
    return this.getState()
  }

  push(mic: Int16Array, sys: Int16Array | null): void {
    if (this.state.status === 'recording') this.session?.push(mic, sys)
  }

  /** Keeps the live speaker clustering in sync when someone is named mid-meeting. */
  nameSpeaker(meetingId: string, speakerId: string, name: string | undefined, source: 'manual' | 'ai', voiceId?: string): void {
    if (this.state.meetingId === meetingId) this.session?.setSpeakerName(speakerId, name, source, voiceId)
  }

  /** Stops capturing, then waits until the remaining audio has been transcribed. */
  async stop(): Promise<void> {
    const { status, meetingId, sessionStartedAt } = this.state
    const session = this.session
    if (status !== 'recording' || !meetingId || !session) return
    this.set({ status: 'finishing' })
    const recordedMs = (session.sampleCount / SAMPLE_RATE) * 1000 || Date.now() - (sessionStartedAt ?? Date.now())
    await this.meetings.addDuration(meetingId, recordedMs)
    const stopping = Date.now()
    try {
      await session.stop()
    } finally {
      log(`recording stopped: ${Math.round(recordedMs / 1000)}s recorded, final transcription took ${Date.now() - stopping} ms, ${session.echoRegionsDropped} echo regions dropped`)
      this.session = null
      this.set({ status: 'idle', meetingId: null, sessionStartedAt: null, pendingSeconds: 0 })
      this.releaseEngine()
      this.emit('finished', meetingId)
    }
  }

  /** A local AI model is about to write the notes on the same GPU: give it Whisper's memory now. */
  private releaseEngine() {
    if (providerPreset(this.settings.get().ai.provider).local) void this.whisper.stopServer()
    else this.whisper.scheduleIdleStop(3 * 60_000)
  }

  /** Meeting whose uploaded recording is being transcribed, if any. */
  get transcribingFile(): string | null {
    return this.fileJob?.meetingId ?? null
  }

  /** Throws if an uploaded recording can't be transcribed right now. */
  checkFileReady(): void {
    if (this.state.status !== 'idle') throw new Error('Stop the current recording before transcribing a file.')
    if (this.fileJob) throw new Error('Another recording is still being transcribed. Wait for it to finish.')
    this.assertEngine()
  }

  /** Starts transcribing an uploaded recording into `meetingId`; audio arrives through pushFile(). */
  async startFile(meetingId: string, durationMs: number): Promise<void> {
    this.checkFileReady()
    const meeting = await this.meetings.get(meetingId)
    if (!meeting) throw new Error('Meeting not found')
    const t = this.settings.get().transcription
    const progress = (endMs: number) => this.emit('fileProgress', { meetingId, progress: Math.min(0.99, endMs / Math.max(1, durationMs)) })
    this.fileJob = { meetingId, session: this.createSession(meetingId, meeting, 0, progress) }
    this.whisper.cancelIdleStop()
    this.whisper.ensureServer({ model: t.model, useGpu: t.useGpu, gpuDevice: t.gpuDevice }).catch((err: Error) => this.emit('error', err.message))
    log(`file transcription started: ${Math.round(durationMs / 1000)} s of audio`)
  }

  /** Feeds uploaded audio (16 kHz mono) into the file session. */
  pushFile(meetingId: string, pcm: Int16Array): void {
    if (this.fileJob?.meetingId !== meetingId) throw new Error('This recording is no longer being transcribed.')
    this.fileJob.session.push(new Int16Array(pcm.length), pcm)
  }

  /** All audio was pushed: transcribes what is left, then reports completion. */
  async finishFile(meetingId: string): Promise<void> {
    const job = this.fileJob
    if (job?.meetingId !== meetingId) return
    const started = Date.now()
    try {
      await job.session.stop()
      log(`file transcription finished ${Math.round((Date.now() - started) / 1000)} s after the last audio arrived`)
      this.emit('fileProgress', { meetingId, progress: 1, done: true })
    } catch (err) {
      this.emit('fileProgress', { meetingId, progress: 0, done: true, error: (err as Error).message })
    } finally {
      if (this.fileJob === job) this.fileJob = null
      this.releaseEngine()
    }
  }

  cancelFile(meetingId: string): void {
    const job = this.fileJob
    if (job?.meetingId !== meetingId) return
    job.session.cancel()
    this.fileJob = null
    this.emit('fileProgress', { meetingId, progress: 0, done: true, error: 'Stopped' })
    this.releaseEngine()
  }

  /** Abandons the current recording immediately (used on quit). */
  async abort(): Promise<void> {
    this.fileJob?.session.cancel()
    this.fileJob = null
    const { meetingId } = this.state
    if (this.session && meetingId) {
      await this.meetings.addDuration(meetingId, (this.session.sampleCount / SAMPLE_RATE) * 1000)
      this.session.cancel()
    }
    this.session = null
  }

  dispose(): void {
    this.embedder?.dispose()
    this.embedder = null
  }
}
