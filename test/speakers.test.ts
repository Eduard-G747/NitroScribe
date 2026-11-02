import { describe, expect, it } from 'vitest'
import { remoteSpeakers, speakerNamer, mergeTurns } from '@shared/format'
import type { TranscriptSegment } from '@shared/types'
import { OnlineDiarizer, normalize, splitPhrases } from '../src/main/speakers/cluster'
import { mergeSpeakerMaps } from '../src/main/store/meetings'

const SR = 16000
let seed = 7
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 2

/** A fake voice: a fixed random direction; each utterance adds noise. */
const voice = () => Float32Array.from({ length: 192 }, rand)
const sample = (v: Float32Array, noise = 0.6) => normalize(Float32Array.from(v, (x) => x + noise * rand()))

describe('splitPhrases', () => {
  const active = (db: number) => db > -40
  it('splits at pauses and tiles the region', () => {
    const levels = [...Array(10).fill(-60), ...Array(80).fill(-20), ...Array(12).fill(-60), ...Array(60).fill(-20), ...Array(10).fill(-60)]
    const phrases = splitPhrases(1000, levels, active)
    expect(phrases).toHaveLength(2)
    expect(phrases[0].start).toBe(1000)
    expect(phrases[1].end).toBe(1000 + levels.length * 320)
    expect(phrases[0].end).toBe(phrases[1].start)
  })
  it('merges tiny phrases and cuts long ones', () => {
    const short = [...Array(80).fill(-20), ...Array(10).fill(-60), ...Array(10).fill(-20)]
    expect(splitPhrases(0, short, active)).toHaveLength(1)
    const long = Array(700).fill(-20)
    const pieces = splitPhrases(0, long, active)
    expect(pieces.length).toBeGreaterThanOrEqual(4)
    for (const p of pieces) expect((p.end - p.start) / 320).toBeLessThanOrEqual(300)
  })
})

describe('OnlineDiarizer', () => {
  it('separates three voices', () => {
    const voices = [voice(), voice(), voice()]
    const d = new OnlineDiarizer()
    const truth: number[] = []
    const got: string[] = []
    for (let i = 0; i < 30; i++) {
      const who = [0, 1, 2, 1, 0, 2][i % 6]
      truth.push(who)
      got.push(d.assign(sample(voices[who]), i * 3 * SR, (i * 3 + 2) * SR))
    }
    d.refine()
    const ids = new Set(got)
    expect(ids.size).toBe(3)
    for (let i = 0; i < got.length; i++) for (let j = 0; j < got.length; j++) expect(got[i] === got[j]).toBe(truth[i] === truth[j])
  })

  it('recognizes remembered voices by name', () => {
    const ana = voice()
    const d = new OnlineDiarizer([], [{ id: 'v1', name: 'Ana', embedding: Array.from(normalize(ana)) }])
    const id = d.assign(sample(ana, 0.4), 0, 2 * SR)
    const speakers = d.toMeetingSpeakers()
    expect(speakers[id]).toMatchObject({ name: 'Ana', nameSource: 'voice', voiceId: 'v1' })
  })

  it('continues the numbering and centroids of an earlier recording', () => {
    const v = voice()
    const first = new OnlineDiarizer()
    const id = first.assign(sample(v), 0, 2 * SR)
    const saved = Object.values(first.toMeetingSpeakers())
    const second = new OnlineDiarizer(saved)
    expect(second.assign(sample(v), 0, 2 * SR)).toBe(id)
    expect(second.assign(sample(voice()), 3 * SR, 6 * SR)).toBe('s2')
  })

  it('merges a speaker that was split in two and relabels by overlap', () => {
    const v = voice()
    const d = new OnlineDiarizer()
    const a = d.assign(sample(v, 0.2), 0, 2 * SR)
    // force a second cluster for the same voice
    ;(d as unknown as { create: (e: Float32Array) => { id: string } }).create(sample(v, 0.2))
    d.assign(sample(v, 0.2), 3 * SR, 5 * SR)
    d.refine()
    expect(Object.keys(d.toMeetingSpeakers())).toEqual([a])
    expect(d.speakerAt(3 * SR, 5 * SR)).toBe(a)
  })
})

describe('speaker names', () => {
  const seg = (speaker: 'me' | 'them', start: number, speakerId?: string, text = 'x'): TranscriptSegment => ({ id: `${start}`, speaker, speakerId, start, end: start + 500, text })

  it('names by manual > voice > ai precedence when merging', () => {
    const merged = mergeSpeakerMaps({ s1: { id: 's1', name: 'Ana', nameSource: 'manual' }, s2: { id: 's2', name: 'Bob', nameSource: 'ai' } }, {
      s1: { id: 's1', name: 'Wrong', nameSource: 'voice', embedding: [1] },
      s2: { id: 's2', name: 'Robert', nameSource: 'voice' },
      s3: { id: 's3' }
    })
    expect(merged.s1).toMatchObject({ name: 'Ana', nameSource: 'manual', embedding: [1] })
    expect(merged.s2).toMatchObject({ name: 'Robert', nameSource: 'voice' })
    expect(merged.s3.name).toBeUndefined()
  })

  it('numbers unnamed speakers by first appearance and merges turns per person', () => {
    const meeting = {
      transcript: [seg('them', 3000, 's7', 'hello'), seg('me', 1000, undefined, 'hi'), seg('them', 5000, 's2', 'yo'), seg('them', 5600, 's2', 'there'), seg('them', 9000, 's9')],
      speakers: { s9: { id: 's9', name: 'Carla' } }
    }
    const name = speakerNamer(meeting, 'Eduardo')
    expect(name({ speaker: 'me' })).toBe('Eduardo')
    expect(name({ speaker: 'them', speakerId: 's7' })).toBe('Speaker 1')
    expect(name({ speaker: 'them', speakerId: 's2' })).toBe('Speaker 2')
    expect(name({ speaker: 'them', speakerId: 's9' })).toBe('Carla')
    expect(name({ speaker: 'them' })).toBe('Them')
    expect(mergeTurns(meeting.transcript, name).map((t) => `${t.name}: ${t.text}`)).toEqual(['Eduardo: hi', 'Speaker 1: hello', 'Speaker 2: yo there', 'Carla: x'])
    expect(remoteSpeakers(meeting).map((s) => [s.id, s.name, s.named])).toEqual([
      ['s7', 'Speaker 1', false],
      ['s2', 'Speaker 2', false],
      ['s9', 'Carla', true]
    ])
  })
})
