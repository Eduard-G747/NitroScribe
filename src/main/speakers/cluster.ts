import type { MeetingSpeaker, SpeakerNameSource } from '@shared/types'

const SR = 16000

export function normalize(v: ArrayLike<number>): Float32Array {
  let n = 0
  for (let i = 0; i < v.length; i++) n += v[i] * v[i]
  const inv = n > 0 ? 1 / Math.sqrt(n) : 0
  return Float32Array.from(v as ArrayLike<number>, (x) => x * inv)
}

export function dot(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let s = 0
  for (let i = 0; i < a.length; i++) s += a[i] * b[i]
  return s
}

export interface Phrase {
  /** Session-timeline samples. */
  start: number
  end: number
}

export interface PhraseOptions {
  frameSize: number
  /** Quiet frames that separate two phrases (likely speaker turns). */
  pauseFrames: number
  /** Phrases shorter than this are merged into a neighbour. */
  minFrames: number
  /** Phrases longer than this are cut into pieces of about `pieceFrames`. */
  maxFrames: number
  pieceFrames: number
}

export const PHRASE_OPTIONS: PhraseOptions = { frameSize: 320, pauseFrames: 8, minFrames: 30, maxFrames: 300, pieceFrames: 150 }

/**
 * Splits a speech region into phrases at short pauses, so each phrase most likely has one speaker.
 * The phrases tile the whole region (every sample belongs to exactly one phrase).
 */
export function splitPhrases(startSample: number, levels: number[], active: (db: number) => boolean, opts: PhraseOptions = PHRASE_OPTIONS): Phrase[] {
  const n = levels.length
  const regionEnd = startSample + n * opts.frameSize
  let first = 0
  let last = n - 1
  while (first < n && !active(levels[first])) first++
  while (last > first && !active(levels[last])) last--
  if (first >= n) return [{ start: startSample, end: regionEnd }]

  const pieces: [number, number][] = []
  let a = first
  let quiet = 0
  for (let i = first; i <= last; i++) {
    if (active(levels[i])) {
      if (quiet >= opts.pauseFrames) {
        pieces.push([a, i - quiet])
        a = i
      }
      quiet = 0
    } else {
      quiet++
    }
  }
  pieces.push([a, last + 1])

  const merged: [number, number][] = []
  for (const p of pieces) {
    const prev = merged[merged.length - 1]
    if (prev && (p[1] - p[0] < opts.minFrames || prev[1] - prev[0] < opts.minFrames)) prev[1] = p[1]
    else merged.push([p[0], p[1]])
  }

  const out: Phrase[] = []
  for (const [s, e] of merged) {
    const len = e - s
    const parts = len > opts.maxFrames ? Math.round(len / opts.pieceFrames) : 1
    for (let k = 0; k < parts; k++) {
      out.push({
        start: startSample + (s + Math.floor((len * k) / parts)) * opts.frameSize,
        end: startSample + (s + Math.floor((len * (k + 1)) / parts)) * opts.frameSize
      })
    }
  }
  out[0].start = startSample
  out[out.length - 1].end = regionEnd
  for (let i = 1; i < out.length; i++) {
    const mid = Math.round((out[i - 1].end + out[i].start) / 2)
    out[i - 1].end = mid
    out[i].start = mid
  }
  return out
}

export interface Voiceprint {
  id: string
  name: string
  embedding: number[]
}

export const SPEAKER_THRESHOLDS = {
  /** Cosine similarity to a speaker's centroid needed to join them. */
  join: 0.45,
  /** Short phrases may join a speaker with this weaker similarity. */
  weakJoin: 0.3,
  /** Only phrases at least this long (s) may introduce a new speaker. */
  newMinSeconds: 1.2,
  /** Similarity to a remembered voice needed to put a name on a new speaker. */
  voice: 0.55,
  /** Speakers whose centroids are this similar are merged at the end. */
  merge: 0.5,
  /** A phrase moves to another speaker at the end if it fits them this much better. */
  reassignMargin: 0.08
}

interface ClusterSpeaker {
  id: string
  sum: Float32Array
  weight: number
  name?: string
  nameSource?: SpeakerNameSource
  voiceId?: string
}

interface Chunk {
  start: number
  end: number
  emb: Float32Array
  speakerId: string
}

const SOURCE_RANK: Record<SpeakerNameSource, number> = { manual: 3, voice: 2, ai: 1 }

/**
 * Online speaker clustering: each phrase embedding joins the most similar speaker or starts a new one.
 * `refine()` merges look-alike speakers and fixes early mistakes once the whole meeting has been heard.
 */
export class OnlineDiarizer {
  private speakers: ClusterSpeaker[] = []
  private chunks: Chunk[] = []
  private nextIndex = 1

  constructor(
    existing: MeetingSpeaker[] = [],
    private voices: Voiceprint[] = []
  ) {
    for (const s of existing) {
      const n = Number(/^s(\d+)$/.exec(s.id)?.[1] ?? 0)
      this.nextIndex = Math.max(this.nextIndex, n + 1)
      if (!s.embedding?.length) continue
      const c = normalize(s.embedding)
      this.speakers.push({ id: s.id, sum: c.map((x) => x * 3), weight: 3, name: s.name, nameSource: s.nameSource, voiceId: s.voiceId })
    }
  }

  private centroid(s: ClusterSpeaker): Float32Array {
    return normalize(s.sum)
  }

  private closest(e: Float32Array, exclude?: string): { speaker: ClusterSpeaker | null; sim: number } {
    let speaker: ClusterSpeaker | null = null
    let sim = -1
    for (const s of this.speakers) {
      if (s.id === exclude || s.weight <= 0) continue
      const v = dot(e, this.centroid(s))
      if (v > sim) {
        sim = v
        speaker = s
      }
    }
    return { speaker, sim }
  }

  /** Assigns one phrase and returns its speaker id. */
  assign(embedding: ArrayLike<number>, start: number, end: number, previous?: string): string {
    const T = SPEAKER_THRESHOLDS
    const e = normalize(embedding)
    const seconds = (end - start) / SR
    const { speaker: best, sim } = this.closest(e)
    let target: ClusterSpeaker
    if (best && sim >= T.join) target = best
    else if (seconds >= T.newMinSeconds || !best) target = this.create(e)
    else if (sim >= T.weakJoin) target = best
    else target = this.speakers.find((s) => s.id === previous) ?? best
    const w = Math.min(1, seconds / 2)
    for (let i = 0; i < e.length; i++) target.sum[i] += e[i] * w
    target.weight += w
    this.chunks.push({ start, end, emb: e, speakerId: target.id })
    return target.id
  }

  private create(e: Float32Array): ClusterSpeaker {
    let voice: Voiceprint | null = null
    let best = -1
    for (const v of this.voices) {
      const sim = dot(e, normalize(v.embedding))
      if (sim > best) {
        best = sim
        voice = v
      }
    }
    const known = voice && best >= SPEAKER_THRESHOLDS.voice ? voice : null
    if (known) {
      const already = this.speakers.find((s) => s.voiceId === known.id)
      if (already) return already
    }
    const s: ClusterSpeaker = { id: `s${this.nextIndex++}`, sum: new Float32Array(e.length), weight: 0 }
    if (known) Object.assign(s, { name: known.name, voiceId: known.id, nameSource: 'voice' as const })
    this.speakers.push(s)
    return s
  }

  /** Applies a name chosen by the user (or the AI) to a speaker. */
  setName(id: string, name: string | undefined, source: SpeakerNameSource, voiceId?: string): void {
    const s = this.speakers.find((x) => x.id === id)
    if (!s) return
    s.name = name
    s.nameSource = name ? source : undefined
    if (voiceId) s.voiceId = voiceId
  }

  /** Merges look-alike speakers and moves phrases that clearly fit another speaker better. */
  refine(): void {
    const T = SPEAKER_THRESHOLDS
    for (;;) {
      let pair: [ClusterSpeaker, ClusterSpeaker] | null = null
      let bestSim = T.merge
      for (let i = 0; i < this.speakers.length; i++) {
        for (let j = i + 1; j < this.speakers.length; j++) {
          const a = this.speakers[i]
          const b = this.speakers[j]
          if (a.weight <= 0 || b.weight <= 0) continue
          if (a.nameSource === 'manual' && b.nameSource === 'manual' && a.name !== b.name) continue
          const sim = dot(this.centroid(a), this.centroid(b))
          if (sim >= bestSim) {
            bestSim = sim
            pair = [a, b]
          }
        }
      }
      if (!pair) break
      const rank = (s: ClusterSpeaker) => (s.nameSource ? SOURCE_RANK[s.nameSource] * 1000 : 0) + s.weight
      const [keep, drop] = rank(pair[0]) >= rank(pair[1]) ? pair : [pair[1], pair[0]]
      for (let i = 0; i < keep.sum.length; i++) keep.sum[i] += drop.sum[i]
      keep.weight += drop.weight
      if (!keep.name && drop.name) Object.assign(keep, { name: drop.name, nameSource: drop.nameSource, voiceId: drop.voiceId })
      for (const c of this.chunks) if (c.speakerId === drop.id) c.speakerId = keep.id
      this.speakers = this.speakers.filter((s) => s !== drop)
    }
    const centroids = this.speakers.filter((s) => s.weight > 0).map((s) => ({ s, c: this.centroid(s) }))
    for (const chunk of this.chunks) {
      if ((chunk.end - chunk.start) / SR < 1) continue
      const own = centroids.find((x) => x.s.id === chunk.speakerId)
      if (!own) continue
      let best = own
      let bestSim = dot(chunk.emb, own.c) + T.reassignMargin
      for (const x of centroids) {
        const sim = dot(chunk.emb, x.c)
        if (sim > bestSim) {
          bestSim = sim
          best = x
        }
      }
      chunk.speakerId = best.s.id
    }
  }

  /** The speaker who talks the most within [start, end) (session samples). */
  speakerAt(start: number, end: number): string | undefined {
    const totals = new Map<string, number>()
    for (const c of this.chunks) {
      const overlap = Math.min(end, c.end) - Math.max(start, c.start)
      if (overlap > 0) totals.set(c.speakerId, (totals.get(c.speakerId) ?? 0) + overlap)
    }
    let best: string | undefined
    let max = 0
    for (const [id, v] of totals) {
      if (v > max) {
        max = v
        best = id
      }
    }
    return best
  }

  toMeetingSpeakers(): Record<string, MeetingSpeaker> {
    const out: Record<string, MeetingSpeaker> = {}
    for (const s of this.speakers) {
      if (s.weight <= 0) continue
      out[s.id] = {
        id: s.id,
        name: s.name,
        nameSource: s.nameSource,
        voiceId: s.voiceId,
        embedding: Array.from(this.centroid(s), (x) => Math.round(x * 1e5) / 1e5)
      }
    }
    return out
  }
}
