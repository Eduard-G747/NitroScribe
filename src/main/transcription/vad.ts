import type { Speaker } from '@shared/types'

export interface SpeechRegion {
  channel: Speaker
  /** Index of the first sample on the session timeline. */
  startSample: number
  samples: Int16Array
  speechFrames: number
  /** Who speaks when inside the region (filled in by speaker separation). */
  phrases?: Promise<SpeakerPhrase[]>
}

export interface SpeakerPhrase {
  start: number
  end: number
  speakerId: string
}

export interface VadOptions {
  frameSize: number
  /** Frames of consecutive speech needed to open a region. */
  onsetFrames: number
  /** Frames of audio kept before the onset. */
  prerollFrames: number
  /** Frames of silence that close a region. */
  hangoverFrames: number
  /** Frames of silence kept after the last speech frame. */
  postrollFrames: number
  /** Regions with fewer speech frames than this are discarded as noise. */
  minSpeechFrames: number
  /** Regions are force-split once they reach this many frames. */
  maxRegionFrames: number
  /** dB above the noise floor that counts as speech. */
  snrDb: number
  /** Absolute minimum level (dBFS) that counts as speech. */
  minDb: number
}

export const DEFAULT_VAD: VadOptions = {
  frameSize: 320, // 20 ms at 16 kHz
  onsetFrames: 3,
  prerollFrames: 15,
  hangoverFrames: 30,
  postrollFrames: 15,
  minSpeechFrames: 12,
  maxRegionFrames: 1250, // 25 s
  snrDb: 10,
  minDb: -52
}

const BLOCK_FRAMES = 25
const BLOCKS = 8
const HISTORY_FRAMES = 6000 // 2 minutes of per-frame levels

export function frameDb(samples: Int16Array, start: number, length: number): number {
  let sum = 0
  for (let i = start; i < start + length; i++) {
    const v = samples[i] / 32768
    sum += v * v
  }
  return 10 * Math.log10(sum / length + 1e-12)
}

/**
 * Energy-based voice activity detector for one channel. Tracks the noise floor with
 * minimum statistics over the last ~4 s and emits padded speech regions.
 */
export class ChannelVad {
  private opts: VadOptions
  private carry = new Int16Array(0)
  private frameIndex = 0
  private history: { frame: Int16Array; db: number }[] = []
  private blockMins: number[] = []
  private blockMin = Infinity
  private blockCount = 0
  private speechRun = 0
  private levels = new Float32Array(HISTORY_FRAMES).fill(-120)
  private region: { startFrame: number; frames: Int16Array[]; dbs: number[]; speechFrames: number; silentRun: number } | null = null

  constructor(
    readonly channel: Speaker,
    private onRegion: (region: SpeechRegion) => void,
    opts: Partial<VadOptions> = {}
  ) {
    this.opts = { ...DEFAULT_VAD, ...opts }
  }

  get speaking(): boolean {
    return !!this.region
  }

  get openRegionStartSample(): number | null {
    return this.region ? this.region.startFrame * this.opts.frameSize : null
  }

  get noiseFloor(): number {
    const mins = [...this.blockMins, this.blockMin].filter(Number.isFinite)
    return mins.length ? Math.min(...mins) : -70
  }

  get frameSize(): number {
    return this.opts.frameSize
  }

  /** Level (dBFS) of a past frame, or -120 if it is out of the history window. */
  levelAt(frame: number): number {
    if (frame < 0 || frame >= this.frameIndex || frame < this.frameIndex - HISTORY_FRAMES) return -120
    return this.levels[frame % HISTORY_FRAMES]
  }

  isActive(db: number): boolean {
    return db > Math.max(this.noiseFloor + this.opts.snrDb, this.opts.minDb)
  }

  push(samples: Int16Array): void {
    const { frameSize } = this.opts
    let data = samples
    if (this.carry.length) {
      data = new Int16Array(this.carry.length + samples.length)
      data.set(this.carry)
      data.set(samples, this.carry.length)
    }
    let offset = 0
    for (; offset + frameSize <= data.length; offset += frameSize) {
      this.processFrame(data.slice(offset, offset + frameSize))
    }
    this.carry = data.slice(offset)
  }

  private processFrame(frame: Int16Array) {
    const o = this.opts
    const db = frameDb(frame, 0, frame.length)
    const floor = this.noiseFloor
    this.trackFloor(db)
    const isSpeech = db > Math.max(floor + o.snrDb, o.minDb)
    this.levels[this.frameIndex % HISTORY_FRAMES] = db
    const index = this.frameIndex++

    if (this.region) {
      const r = this.region
      r.frames.push(frame)
      r.dbs.push(db)
      if (isSpeech) {
        r.speechFrames++
        r.silentRun = 0
      } else {
        r.silentRun++
      }
      if (r.silentRun >= o.hangoverFrames) this.closeRegion(r.silentRun - o.postrollFrames)
      else if (r.frames.length >= o.maxRegionFrames) this.splitRegion()
    } else {
      this.speechRun = isSpeech ? this.speechRun + 1 : 0
      this.history.push({ frame, db })
      if (this.history.length > o.prerollFrames + o.onsetFrames) this.history.shift()
      if (this.speechRun >= o.onsetFrames) {
        const frames = this.history.map((h) => h.frame)
        this.region = {
          startFrame: index - frames.length + 1,
          frames,
          dbs: this.history.map((h) => h.db),
          speechFrames: this.speechRun,
          silentRun: 0
        }
        this.history = []
        this.speechRun = 0
      }
    }
  }

  private trackFloor(db: number) {
    this.blockMin = Math.min(this.blockMin, db)
    if (++this.blockCount >= BLOCK_FRAMES) {
      this.blockMins.push(this.blockMin)
      if (this.blockMins.length > BLOCKS) this.blockMins.shift()
      this.blockMin = Infinity
      this.blockCount = 0
    }
  }

  private emit(startFrame: number, frames: Int16Array[], speechFrames: number) {
    if (speechFrames < this.opts.minSpeechFrames || !frames.length) return
    const samples = new Int16Array(frames.length * this.opts.frameSize)
    frames.forEach((f, i) => samples.set(f, i * this.opts.frameSize))
    this.onRegion({ channel: this.channel, startSample: startFrame * this.opts.frameSize, samples, speechFrames })
  }

  /** Closes the open region, dropping `trimFrames` trailing silent frames. */
  private closeRegion(trimFrames = 0) {
    const r = this.region
    if (!r) return
    this.region = null
    const keep = r.frames.slice(0, Math.max(0, r.frames.length - Math.max(0, trimFrames)))
    this.emit(r.startFrame, keep, r.speechFrames)
  }

  /** Splits an over-long region at the quietest frame of its last second, keeping the rest open. */
  private splitRegion() {
    const r = this.region!
    const searchFrom = Math.max(1, r.frames.length - 50)
    let cut = r.frames.length - 1
    for (let i = searchFrom; i < r.frames.length; i++) if (r.dbs[i] < r.dbs[cut]) cut = i
    const head = r.frames.slice(0, cut)
    const headSpeech = Math.round((r.speechFrames * head.length) / r.frames.length)
    this.emit(r.startFrame, head, Math.max(headSpeech, this.opts.minSpeechFrames))
    this.region = {
      startFrame: r.startFrame + cut,
      frames: r.frames.slice(cut),
      dbs: r.dbs.slice(cut),
      speechFrames: r.speechFrames - headSpeech,
      silentRun: r.silentRun
    }
  }

  /** Discards any partially processed audio and open region without emitting it. */
  reset(): void {
    this.region = null
    this.history = []
    this.speechRun = 0
    this.carry = new Int16Array(0)
  }

  /** Emits any open region (e.g. when recording stops). */
  flush(): void {
    if (this.region) this.closeRegion(Math.max(0, this.region.silentRun - this.opts.postrollFrames))
    this.speechRun = 0
    this.history = []
  }
}
