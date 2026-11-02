// Diagnostic: sends two clips separated by a gap and prints segment/word timestamps with server VAD on and off.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const [port = '8178'] = process.argv.slice(2)
const pcm = (name) => {
  const buf = readFileSync(resolve(import.meta.dirname, '../test/fixtures', `${name}.wav`))
  return new Int16Array(buf.buffer.slice(buf.byteOffset + 44, buf.byteOffset + buf.length))
}
const a = pcm('me1')
const b = pcm('them1')
const gap = 16000 * 2
const audio = new Int16Array(3200 + a.length + gap + b.length + 4800)
audio.set(a, 3200)
audio.set(b, 3200 + a.length + gap)
console.log(`clip A: ${(3200 / 16000).toFixed(2)}s-${((3200 + a.length) / 16000).toFixed(2)}s, clip B starts ${((3200 + a.length + gap) / 16000).toFixed(2)}s`)

const wav = Buffer.alloc(44 + audio.length * 2)
wav.write('RIFF', 0); wav.writeUInt32LE(36 + audio.length * 2, 4); wav.write('WAVEfmt ', 8)
wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(16000, 24)
wav.writeUInt32LE(32000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36)
wav.writeUInt32LE(audio.length * 2, 40); Buffer.from(audio.buffer).copy(wav, 44)

for (const vad of ['true', 'false']) {
  const fd = new FormData()
  fd.append('file', new Blob([wav], { type: 'audio/wav' }), 'a.wav')
  fd.append('response_format', 'verbose_json')
  fd.append('no_language_probabilities', 'true')
  fd.append('token_timestamps', 'true')
  fd.append('vad', vad)
  const t = Date.now()
  const r = await (await fetch(`http://127.0.0.1:${port}/inference`, { method: 'POST', body: fd })).json()
  console.log(`\n--- vad=${vad} (${Date.now() - t} ms)`)
  for (const s of r.segments) {
    console.log(`seg ${s.start.toFixed(2)}-${s.end.toFixed(2)} "${s.text.trim()}"`)
    console.log('   words:', s.words.map((w) => `${w.word.trim()}@${w.start.toFixed(2)}`).join(' '))
  }
}
