import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { linkSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { WhisperManager } from '../../src/main/whisper/manager'
import { TranscriptionSession } from '../../src/main/transcription/session'
import { decodeWav } from '../../src/main/transcription/wav'
import type { WhisperModelId } from '@shared/types'

// Feeds a multi-minute two-person conversation in real time and reports how far transcription lags.
// INTEGRATION=1 REALTIME=1 [MODEL=large-v3-turbo-q8_0] npx vitest run test/integration/realtime.test.ts
const BENCH = process.env.WHISPER_BENCH ?? join(tmpdir(), 'whisper-bench')
const MODEL = (process.env.MODEL ?? 'large-v3-q5_0') as WhisperModelId
const MODEL_FILE: Record<string, string> = { 'large-v3-q5_0': 'ggml-large-v3-q5_0.bin', 'large-v3-turbo-q8_0': 'ggml-large-v3-turbo-q8_0.bin', 'large-v3-turbo-q5_0': 'ggml-large-v3-turbo-q5_0.bin' }
const REPEATS = Number(process.env.REPEATS ?? 4)
const fixture = (name: string) => decodeWav(readFileSync(resolve(__dirname, '../fixtures', `${name}.wav`))).channels[0]

describe.runIf(process.env.REALTIME)('real-time transcription load', () => {
  let whisper: WhisperManager
  const config = { model: MODEL, useGpu: true, gpuDevice: 0 }

  beforeAll(async () => {
    const dir = mkdtempSync(join(tmpdir(), 'nitroscribe-rt-'))
    symlinkSync(join(BENCH, 'bin124', 'Release'), join(dir, 'bin'), 'junction')
    mkdirSync(join(dir, 'models'))
    linkSync(join(BENCH, MODEL_FILE[MODEL]), join(dir, 'models', MODEL_FILE[MODEL]))
    whisper = new WhisperManager(dir, join(dir, 'logs'))
    await whisper.init()
    await whisper.ensureServer(config)
  }, 300_000)

  afterAll(() => whisper?.dispose())

  it('keeps up with a live conversation', async () => {
    const names = ['me1', 'them1', 'me2', 'them2', 'me3', 'them3']
    let t = 16000
    const placed: { speaker: string; pcm: Int16Array; at: number }[] = []
    for (let r = 0; r < REPEATS; r++) {
      for (const n of names) {
        const pcm = fixture(n)
        placed.push({ speaker: n.startsWith('me') ? 'me' : 'them', pcm, at: t })
        t += pcm.length + 11200
      }
    }
    const total = t + 32000
    const mic = new Int16Array(total)
    const sys = new Int16Array(total)
    for (let i = 0; i < total; i++) mic[i] = Math.round((Math.random() - 0.5) * 80)
    for (const c of placed) (c.speaker === 'me' ? mic : sys).set(c.pcm, c.at)

    let maxPending = 0
    let segments = 0
    let firstTextAt = 0
    const windows: string[] = []
    const start = Date.now()
    const session = new TranscriptionSession(
      { timeBaseMs: 0, language: 'auto', vocabulary: '' },
      {
        transcribe: (wav, p) => whisper.transcribe(wav, p, config),
        onSegments: (added) => {
          segments += added.length
          if (!firstTextAt && added.length) firstTextAt = Date.now() - start
        },
        onPending: (s) => (maxPending = Math.max(maxPending, s)),
        onWindow: (w) => windows.push(`${w.speechSeconds.toFixed(1)}s/${w.ms}ms/${w.requested}`)
      }
    )
    for (let i = 0; i < total; i += 1600) {
      session.push(mic.subarray(i, i + 1600), sys.subarray(i, i + 1600))
      const due = start + ((i + 1600) / 16000) * 1000
      await new Promise((r) => setTimeout(r, Math.max(0, due - Date.now())))
    }
    const stopAt = Date.now()
    await session.stop()
    const finishMs = Date.now() - stopAt
    const audioSec = total / 16000
    console.log(`model ${MODEL}: ${audioSec.toFixed(0)} s of audio, ${windows.length} windows [${windows.join(', ')}]`)
    console.log(`first text after ${(firstTextAt / 1000).toFixed(1)} s, max backlog ${maxPending} s of speech, finish after stop ${finishMs} ms, ${segments} segments`)
    expect(segments).toBeGreaterThan(REPEATS * 6)
    expect(finishMs).toBeLessThan(60_000)
  }, 1_200_000)
})
