// Builds a small multi-speaker test set from LibriSpeech test-clean (CC BY 4.0) via the Hugging Face
// datasets server. Needs ffmpeg on PATH. Output: test/fixtures/libri/*.wav + index.json
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const out = resolve(import.meta.dirname, '../test/fixtures/libri')
mkdirSync(out, { recursive: true })
const SPEAKERS = Number(process.argv[2] ?? 4)
const PER_SPEAKER = Number(process.argv[3] ?? 4)

const api = (offset, length) =>
  `https://datasets-server.huggingface.co/rows?dataset=openslr%2Flibrispeech_asr&config=clean&split=test&offset=${offset}&length=${length}`

const bySpeaker = new Map()
for (let offset = 0; offset < 2600 && bySpeaker.size < SPEAKERS * 3; offset += 130) {
  const res = await fetch(api(offset, 30))
  const json = await res.json()
  for (const { row } of json.rows ?? []) {
    const list = bySpeaker.get(row.speaker_id) ?? []
    list.push(row)
    bySpeaker.set(row.speaker_id, list)
  }
}
const chosen = [...bySpeaker.entries()]
  .map(([id, rows]) => [id, rows.filter((r) => r.text.split(' ').length >= 10 && r.text.split(' ').length <= 32)])
  .filter(([, rows]) => rows.length >= PER_SPEAKER)
  .slice(0, SPEAKERS)

const index = []
for (const [speaker, rows] of chosen) {
  for (const row of rows.slice(0, PER_SPEAKER)) {
    const name = `${speaker}_${row.id.split('-').pop()}`
    const src = row.audio[0].src
    const flac = join(out, `${name}.flac`)
    writeFileSync(flac, Buffer.from(await (await fetch(src)).arrayBuffer()))
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', flac, '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', join(out, `${name}.wav`)])
    execFileSync('cmd', ['/c', 'del', flac])
    index.push({ file: `${name}.wav`, speaker: String(speaker), text: row.text })
    console.log(name, row.text.slice(0, 60))
  }
}
writeFileSync(join(out, 'index.json'), JSON.stringify(index, null, 2))
writeFileSync(
  join(out, 'README.md'),
  'Audio excerpts from LibriSpeech test-clean (Panayotov et al., 2015), https://www.openslr.org/12, licensed CC BY 4.0. Used only for automated tests.\n'
)
console.log(`${index.length} clips from ${chosen.length} speakers`)
