import { randomUUID } from 'node:crypto'
import type { MeetingSpeaker, Speaker, TranscriptSegment } from '@shared/types'
import { splitPhrases, type OnlineDiarizer } from '../speakers/cluster'
import type { Embedder } from '../speakers/embedder'
import type { TranscribeParams, WhisperResult } from '../whisper/manager'
import { buildPrompt, cleanTranscriptText, isEcho, isHallucination } from './postprocess'
import { ChannelVad, type SpeakerPhrase, type SpeechRegion, type VadOptions } from './vad'
import { SAMPLE_RATE, encodeWav } from './wav'
import { WINDOW_OPTIONS, groupWords, mapWords, packWindows, windowSpeechSeconds, type AudioWindow, type MappedWord } from './windows'

export interface Diarization {
  embedder: Embedder
  diarizer: OnlineDiarizer
}

export interface SessionOptions {
  /** Meeting-timeline offset (ms) of this session's first sample. */
  timeBaseMs: number
  language: string
  vocabulary: string
  /** Recent transcript text used to prime Whisper when resuming. */
  context?: string
}

export interface SessionDeps {
  transcribe: (wav: Buffer, params: TranscribeParams) => Promise<WhisperResult>
  onSegments: (added: TranscriptSegment[], removed: string[]) => void
  onPending?: (seconds: number) => void
  onError?: (message: string) => void
  onWindow?: (info: { speechSeconds: number; ms: number; language: string; requested: string; segments: number }) => void
  /** The set of remote speakers (or their names) changed. */
  onSpeakers?: (speakers: Record<string, MeetingSpeaker>) => void
  /** Speakers were re-clustered at the end: segment id → new speaker id. */
  onRelabel?: (relabeled: Record<string, string>, speakers: Record<string, MeetingSpeaker>) => void
}

export interface FlushPolicy {
  /** Flush once this much speech is waiting. */
  targetSeconds: number
  /** Flush during a pause once the oldest speech is this old. */
  quietLatencySeconds: number
  /** Always flush once the oldest speech is this old. */
  maxLatencySeconds: number
}

// Each Whisper pass has a large fixed cost (the encoder always processes 30 s of audio), so windows are
// kept close to full. Text shows up roughly 20-40 s after it is spoken.
export const DEFAULT_FLUSH: FlushPolicy = { targetSeconds: 24, quietLatencySeconds: 20, maxLatencySeconds: 40 }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function pearson(a: number[], b: number[]): number {
  const n = a.length
  let ma = 0
  let mb = 0
  for (let i = 0; i < n; i++) {
    ma += a[i]
    mb += b[i]
  }
  ma /= n
  mb /= n
  let cov = 0
  let va = 0
  let vb = 0
  for (let i = 0; i < n; i++) {
    const da = a[i] - ma
    const db = b[i] - mb
    cov += da * db
    va += da * da
    vb += db * db
  }
  return va && vb ? cov / Math.sqrt(va * vb) : 0
}

/**
 * Turns two synchronized PCM streams (mic = "me", system audio = "them") into transcript segments.
 * Speech regions are detected per channel, batched into windows, transcribed one window at a time,
 * then cleaned, de-hallucinated and de-echoed before being emitted.
 */
export class TranscriptionSession {
  private vads: Record<Speaker, ChannelVad>
  private incoming: SpeechRegion[] = []
  private regions: SpeechRegion[] = []
  private queue: AudioWindow[] = []
  private detectedLanguages: string[] = []
  private windowsSent = 0
  /** Mic regions dropped because they were acoustic echo of the system audio. */
  echoRegionsDropped = 0
  private busy = false
  private cancelled = false
  private samples = 0
  private recent: TranscriptSegment[] = []
  private context: string
  private idleWaiters: (() => void)[] = []
  private lastPending = -1
  private diarizeChain: Promise<unknown> = Promise.resolve()
  private lastSpeaker: string | undefined
  private speakerSignature = ''
  /** Remote segments emitted this session, kept for re-labelling after `refine()`. */
  private emitted: { id: string; start: number; end: number; speakerId?: string }[] = []

  constructor(
    private opts: SessionOptions,
    private deps: SessionDeps,
    private policy: FlushPolicy = DEFAULT_FLUSH,
    vadOptions: Partial<VadOptions> = {},
    private diarization?: Diarization
  ) {
    const onRegion = (r: SpeechRegion) => this.incoming.push(r)
    this.vads = { me: new ChannelVad('me', onRegion, vadOptions), them: new ChannelVad('them', onRegion, vadOptions) }
    this.context = opts.context ?? ''
  }

  /** Total samples received (per channel). */
  get sampleCount(): number {
    return this.samples
  }

  push(mic: Int16Array, sys?: Int16Array | null): void {
    if (this.cancelled) return
    this.vads.me.push(mic)
    this.vads.them.push(sys && sys.length === mic.length ? sys : new Int16Array(mic.length))
    this.samples += mic.length
    this.acceptIncoming()
    this.maybeFlush(false)
  }

  private acceptIncoming() {
    for (const r of this.incoming) {
      if (r.channel === 'me' && this.isEchoRegion(r)) {
        this.echoRegionsDropped++
        continue
      }
      if (r.channel === 'them' && this.diarization) r.phrases = this.diarizeRegion(r)
      this.regions.push(r)
    }
    this.incoming = []
  }

  /** Splits a remote region into phrases and works out who speaks each one (in arrival order). */
  private diarizeRegion(r: SpeechRegion): Promise<SpeakerPhrase[]> {
    const { embedder, diarizer } = this.diarization!
    const them = this.vads.them
    const f0 = Math.floor(r.startSample / them.frameSize)
    const levels = Array.from({ length: Math.floor(r.samples.length / them.frameSize) }, (_, i) => them.levelAt(f0 + i))
    const phrases = levels.length ? splitPhrases(r.startSample, levels, (db) => them.isActive(db)) : [{ start: r.startSample, end: r.startSample + r.samples.length }]
    const run = async (): Promise<SpeakerPhrase[]> => {
      const out: SpeakerPhrase[] = []
      for (const p of phrases) {
        let speakerId = this.lastSpeaker
        if ((p.end - p.start) / SAMPLE_RATE >= 0.6 || !speakerId) {
          const pcm = r.samples.subarray(p.start - r.startSample, p.end - r.startSample)
          try {
            const emb = await embedder.embed(Float32Array.from(pcm, (v) => v / 32768))
            speakerId = diarizer.assign(emb, p.start, p.end, this.lastSpeaker)
          } catch (err) {
            this.deps.onError?.(`Speaker separation failed: ${(err as Error).message}`)
          }
        }
        this.lastSpeaker = speakerId
        if (speakerId) out.push({ start: p.start, end: p.end, speakerId })
      }
      return out
    }
    const result = this.diarizeChain.then(run)
    this.diarizeChain = result.catch(() => undefined)
    return result
  }

  private speakerOfWord(win: AudioWindow, phrases: (SpeakerPhrase[] | undefined)[], w: MappedWord): string | undefined {
    const list = phrases[w.part]
    if (win.parts[w.part].channel !== 'them' || !list?.length) return undefined
    const mid = (w.startSample + w.endSample) / 2
    let best = list[0]
    let dist = Infinity
    for (const p of list) {
      const d = mid < p.start ? p.start - mid : mid >= p.end ? mid - p.end : 0
      if (d < dist) {
        dist = d
        best = p
      }
    }
    return best.speakerId
  }

  private reportSpeakers() {
    if (!this.diarization) return
    const speakers = this.diarization.diarizer.toMeetingSpeakers()
    const signature = Object.values(speakers)
      .map((s) => `${s.id}:${s.name ?? ''}`)
      .join('|')
    if (signature === this.speakerSignature) return
    this.speakerSignature = signature
    this.deps.onSpeakers?.(speakers)
  }

  /**
   * A mic region is echo when the system audio was active over the same span and the two level
   * envelopes move together (speakers leaking into the microphone), allowing for up to 500 ms of delay.
   */
  private isEchoRegion(r: SpeechRegion): boolean {
    const { me, them } = this.vads
    const f0 = Math.floor(r.startSample / me.frameSize)
    const n = Math.floor(r.samples.length / me.frameSize)
    if (n < 10) return false
    const mic = Array.from({ length: n }, (_, i) => me.levelAt(f0 + i))
    let best = -1
    let bestLag = 0
    for (let lag = 0; lag <= 25; lag++) {
      const c = pearson(mic, Array.from({ length: n }, (_, i) => them.levelAt(f0 + i - lag)))
      if (c > best) {
        best = c
        bestLag = lag
      }
    }
    let active = 0
    for (let i = 0; i < n; i++) if (them.isActive(them.levelAt(f0 + i - bestLag))) active++
    return active / n >= 0.5 && best >= 0.65
  }

  /** Auto-detects the language until two consecutive windows agree, then locks it (re-checking every 4th window). */
  private nextLanguage(): { language: string; auto: boolean } {
    if (this.opts.language && this.opts.language !== 'auto') return { language: this.opts.language, auto: false }
    const [a, b] = this.detectedLanguages.slice(-2)
    if (a && a === b && this.windowsSent % 4 !== 0) return { language: a, auto: false }
    return { language: 'auto', auto: true }
  }

  private maybeFlush(force: boolean) {
    if (this.regions.length) {
      const oldest = Math.min(...this.regions.map((r) => r.startSample))
      const age = (this.samples - oldest) / SAMPLE_RATE
      const waiting = this.regions.reduce((n, r) => n + r.samples.length + WINDOW_OPTIONS.gapSamples, 0) / SAMPLE_RATE
      const scale = this.busy || this.queue.length ? 1.5 : 1
      const quiet = !this.vads.me.speaking && !this.vads.them.speaking
      const p = this.policy
      if (force || waiting >= p.targetSeconds || (quiet && age >= p.quietLatencySeconds * scale) || age >= p.maxLatencySeconds * scale) {
        this.queue.push(...packWindows(this.regions))
        this.regions = []
        void this.pump()
      }
    }
    this.reportPending()
  }

  private reportPending() {
    const queued = this.queue.reduce((n, w) => n + windowSpeechSeconds(w), 0)
    const waiting = this.regions.reduce((n, r) => n + r.samples.length, 0) / SAMPLE_RATE
    const seconds = Math.round(queued + waiting)
    if (seconds !== this.lastPending) {
      this.lastPending = seconds
      this.deps.onPending?.(seconds)
    }
  }

  private async pump() {
    if (this.busy) return
    this.busy = true
    try {
      while (this.queue.length && !this.cancelled) {
        const win = this.queue[0]
        try {
          await this.handleResult(win, await this.transcribeWithRetry(win))
        } catch (err) {
          if (!this.cancelled) this.deps.onError?.(`Part of the transcript could not be processed: ${(err as Error).message}`)
        }
        this.queue.shift()
        this.reportPending()
      }
    } finally {
      this.busy = false
      this.reportPending()
      if (!this.queue.length) {
        const waiters = this.idleWaiters
        this.idleWaiters = []
        waiters.forEach((w) => w())
      }
    }
  }

  private async transcribeWithRetry(win: AudioWindow): Promise<WhisperResult> {
    const wav = encodeWav(win.audio)
    const { language, auto } = this.nextLanguage()
    this.windowsSent++
    const params = { language, prompt: buildPrompt(this.opts.vocabulary, this.context) }
    const delays = [1000, 3000, 8000]
    for (let attempt = 0; ; attempt++) {
      try {
        const started = Date.now()
        const result = await this.deps.transcribe(wav, params)
        if (auto && result.language && result.segments.length) {
          this.detectedLanguages = [...this.detectedLanguages, result.language].slice(-3)
        }
        this.deps.onWindow?.({
          speechSeconds: windowSpeechSeconds(win),
          ms: Date.now() - started,
          language: result.language ?? '?',
          requested: language,
          segments: result.segments.length
        })
        return result
      } catch (err) {
        if (this.cancelled || attempt >= delays.length) throw err
        await sleep(delays[attempt])
      }
    }
  }

  private async handleResult(win: AudioWindow, result: WhisperResult) {
    const toMs = (sample: number) => Math.round(this.opts.timeBaseMs + (sample / SAMPLE_RATE) * 1000)
    const phrases = await Promise.all(win.parts.map((p) => p.region.phrases?.catch(() => undefined)))
    const fresh: TranscriptSegment[] = []
    const samplesById = new Map<string, [number, number]>()
    for (const u of groupWords(mapWords(result, win), win, (w) => this.speakerOfWord(win, phrases, w))) {
      const text = cleanTranscriptText(u.text)
      if (!text) continue
      const durationMs = Math.max(((u.endSample - u.startSample) / SAMPLE_RATE) * 1000, u.speechMs)
      if (isHallucination(text, { durationMs, probability: u.probability })) continue
      const id = randomUUID()
      samplesById.set(id, [u.startSample, u.endSample])
      fresh.push({ id, speaker: u.channel, speakerId: u.speakerId, text, start: toMs(u.startSample), end: toMs(u.endSample), language: result.language })
    }
    this.reportSpeakers()

    const theirs = [...this.recent, ...fresh].filter((s) => s.speaker === 'them')
    const added = fresh.filter((s) => s.speaker === 'them' || !theirs.some((t) => isEcho(s, t)))
    const removed = this.recent
      .filter((s) => s.speaker === 'me' && added.some((t) => t.speaker === 'them' && isEcho(s, t)))
      .map((s) => s.id)

    const latest = Math.max(0, ...added.map((s) => s.end), ...this.recent.map((s) => s.end))
    this.recent = [...this.recent.filter((s) => !removed.includes(s.id)), ...added]
      .filter((s) => s.end >= latest - 90_000)
      .sort((a, b) => a.start - b.start)
    this.context = this.recent.map((s) => s.text).join(' ').slice(-400)
    for (const s of added) {
      const range = samplesById.get(s.id)
      if (s.speaker === 'them' && range) this.emitted.push({ id: s.id, start: range[0], end: range[1], speakerId: s.speakerId })
    }
    this.emitted = this.emitted.filter((e) => !removed.includes(e.id))
    if (added.length || removed.length) this.deps.onSegments(added, removed)
  }

  /** Re-clusters speakers now that the whole session was heard, and re-labels segments that changed. */
  private finishSpeakers() {
    if (!this.diarization) return
    const { diarizer } = this.diarization
    diarizer.refine()
    const relabeled: Record<string, string> = {}
    for (const e of this.emitted) {
      const id = diarizer.speakerAt(e.start, e.end)
      if (id && id !== e.speakerId) {
        relabeled[e.id] = id
        e.speakerId = id
      }
    }
    const speakers = diarizer.toMeetingSpeakers()
    this.speakerSignature = ''
    this.deps.onRelabel?.(relabeled, speakers)
  }

  /** Flushes remaining audio and resolves once everything has been transcribed. */
  async stop(): Promise<void> {
    this.vads.me.flush()
    this.vads.them.flush()
    this.acceptIncoming()
    this.maybeFlush(true)
    if (this.busy || this.queue.length) await new Promise<void>((resolve) => this.idleWaiters.push(resolve))
    await this.diarizeChain
    if (!this.cancelled) this.finishSpeakers()
  }

  /** Renames a speaker in the live clustering so later updates keep the name. */
  setSpeakerName(id: string, name: string | undefined, source: 'manual' | 'ai', voiceId?: string): void {
    this.diarization?.diarizer.setName(id, name, source, voiceId)
    this.speakerSignature = ''
  }

  cancel(): void {
    this.cancelled = true
    this.queue = []
    this.regions = []
    const waiters = this.idleWaiters
    this.idleWaiters = []
    waiters.forEach((w) => w())
  }
}
