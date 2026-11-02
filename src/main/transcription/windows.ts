import type { Speaker } from '@shared/types'
import type { WhisperResult } from '../whisper/manager'
import type { SpeechRegion } from './vad'
import { SAMPLE_RATE } from './wav'

export interface WindowPart {
  channel: Speaker
  /** Session-timeline index of the part's first sample. */
  startSample: number
  /** Where the part starts inside the window audio. */
  offset: number
  length: number
  speechFrames: number
  /** The region this part was built from. */
  region: SpeechRegion
}

export interface AudioWindow {
  audio: Int16Array
  parts: WindowPart[]
}

export interface WindowOptions {
  leadSamples: number
  gapSamples: number
  tailSamples: number
  maxSamples: number
}

// Regions already carry ~300 ms of padding on each side, so only a short gap is added between them.
// Keeping silence short matters: Whisper's timestamps drift across long silent stretches.
export const WINDOW_OPTIONS: WindowOptions = {
  leadSamples: Math.round(0.1 * SAMPLE_RATE),
  gapSamples: Math.round(0.2 * SAMPLE_RATE),
  tailSamples: Math.round(0.3 * SAMPLE_RATE),
  maxSamples: 28 * SAMPLE_RATE
}

/**
 * Packs speech regions from both channels, in chronological order, into ≤28 s windows separated by
 * short silences. One Whisper pass per window keeps the GPU cost low while preserving who said what.
 */
export function packWindows(regions: SpeechRegion[], opts: WindowOptions = WINDOW_OPTIONS): AudioWindow[] {
  const sorted = [...regions].sort((a, b) => a.startSample - b.startSample || (a.channel === 'me' ? -1 : 1))
  const windows: AudioWindow[] = []
  let current: SpeechRegion[] = []
  let size = 0
  for (const r of sorted) {
    const add = r.samples.length + (current.length ? opts.gapSamples : 0)
    if (current.length && opts.leadSamples + size + add + opts.tailSamples > opts.maxSamples) {
      windows.push(buildWindow(current, opts))
      current = []
      size = 0
    }
    size += r.samples.length + (current.length ? opts.gapSamples : 0)
    current.push(r)
  }
  if (current.length) windows.push(buildWindow(current, opts))
  return windows
}

function buildWindow(regions: SpeechRegion[], opts: WindowOptions): AudioWindow {
  const body = regions.reduce((n, r) => n + r.samples.length, 0) + opts.gapSamples * (regions.length - 1)
  const audio = new Int16Array(opts.leadSamples + body + opts.tailSamples)
  let offset = opts.leadSamples
  const parts = regions.map((r, i) => {
    if (i) offset += opts.gapSamples
    audio.set(r.samples, offset)
    const part: WindowPart = { channel: r.channel, startSample: r.startSample, offset, length: r.samples.length, speechFrames: r.speechFrames, region: r }
    offset += r.samples.length
    return part
  })
  return { audio, parts }
}

export function windowSpeechSeconds(win: AudioWindow): number {
  return win.parts.reduce((n, p) => n + p.length, 0) / SAMPLE_RATE
}

export interface MappedWord {
  part: number
  text: string
  /** Session-timeline samples. */
  startSample: number
  endSample: number
  probability: number
}

export interface Utterance {
  channel: Speaker
  speakerId?: string
  text: string
  startSample: number
  endSample: number
  probability: number
  speechMs: number
}

const SPECIAL_TOKEN = /^\s*\[_?[A-Z_]+_?\]\s*$/

/**
 * Maps Whisper's words back to the window parts (and therefore to channel + session time).
 * Word timestamps are re-projected onto their segment's span, which keeps them consistent with segment
 * timestamps (the two can disagree, e.g. if whisper.cpp's own VAD is enabled).
 */
export function mapWords(result: WhisperResult, win: AudioWindow): MappedWord[] {
  const partAt = (sec: number) => {
    const s = sec * SAMPLE_RATE
    let best = 0
    let bestDist = Infinity
    win.parts.forEach((p, i) => {
      const d = s < p.offset ? p.offset - s : s > p.offset + p.length ? s - (p.offset + p.length) : 0
      if (d < bestDist) {
        bestDist = d
        best = i
      }
    })
    return best
  }
  const overlap = (a0: number, a1: number, p: WindowPart) =>
    Math.max(0, Math.min(a1, (p.offset + p.length) / SAMPLE_RATE) - Math.max(a0, p.offset / SAMPLE_RATE))
  const toSession = (i: number, sec: number) => {
    const p = win.parts[i]
    return p.startSample + Math.min(p.length, Math.max(0, Math.round(sec * SAMPLE_RATE) - p.offset))
  }
  const out: MappedWord[] = []
  const push = (part: number, text: string, start: number, end: number, probability: number) =>
    out.push({ part, text, startSample: toSession(part, start), endSample: Math.max(toSession(part, end), toSession(part, start)), probability })

  for (const seg of result.segments) {
    const words = (seg.words ?? []).filter((w) => w.word && !SPECIAL_TOKEN.test(w.word))
    const s0 = seg.start
    const s1 = Math.max(seg.end, seg.start + 0.01)
    if (!words.length) {
      if (seg.text?.trim()) push(partAt((s0 + s1) / 2), seg.text, s0, s1, Math.exp(seg.avg_logprob ?? 0))
      continue
    }
    const c0 = words[0].start
    const c1 = Math.max(words[words.length - 1].end, c0 + 0.01)
    const project = (t: number) => s0 + ((Math.min(Math.max(t, c0), c1) - c0) / (c1 - c0)) * (s1 - s0)
    const overlaps = win.parts.map((p) => overlap(s0, s1, p))
    const best = overlaps.indexOf(Math.max(...overlaps))
    const single = overlaps[best] >= 0.8 * (s1 - s0) || overlaps.filter((o) => o > 0.15).length <= 1
    for (const w of words) {
      const start = project(w.start)
      const end = project(w.end)
      push(single && overlaps[best] > 0 ? best : partAt((start + end) / 2), w.word, start, end, w.probability)
    }
  }
  return out
}

/** Groups consecutive words that share a part and speaker into utterances. */
export function groupWords(words: MappedWord[], win: AudioWindow, speakerOf: (w: MappedWord) => string | undefined = () => undefined): Utterance[] {
  const sorted = [...words].sort((a, b) => a.part - b.part || a.startSample - b.startSample)
  const out: (Utterance & { part: number; probs: number[] })[] = []
  for (const w of sorted) {
    const speakerId = speakerOf(w)
    const last = out[out.length - 1]
    if (last && last.part === w.part && last.speakerId === speakerId) {
      last.text += w.text
      last.endSample = Math.max(last.endSample, w.endSample)
      last.probs.push(w.probability)
    } else {
      const p = win.parts[w.part]
      out.push({ part: w.part, channel: p.channel, speakerId, text: w.text, startSample: w.startSample, endSample: w.endSample, probability: 0, speechMs: p.speechFrames * 20, probs: [w.probability] })
    }
  }
  return out.map(({ part: _part, probs, ...u }) => ({ ...u, probability: probs.reduce((x, y) => x + y, 0) / probs.length }))
}

/** One utterance per window part (no speaker separation). */
export function mapResult(result: WhisperResult, win: AudioWindow): Utterance[] {
  return groupWords(mapWords(result, win), win)
}
