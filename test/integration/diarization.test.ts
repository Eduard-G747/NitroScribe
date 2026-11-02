import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { MeetingSpeaker, TranscriptSegment } from '@shared/types'
import { OnlineDiarizer } from '../../src/main/speakers/cluster'
import { createInlineEmbedder } from '../../src/main/speakers/embedder'
import { TranscriptionSession } from '../../src/main/transcription/session'
import { decodeWav } from '../../src/main/transcription/wav'
import { WhisperManager } from '../../src/main/whisper/manager'

// A 4-person call: "me" (TTS) on the mic and three real LibriSpeech speakers on the system audio.
// Checks that remote speakers are told apart and that transcription stays accurate.
const BENCH = process.env.WHISPER_BENCH ?? join(tmpdir(), 'whisper-bench')
const SPEAKER_MODEL = process.env.SPEAKER_MODEL ?? join(tmpdir(), 'spk', '3dspeaker_speech_campplus_sv_zh_en_16k-common_advanced.onnx')
const fixtures = resolve(__dirname, '../fixtures')
const read = (file: string) => decodeWav(readFileSync(file)).channels[0]

const words = (t: string) => t.toLowerCase().replace(/[^a-z0-9' ]+/g, ' ').split(/\s+/).filter(Boolean)
function wer(ref: string, hyp: string): number {
  const r = words(ref)
  const h = words(hyp)
  const d = Array.from({ length: r.length + 1 }, (_, i) => [i, ...Array(h.length).fill(0)])
  for (let j = 1; j <= h.length; j++) d[0][j] = j
  for (let i = 1; i <= r.length; i++)
    for (let j = 1; j <= h.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (r[i - 1] === h[j - 1] ? 0 : 1))
  return d[r.length][h.length] / r.length
}

describe.runIf(existsSync(SPEAKER_MODEL))('speaker separation on a 4-person call', () => {
  let whisper: WhisperManager
  const config = { model: 'large-v3-q5_0' as const, useGpu: true, gpuDevice: 0 }

  beforeAll(async () => {
    const dir = mkdtempSync(join(tmpdir(), 'nitroscribe-dz-'))
    symlinkSync(join(BENCH, 'bin124', 'Release'), join(dir, 'bin'), 'junction')
    mkdirSync(join(dir, 'models'))
    linkSync(join(BENCH, 'ggml-large-v3-q5_0.bin'), join(dir, 'models', 'ggml-large-v3-q5_0.bin'))
    whisper = new WhisperManager(dir, join(dir, 'logs'))
    await whisper.init()
    await whisper.ensureServer(config)
  }, 300_000)

  afterAll(() => whisper?.dispose())

  it('labels each remote person consistently', async () => {
    const index = JSON.parse(readFileSync(join(fixtures, 'libri', 'index.json'), 'utf8')) as { file: string; speaker: string; text: string }[]
    const remote = [...new Set(index.map((c) => c.speaker))].slice(0, 3)
    const byRemote = remote.map((s) => index.filter((c) => c.speaker === s))
    // Round-robin turns: me, A, B, C, A, me, C, B ... with natural gaps.
    const turns: { who: string; pcm: Int16Array; text: string }[] = []
    const me = ['me1', 'me2', 'me3'].map((n) => ({ who: 'me', pcm: read(join(fixtures, `${n}.wav`)), text: '' }))
    const order = [0, 1, 2, 1, 0, 2, 2, 0, 1, 0, 2, 1]
    const used = [0, 0, 0]
    order.forEach((r, i) => {
      if (i % 4 === 0 && me.length) turns.push(me.shift()!)
      const clip = byRemote[r][used[r]++ % byRemote[r].length]
      turns.push({ who: remote[r], pcm: read(join(fixtures, 'libri', clip.file)), text: clip.text })
    })
    let t = 16000
    const placed = turns.map((x) => {
      const at = t
      t += x.pcm.length + 12000
      return { ...x, at }
    })
    const mic = new Int16Array(t + 32000)
    const sys = new Int16Array(t + 32000)
    for (let i = 0; i < mic.length; i++) mic[i] = Math.round((Math.random() - 0.5) * 80)
    for (const p of placed) (p.who === 'me' ? mic : sys).set(p.pcm, p.at)

    const segments = new Map<string, TranscriptSegment>()
    let speakers: Record<string, MeetingSpeaker> = {}
    const session = new TranscriptionSession(
      { timeBaseMs: 0, language: 'auto', vocabulary: '' },
      {
        transcribe: (wav, p) => whisper.transcribe(wav, p, config),
        onSegments: (added, removed) => {
          removed.forEach((id) => segments.delete(id))
          added.forEach((s) => segments.set(s.id, s))
        },
        onSpeakers: (s) => (speakers = s),
        onRelabel: (relabeled, s) => {
          speakers = s
          for (const [id, speakerId] of Object.entries(relabeled)) {
            const seg = segments.get(id)
            if (seg) segments.set(id, { ...seg, speakerId })
          }
        },
        onError: (m) => console.warn(m)
      },
      undefined,
      undefined,
      { embedder: createInlineEmbedder(SPEAKER_MODEL), diarizer: new OnlineDiarizer() }
    )
    for (let i = 0; i < mic.length; i += 1600) session.push(mic.subarray(i, i + 1600), sys.subarray(i, i + 1600))
    await session.stop()

    const list = [...segments.values()].sort((a, b) => a.start - b.start)
    const truthAt = (ms: number) => placed.find((p) => ms >= (p.at / 16000) * 1000 - 600 && ms <= ((p.at + p.pcm.length) / 16000) * 1000 + 600)?.who
    const votes = new Map<string, Map<string, number>>()
    for (const s of list) {
      if (s.speaker !== 'them') continue
      const truth = truthAt((s.start + s.end) / 2) ?? '?'
      const m = votes.get(truth) ?? new Map()
      m.set(s.speakerId ?? '-', (m.get(s.speakerId ?? '-') ?? 0) + s.text.length)
      votes.set(truth, m)
      console.log(`  ${(s.start / 1000).toFixed(1)}s truth=${truth} -> ${s.speakerId}: ${s.text.slice(0, 70)}`)
    }
    console.log('speakers:', Object.keys(speakers).join(', '))
    const majority = remote.map((r) => {
      const m = votes.get(r) ?? new Map()
      const total = [...m.values()].reduce((a, b) => a + b, 0)
      const [id, n] = [...m.entries()].sort((a, b) => b[1] - a[1])[0] ?? ['-', 0]
      return { r, id, purity: total ? n / total : 0 }
    })
    console.log('purity:', majority.map((m) => `${m.r}->${m.id} ${(m.purity * 100).toFixed(0)}%`).join(', '))
    expect(new Set(majority.map((m) => m.id)).size).toBe(3)
    for (const m of majority) expect(m.purity).toBeGreaterThan(0.85)

    const ref = placed.filter((p) => p.who !== 'me').map((p) => p.text).join(' ')
    const hyp = list.filter((s) => s.speaker === 'them').map((s) => s.text).join(' ')
    const rate = wer(ref, hyp)
    console.log(`remote WER: ${(rate * 100).toFixed(1)}%`)
    expect(rate).toBeLessThan(0.1)
    expect(list.filter((s) => s.speaker === 'me').every((s) => !s.speakerId)).toBe(true)
  }, 900_000)
})
