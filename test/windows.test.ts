import { describe, expect, it } from 'vitest'
import type { SpeechRegion } from '../src/main/transcription/vad'
import { WINDOW_OPTIONS, mapResult, packWindows } from '../src/main/transcription/windows'
import type { WhisperResult } from '../src/main/whisper/manager'

const SR = 16000
const region = (channel: 'me' | 'them', startSec: number, durSec: number): SpeechRegion => ({
  channel,
  startSample: Math.round(startSec * SR),
  samples: new Int16Array(Math.round(durSec * SR)).fill(channel === 'me' ? 100 : 200),
  speechFrames: Math.round(durSec * 50)
})

describe('packWindows', () => {
  it('orders regions chronologically and lays them out with gaps', () => {
    const [w] = packWindows([region('them', 5, 2), region('me', 1, 3)])
    expect(w.parts.map((p) => p.channel)).toEqual(['me', 'them'])
    expect(w.parts[0].offset).toBe(WINDOW_OPTIONS.leadSamples)
    expect(w.parts[1].offset).toBe(WINDOW_OPTIONS.leadSamples + 3 * SR + WINDOW_OPTIONS.gapSamples)
    expect(w.audio[w.parts[0].offset]).toBe(100)
    expect(w.audio[w.parts[1].offset]).toBe(200)
    expect(w.audio.length).toBe(WINDOW_OPTIONS.leadSamples + 5 * SR + WINDOW_OPTIONS.gapSamples + WINDOW_OPTIONS.tailSamples)
  })

  it('never exceeds the maximum window length', () => {
    const regions = Array.from({ length: 12 }, (_, i) => region(i % 2 ? 'them' : 'me', i * 6, 5))
    const windows = packWindows(regions)
    expect(windows.length).toBeGreaterThan(1)
    for (const w of windows) expect(w.audio.length).toBeLessThanOrEqual(WINDOW_OPTIONS.maxSamples)
    expect(windows.flatMap((w) => w.parts).length).toBe(12)
  })
})

describe('mapResult', () => {
  const [win] = packWindows([region('me', 10, 3), region('them', 14, 4)])
  const meStart = win.parts[0].offset / SR
  const themStart = win.parts[1].offset / SR
  const word = (w: string, start: number, end: number) => ({ word: w, start, end, probability: 0.9 })

  it('assigns words to the speaker whose audio they fall in, even within one segment', () => {
    const result: WhisperResult = {
      language: 'english',
      text: '',
      segments: [
        {
          id: 0,
          text: ' Hello there. Hi back',
          start: meStart + 0.2,
          end: themStart + 1.5,
          words: [word(' Hello', meStart + 0.2, meStart + 0.6), word(' there.', meStart + 0.7, meStart + 1.2), word(' Hi', themStart + 0.4, themStart + 0.8), word(' back', themStart + 1, themStart + 1.5)]
        }
      ]
    }
    const out = mapResult(result, win)
    expect(out.map((u) => [u.channel, u.text.trim()])).toEqual([
      ['me', 'Hello there.'],
      ['them', 'Hi back']
    ])
    // Session time: the "me" part started at 10 s, the words 0.2 s into it.
    expect(out[0].startSample / SR).toBeCloseTo(10.2, 1)
    expect(out[1].startSample / SR).toBeCloseTo(14.4, 1)
  })

  it('keeps a segment that sits inside one part together', () => {
    const result: WhisperResult = {
      text: '',
      segments: [{ id: 0, text: ' All mine', start: themStart + 0.1, end: themStart + 2, words: [word(' All', themStart + 0.1, themStart + 0.5), word(' mine', themStart + 0.6, themStart + 2)] }]
    }
    expect(mapResult(result, win).map((u) => u.channel)).toEqual(['them'])
  })

  it('falls back to segment timing when there are no words', () => {
    const result: WhisperResult = { text: '', segments: [{ id: 0, text: ' Fallback', start: meStart + 0.5, end: meStart + 1.5, avg_logprob: -0.1 }] }
    const [u] = mapResult(result, win)
    expect(u.channel).toBe('me')
    expect(u.text.trim()).toBe('Fallback')
    expect(u.probability).toBeCloseTo(Math.exp(-0.1), 3)
  })
})
