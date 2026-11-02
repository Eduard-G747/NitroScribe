import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { TranscriptSegment } from '@shared/types'
import { WhisperManager } from '../../src/main/whisper/manager'
import { TranscriptionSession } from '../../src/main/transcription/session'
import { decodeWav } from '../../src/main/transcription/wav'

// Point WHISPER_DIR at an installed app layout (bin/ + models/), or WHISPER_BENCH at the benchmark folder.
const BENCH = process.env.WHISPER_BENCH ?? join(tmpdir(), 'whisper-bench')
const fixture = (name: string) => decodeWav(readFileSync(resolve(__dirname, '../fixtures', `${name}.wav`))).channels[0]

function prepareDir(): string {
  if (process.env.WHISPER_DIR) return process.env.WHISPER_DIR
  const dir = mkdtempSync(join(tmpdir(), 'nitroscribe-it-'))
  symlinkSync(join(BENCH, 'bin124', 'Release'), join(dir, 'bin'), 'junction')
  mkdirSync(join(dir, 'models'))
  linkSync(join(BENCH, 'ggml-large-v3-q5_0.bin'), join(dir, 'models', 'ggml-large-v3-q5_0.bin'))
  return dir
}

function conversation(echo: boolean) {
  const names = ['me1', 'them1', 'me2', 'them2', 'me3', 'them3']
  let t = 8000
  const placed = names.map((name) => {
    const pcm = fixture(name)
    const at = t
    t += pcm.length + Math.round(0.7 * 16000)
    return { name, speaker: name.startsWith('me') ? 'me' : 'them', pcm, at }
  })
  const total = t + 16000
  const mic = new Int16Array(total)
  const sys = new Int16Array(total)
  for (let i = 0; i < total; i++) mic[i] = Math.round((Math.random() - 0.5) * 80)
  for (const c of placed) {
    const dst = c.speaker === 'me' ? mic : sys
    for (let i = 0; i < c.pcm.length; i++) dst[c.at + i] += c.pcm[i]
    if (echo && c.speaker === 'them') {
      // Crude room model: low-passed copy after 80 ms plus a weaker reflection after 140 ms.
      let lp = 0
      for (let i = 0; i < c.pcm.length; i++) {
        lp += (c.pcm[i] - lp) * 0.3
        mic[c.at + 1280 + i] += Math.round(lp * 0.15)
        mic[c.at + 2240 + i] += Math.round(lp * 0.06)
      }
    }
  }
  return { mic, sys, placed }
}

describe('local whisper transcription session', () => {
  let dir: string
  let whisper: WhisperManager
  const config = { model: 'large-v3-q5_0' as const, useGpu: true, gpuDevice: 0 }

  beforeAll(async () => {
    dir = prepareDir()
    whisper = new WhisperManager(dir, join(dir, 'logs'))
    if (!existsSync(join(dir, 'bin', 'variant.json'))) {
      const { writeFileSync } = await import('node:fs')
      writeFileSync(join(dir, 'bin', 'variant.json'), JSON.stringify({ variant: 'cuda', release: 'b5454' }))
    }
    await whisper.init()
    const t = Date.now()
    await whisper.ensureServer(config)
    console.log(`server ready in ${Date.now() - t} ms on ${whisper.getStatus().device}`)
  }, 300_000)

  afterAll(() => whisper?.dispose())

  for (const echo of [false, true]) {
    it(`attributes speakers correctly${echo ? ' with speaker echo in the mic' : ''}`, async () => {
      const { mic, sys, placed } = conversation(echo)
      const segments = new Map<string, TranscriptSegment>()
      const errors: string[] = []
      const timings: number[] = []
      const session = new TranscriptionSession(
        { timeBaseMs: 0, language: 'auto', vocabulary: '' },
        {
          transcribe: async (wav, params) => {
            const t = Date.now()
            const r = await whisper.transcribe(wav, params, config)
            timings.push(Date.now() - t)
            return r
          },
          onSegments: (added, removed) => {
            removed.forEach((id) => segments.delete(id))
            added.forEach((s) => segments.set(s.id, s))
          },
          onError: (m) => errors.push(m)
        }
      )
      for (let i = 0; i < mic.length; i += 1600) session.push(mic.subarray(i, i + 1600), sys.subarray(i, i + 1600))
      await session.stop()

      const list = [...segments.values()].sort((a, b) => a.start - b.start)
      console.log(`windows: ${timings.length}, timings: ${timings.join(', ')} ms, echo regions dropped: ${session.echoRegionsDropped}`)
      for (const s of list) console.log(`  [${(s.start / 1000).toFixed(1)}s-${(s.end / 1000).toFixed(1)}s] ${s.speaker}: ${s.text}`)
      expect(errors).toEqual([])
      const me = list.filter((s) => s.speaker === 'me').map((s) => s.text.toLowerCase()).join(' ')
      const them = list.filter((s) => s.speaker === 'them').map((s) => s.text.toLowerCase()).join(' ')
      for (const phrase of ['pricing page', 'second week of november', 'updated timeline']) expect(me).toContain(phrase)
      for (const phrase of ['reviewed the draft', 'enterprise tier', 'legal signs off', 'follow up with legal']) expect(them).toContain(phrase)
      expect(me).not.toContain('enterprise')
      expect(them).not.toContain('pricing page')
      // Timestamps should line up with where each clip was placed.
      for (const c of placed) {
        const startMs = (c.at / 16000) * 1000
        expect(list.some((s) => s.speaker === c.speaker && Math.abs(s.start - startMs) < 1500)).toBe(true)
      }
    }, 300_000)
  }
})
