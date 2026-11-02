import { describe, expect, it } from 'vitest'
import { ChannelVad, type SpeechRegion } from '../src/main/transcription/vad'

const SR = 16000

/** Builds a signal from [kind, seconds] pieces: 'speech' is a modulated tone, 'silence' is faint noise. */
function signal(pieces: [kind: 'speech' | 'silence' | 'click', seconds: number][]): Int16Array {
  const total = pieces.reduce((n, [, s]) => n + Math.round(s * SR), 0)
  const out = new Int16Array(total)
  let i = 0
  let seed = 1
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 2
  for (const [kind, s] of pieces) {
    const n = Math.round(s * SR)
    for (let k = 0; k < n; k++, i++) {
      const t = i / SR
      if (kind === 'speech') out[i] = Math.round(9000 * Math.sin(2 * Math.PI * 180 * t) * (0.6 + 0.4 * Math.sin(2 * Math.PI * 4 * t)))
      else if (kind === 'click') out[i] = Math.round(12000 * rand())
      else out[i] = Math.round(40 * rand())
    }
  }
  return out
}

function run(samples: Int16Array, chunk = 1600) {
  const regions: SpeechRegion[] = []
  const vad = new ChannelVad('me', (r) => regions.push(r))
  for (let i = 0; i < samples.length; i += chunk) vad.push(samples.subarray(i, i + chunk))
  vad.flush()
  return regions
}

describe('ChannelVad', () => {
  it('finds speech regions with padding', () => {
    const regions = run(signal([['silence', 3], ['speech', 2], ['silence', 1.5], ['speech', 1], ['silence', 2]]))
    expect(regions).toHaveLength(2)
    const [a, b] = regions
    expect(a.startSample / SR).toBeGreaterThan(2.55)
    expect(a.startSample / SR).toBeLessThan(3.0)
    expect((a.startSample + a.samples.length) / SR).toBeGreaterThan(5.0)
    expect((a.startSample + a.samples.length) / SR).toBeLessThan(5.5)
    expect(b.startSample / SR).toBeGreaterThan(6.1)
    expect(b.startSample / SR).toBeLessThan(6.5)
  })

  it('ignores short clicks', () => {
    expect(run(signal([['silence', 3], ['click', 0.06], ['silence', 2]]))).toHaveLength(0)
  })

  it('splits very long speech into regions of at most 25 s', () => {
    const regions = run(signal([['silence', 3], ['speech', 60], ['silence', 2]]))
    expect(regions.length).toBeGreaterThanOrEqual(3)
    for (const r of regions) expect(r.samples.length / SR).toBeLessThanOrEqual(25.01)
    const covered = regions.reduce((n, r) => n + r.samples.length, 0) / SR
    expect(covered).toBeGreaterThan(59)
    // regions are contiguous and ordered
    for (let i = 1; i < regions.length; i++) expect(regions[i].startSample).toBe(regions[i - 1].startSample + regions[i - 1].samples.length)
  })

  it('handles arbitrary chunk sizes identically', () => {
    const s = signal([['silence', 2], ['speech', 1.5], ['silence', 2]])
    const a = run(s, 1600)
    const b = run(s, 997)
    expect(b.map((r) => [r.startSample, r.samples.length])).toEqual(a.map((r) => [r.startSample, r.samples.length]))
  })

  it('exposes past frame levels', () => {
    const vad = new ChannelVad('them', () => undefined)
    vad.push(signal([['silence', 1], ['speech', 1]]))
    expect(vad.levelAt(10)).toBeLessThan(-50)
    expect(vad.levelAt(75)).toBeGreaterThan(-20)
    expect(vad.levelAt(5000)).toBe(-120)
  })
})
