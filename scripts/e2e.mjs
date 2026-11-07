// End-to-end smoke test: drives the built app with Playwright, a fake microphone fed from the TTS
// fixtures, local Whisper (from the benchmark folder) and an Ollama model. Screenshots go to SHOTS_DIR.
//   node scripts/e2e.mjs [full|onboarding|install|ui]
import { _electron as electron } from 'playwright'
import { execFileSync } from 'node:child_process'
import { createServer } from 'node:http'
import { linkSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const shots = process.env.SHOTS_DIR ?? join(tmpdir(), 'nitroscribe-shots')
const BENCH = process.env.WHISPER_BENCH ?? join(tmpdir(), 'whisper-bench')
const SPEAKER_MODEL = join(tmpdir(), 'spk', '3dspeaker_speech_campplus_sv_zh_en_16k-common_advanced.onnx')
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? 'llama3.2:3b-instruct-q4_K_M'
const scenario = process.argv[2] ?? 'full'
mkdirSync(shots, { recursive: true })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let current = null
const log = (...a) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a)

function conversationWav() {
  const pcm = (n) => readFileSync(join(root, 'test', 'fixtures', `${n}.wav`)).subarray(44)
  const gap = Buffer.alloc(16000 * 2 * 0.8)
  const parts = [Buffer.alloc(16000 * 2)]
  for (const n of ['me1', 'them1', 'me2', 'them2', 'me3', 'them3']) parts.push(pcm(n), gap)
  parts.push(Buffer.alloc(16000 * 2 * 3))
  const data = Buffer.concat(parts)
  const h = Buffer.alloc(44)
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVEfmt ', 8); h.writeUInt32LE(16, 16)
  h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(16000, 24); h.writeUInt32LE(32000, 28)
  h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(data.length, 40)
  const file = join(tmpdir(), 'nitroscribe-e2e-conversation.wav')
  writeFileSync(file, Buffer.concat([h, data]))
  log(`fake mic audio: ${(data.length / 32000).toFixed(1)} s`)
  return file
}

/** Serves a small iCal feed with meetings over the next few days. */
async function calendarServer() {
  const pad = (n) => String(n).padStart(2, '0')
  const stamp = (d) => `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}00Z`
  const at = (days, h, m = 0) => {
    const d = new Date()
    d.setDate(d.getDate() + days)
    d.setHours(h, m, 0, 0)
    return d
  }
  const events = [
    ['Design review', 0, new Date().getHours() + 1, 30, 'https://meet.google.com/abc-defg-hij', ['Sarah Chen', 'Marcus Lee']],
    ['1:1 with Priya', 1, 10, 30, '', ['Priya Patel']],
    ['Q4 planning', 1, 15, 60, 'https://us02web.zoom.us/j/123456789', ['Sarah Chen', 'Marcus Lee', 'Priya Patel']],
    ['Customer call: Acme', 2, 11, 45, 'https://us02web.zoom.us/j/987654321', ['Dana Ortiz']],
    ['Team stand-up', 3, 9, 15, '', ['Sarah Chen', 'Marcus Lee']]
  ]
  const ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    ...events.flatMap(([title, day, h, mins, url, people], i) => {
      const start = at(day, Math.min(h, 22))
      return [
        'BEGIN:VEVENT',
        `UID:e2e-${i}`,
        `DTSTART:${stamp(start)}`,
        `DTEND:${stamp(new Date(start.getTime() + mins * 60000))}`,
        `SUMMARY:${title}`,
        url ? `LOCATION:${url}` : '',
        ...people.map((p) => `ATTENDEE;CN=${p}:mailto:${p.split(' ')[0].toLowerCase()}@example.com`),
        'END:VEVENT'
      ].filter(Boolean)
    }),
    'END:VCALENDAR'
  ].join('\r\n')
  const server = createServer((_req, res) => res.writeHead(200, { 'Content-Type': 'text/calendar' }).end(ics))
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  return { url: `http://127.0.0.1:${server.address().port}/cal.ics`, close: () => server.close() }
}

/** A finished 4-person meeting with voice-separated speakers, for screenshots. */
function demoMeeting() {
  const t0 = new Date(Date.now() - 26 * 3600_000)
  const lines = [
    ['me', null, 'Okay, thanks everyone for joining. Let us go through the Q4 roadmap.'],
    ['them', 's1', 'Sure. The mobile redesign is on track for a beta on November fifteenth.'],
    ['them', 's2', 'The payments integration is the main risk. The API migration needs about three sprints.'],
    ['me', null, 'Marcus, can your team start the migration next week?'],
    ['them', 's2', 'Yes, we can start Monday if Priya signs off on the budget.'],
    ['them', 's3', 'I can approve up to forty two thousand for contractors this quarter.'],
    ['them', 's1', 'Great. I will share the updated timeline by Friday.'],
    ['me', null, 'Perfect. Let us sync again next Tuesday.']
  ]
  let t = 4000
  const transcript = lines.map(([speaker, speakerId, text], i) => {
    const seg = { id: `seg-${i}`, speaker, ...(speakerId ? { speakerId } : {}), text, start: t, end: t + 5200, language: 'english' }
    t += 7800
    return seg
  })
  const enhanced = [
    '### Roadmap status',
    '- Mobile redesign on track for a **beta on Nov 15** (Sarah)',
    '- Payments integration is the main risk: API migration needs ~3 sprints (Marcus)',
    '',
    '### Budget',
    '- Priya can approve up to **$42k** for contractors this quarter',
    '',
    '### Next steps',
    '- [ ] Marcus: start the API migration on Monday',
    '- [ ] Sarah: share the updated timeline by Friday',
    '- [ ] Eduardo: schedule a sync for next Tuesday'
  ].join('\n')
  return {
    id: 'demo-roadmap',
    title: 'Q4 roadmap review',
    createdAt: t0.toISOString(),
    updatedAt: t0.toISOString(),
    startedAt: t0.toISOString(),
    durationMs: 23 * 60_000,
    notesHtml: '<p>roadmap</p><ul><li><p>payments risk?</p></li><li><p>budget for contractors</p></li></ul>',
    notesMarkdown: 'roadmap\n\n- payments risk?\n- budget for contractors',
    enhancedMarkdown: enhanced,
    enhancedHtml: '',
    enhancedAt: t0.toISOString(),
    templateId: 'auto',
    transcript,
    speakers: { s1: { id: 's1', name: 'Sarah', nameSource: 'ai' }, s2: { id: 's2', name: 'Marcus', nameSource: 'manual' }, s3: { id: 's3' } },
    chat: [],
    attendees: ['Sarah Chen', 'Marcus Lee', 'Priya Patel']
  }
}

function dataDir({ onboarded, linkWhisper, calendarUrl, theme = 'light', seed = false }) {
  const dir = mkdtempSync(join(tmpdir(), 'nitroscribe-e2e-'))
  if (linkWhisper) {
    mkdirSync(join(dir, 'whisper', 'models'), { recursive: true })
    symlinkSync(join(BENCH, 'bin124', 'Release'), join(dir, 'whisper', 'bin'), 'junction')
    linkSync(join(BENCH, 'ggml-large-v3-q5_0.bin'), join(dir, 'whisper', 'models', 'ggml-large-v3-q5_0.bin'))
    linkSync(SPEAKER_MODEL, join(dir, 'whisper', 'models', '3dspeaker_speech_campplus_sv_zh_en_16k-common_advanced.onnx'))
  }
  if (seed) {
    mkdirSync(join(dir, 'meetings'), { recursive: true })
    const m = demoMeeting()
    writeFileSync(join(dir, 'meetings', `${m.id}.json`), JSON.stringify(m))
  }
  const settings = {
    userName: 'Eduardo',
    general: { onboarded, closeToTray: false, launchAtLogin: false, theme },
    // Chromium's fake capture device would feed the same file to the "system audio" stream too.
    transcription: { captureSystemAudio: false },
    ai: { provider: 'ollama', providers: { ollama: { baseUrl: 'http://127.0.0.1:11434', model: OLLAMA_MODEL } } },
    digest: { notify: false },
    updates: { check: false },
    calendars: calendarUrl ? [{ id: 'demo', name: 'Work', url: calendarUrl, enabled: true }] : []
  }
  writeFileSync(join(dir, 'settings.json'), JSON.stringify(settings))
  log('data dir', dir)
  return dir
}

async function launch(dir, extraArgs = []) {
  // ELECTRON_RUN_AS_NODE leaks in from Electron-based terminals and would make Electron run as plain Node.
  const { ELECTRON_RUN_AS_NODE: _ignored, ...env } = process.env
  // colorScheme: null stops Playwright from forcing light mode, so the app's own theme setting applies.
  const app = await electron.launch({ args: [root, ...extraArgs], env: { ...env, NITROSCRIBE_DATA_DIR: dir }, colorScheme: null })
  const win = await app.firstWindow()
  current = win
  win.on('console', (m) => log(`[renderer ${m.type()}]`, m.text().slice(0, 300)))
  win.on('pageerror', (e) => log('[renderer pageerror]', e.message))
  await win.waitForLoadState('domcontentloaded')
  return { app, win }
}

const shot = async (win, name) => {
  await sleep(500)
  await win.screenshot({ path: join(shots, `${name}.png`) })
  log('screenshot', name)
}

async function onboarding() {
  const { app, win } = await launch(dataDir({ onboarded: false, linkWhisper: true }))
  await win.waitForSelector('text=Welcome to NitroScribe')
  await shot(win, 'onboarding-1')
  await win.click('text=Continue')
  await win.waitForSelector('text=Private, on-device transcription')
  await shot(win, 'onboarding-2')
  await win.click('text=Continue')
  await win.waitForSelector('text=Connect an AI model')
  await shot(win, 'onboarding-3')
  await app.close()
}

async function install() {
  const { app, win } = await launch(dataDir({ onboarded: false, linkWhisper: false }))
  await win.click('text=Continue')
  await win.click('button:has-text("Download speech model")')
  const t0 = Date.now()
  let last = ''
  for (;;) {
    const txt = await win.locator('.rounded-xl.border.border-edge.bg-card.p-4').innerText().catch(() => '')
    const line = txt.split('\n').slice(1).join(' ').replace(/\s+/g, ' ')
    if (line !== last) {
      last = line
      log('install:', line.slice(0, 120))
    }
    if (txt.includes('Ready to transcribe')) break
    if (/failed|error|cancel/i.test(txt) && !txt.includes('Download speech model')) throw new Error(txt)
    if (Date.now() - t0 > 30 * 60_000) throw new Error('install timeout')
    await sleep(3000)
  }
  log(`installed in ${Math.round((Date.now() - t0) / 1000)} s`)
  await shot(win, 'install-done')
  await app.close()
}

/** Screenshots of the main screens in light and dark mode, with a calendar and a 4-person meeting. */
async function ui() {
  const cal = await calendarServer()
  for (const theme of ['light', 'dark']) {
    const { app, win } = await launch(dataDir({ onboarded: true, linkWhisper: true, calendarUrl: cal.url, theme, seed: true }))
    await win.waitForSelector('text=Coming up')
    await win.waitForSelector('text=Design review', { timeout: 20_000 })
    await shot(win, `${theme}-home`)
    await win.click('text=Q4 roadmap review')
    await win.waitForSelector('text=AI notes')
    await shot(win, `${theme}-meeting`)
    await win.click('button:has-text("4 people")')
    await win.waitForSelector('aside.border-l >> text=Speaker 3')
    await shot(win, `${theme}-transcript`)
    await win.locator('aside.border-l button[title="Rename speaker"]', { hasText: 'Speaker 3' }).first().click()
    await win.waitForSelector('text=Who is Speaker 3?')
    await win.fill('input[placeholder="Name"]', 'Pri')
    await shot(win, `${theme}-rename`)
    await win.click('button:has-text("Priya Patel")')
    await win.waitForSelector('aside.border-l >> text=Priya Patel')
    await shot(win, `${theme}-renamed`)
    await win.keyboard.press('Control+K')
    await win.fill('input[placeholder="Search meetings, or what someone said…"]', 'budget')
    await sleep(500)
    await shot(win, `${theme}-search`)
    await win.keyboard.press('Escape')
    await win.click('[aria-label="Settings (Ctrl+,)"]')
    await win.click('nav >> text=Transcription')
    await win.locator('text=Speakers').first().scrollIntoViewIfNeeded()
    await shot(win, `${theme}-settings-speakers`)
    await win.click('nav >> text=AI model')
    await win.waitForSelector('text=Local-only mode is on.')
    const openaiDisabled = await win.locator('option[value="openai"]').evaluate((o) => o.disabled)
    await win.click('nav >> text=Privacy & data')
    await win.waitForSelector('text=What touches the network')
    await shot(win, `${theme}-privacy`)
    await win.keyboard.press('Escape')
    await win.click('nav >> text=My notes')
    await shot(win, `${theme}-my-notes`)
    if (theme === 'light') {
      // Privacy guarantees: cloud AI is refused in Local-only mode, and the window can't reach the internet.
      const cloud = await win.evaluate(() => window.api.ai.test('openai'))
      const fetched = await win.evaluate(() => fetch('https://example.com/').then(() => 'reached the internet', (e) => `blocked (${e.message})`))
      log(`cloud option disabled: ${openaiDisabled} | cloud test: ${cloud.ok ? 'ALLOWED' : cloud.message} | window fetch: ${fetched}`)
      if (!openaiDisabled || cloud.ok || !fetched.startsWith('blocked')) throw new Error('privacy check failed')
    }
    await app.close()
  }
  cal.close()
}

async function full() {
  const wav = conversationWav()
  const { app, win } = await launch(dataDir({ onboarded: true, linkWhisper: true }), [
    '--use-fake-device-for-media-stream',
    `--use-file-for-fake-audio-capture=${wav}%noloop`
  ])
  await win.waitForSelector('text=Coming up')
  await shot(win, '01-home-empty')

  await win.click('button:has-text("New note")')
  await win.waitForSelector('[title="Stop transcribing"]', { timeout: 30_000 })
  log('recording started')
  await win.locator('.notes').click()
  await win.keyboard.type('Pricing page launch', { delay: 15 })
  await win.keyboard.press('Enter')
  await win.keyboard.type('- enterprise tier messaging unclear', { delay: 15 })
  await win.keyboard.press('Enter')
  await win.keyboard.type('legal needs to approve ToS', { delay: 15 })
  await shot(win, '02-recording-notes')

  await win.click('[title="Show transcript"]')
  const t0 = Date.now()
  await win.waitForSelector('aside.border-l >> text=/second week of November/i', { timeout: 480_000 })
  log(`transcript reached "second week of November" after ${Math.round((Date.now() - t0) / 1000)} s`)
  await shot(win, '03-live-transcript')

  await sleep(15_000)
  await win.click('[title="Stop transcribing"]')
  log('stopped; waiting for finishing + auto notes')
  await win.waitForSelector('text=Finishing transcript…', { state: 'detached', timeout: 180_000 })
  await shot(win, '04-transcript-final')
  log('TRANSCRIPT PANEL:\n' + (await win.locator('aside.border-l').innerText()))

  // The AI notes toggle appears once generation starts; wait for it to finish.
  await win.waitForSelector('button:has-text("AI notes")', { timeout: 60_000 })
  await win.waitForSelector('text=Writing your notes…', { state: 'detached', timeout: 600_000 })
  await win.click('aside.border-l [aria-label="Close"]')
  await shot(win, '05-ai-notes')
  log('AI NOTES:\n' + (await win.locator('.notes').first().innerText()))
  log('title:', await win.inputValue('input[placeholder="Untitled meeting"]'))

  await win.fill('input[placeholder="Ask anything"]', 'What are the action items and who owns them?')
  await win.keyboard.press('Enter')
  await win.waitForSelector('aside.border-l [aria-label="Copy"]', { state: 'attached', timeout: 300_000 })
  await shot(win, '06-chat')
  log('CHAT:\n' + (await win.locator('aside.border-l').innerText()))
  await app.close()
}

/**
 * The packaged app (dist/win-unpacked or APP_EXE), using the speech engine installed in %APPDATA%\NitroScribe.
 * Call audio is on, so the voice-separation worker and native addon run from inside the asar build.
 */
async function packaged() {
  const exe = process.env.APP_EXE ?? join(root, 'dist', 'win-unpacked', 'NitroScribe.exe')
  const real = join(process.env.APPDATA, 'NitroScribe', 'whisper')
  const dir = mkdtempSync(join(tmpdir(), 'nitroscribe-pkg-'))
  mkdirSync(join(dir, 'whisper', 'models'), { recursive: true })
  symlinkSync(join(real, 'bin'), join(dir, 'whisper', 'bin'), 'junction')
  for (const f of readdirSync(join(real, 'models'))) linkSync(join(real, 'models', f), join(dir, 'whisper', 'models', f))
  writeFileSync(
    join(dir, 'settings.json'),
    JSON.stringify({ userName: 'Eduardo', general: { onboarded: true, closeToTray: false }, transcription: { captureSystemAudio: true }, ai: { autoEnhance: false } })
  )
  const wav = conversationWav()
  const { ELECTRON_RUN_AS_NODE: _ignored, ...env } = process.env
  const app = await electron.launch({
    executablePath: exe,
    args: ['--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${wav}%noloop`],
    env: { ...env, NITROSCRIBE_DATA_DIR: dir },
    colorScheme: null
  })
  const win = await app.firstWindow()
  current = win
  win.on('console', (m) => log(`[renderer ${m.type()}]`, m.text().slice(0, 300)))
  win.on('pageerror', (e) => log('[renderer pageerror]', e.message))
  await win.waitForSelector('text=Coming up')
  await win.click('button:has-text("New note")')
  await win.waitForSelector('[title="Stop transcribing"]', { timeout: 30_000 })
  await win.click('[title="Show transcript"]')
  await win.waitForSelector('aside.border-l >> text=/legal/i', { timeout: 480_000 })
  await sleep(12_000)
  await win.click('[title="Stop transcribing"]')
  await win.waitForSelector('text=Finishing transcript…', { state: 'detached', timeout: 180_000 })
  await sleep(1500)
  await shot(win, 'packaged-transcript')
  await app.close()
  const logText = readFileSync(join(dir, 'logs', 'nitroscribe.log'), 'utf8')
  log('LOG:\n' + logText)
  const meeting = JSON.parse(readFileSync(join(dir, 'meetings', readdirSync(join(dir, 'meetings'))[0]), 'utf8'))
  const remote = meeting.transcript.filter((s) => s.speaker === 'them')
  log(`segments: ${meeting.transcript.length}, remote: ${remote.length}, with speaker ids: ${remote.filter((s) => s.speakerId).length}, speakers: ${Object.keys(meeting.speakers ?? {}).join(', ')}`)
  if (!logText.includes('speakers on')) throw new Error('speaker separation did not start in the packaged app')
  if (/Speaker separation failed|speaker separation unavailable/.test(logText)) throw new Error('speaker separation failed in the packaged app')
  if (!remote.length || remote.some((s) => !s.speakerId)) throw new Error('remote segments are missing speaker ids')
}

/** Importing transcripts from earlier meetings: paste + summarize with the local model, then a dropped .vtt file. */
async function importing() {
  const { app, win } = await launch(dataDir({ onboarded: true, linkWhisper: true }))
  await win.waitForSelector('text=Coming up')
  await win.click('button:has-text("Import")')
  await win.waitForSelector('text=Drop a transcript file here')
  const pasted = [
    'Q3 pricing review',
    'September 18, 2025, 10:00AM',
    '32m 10s',
    '',
    'Eduardo   0:04',
    'Thanks everyone for joining. Today we need to decide on the new pricing tiers.',
    '',
    'Sarah Chen   0:21',
    'I ran the numbers. If we raise the Pro tier to 24 dollars, churn should stay under three percent.',
    '',
    'Marcus Lee   1:05',
    'Sales is worried about the enterprise tier. Customers keep asking for annual billing.',
    '',
    'Eduardo   1:40',
    'Okay. Sarah, can you model annual billing at a 15 percent discount?',
    '',
    'Sarah Chen   2:02',
    "Yes, I'll have it by Friday.",
    '',
    'Marcus Lee   2:30',
    "And I'll talk to the three biggest accounts next week.",
    '',
    'Eduardo   3:05',
    "Great. Let's meet again on the 25th to make the final call."
  ].join('\n')
  await win.fill('textarea', pasted)
  await shot(win, 'import-1-choose')
  await win.click('button:has-text("Continue")')
  await win.waitForSelector('text=Which speaker is you?')
  log('detected:', await win.locator('.rounded-xl.bg-hover').first().innerText())
  log('me:', await win.locator('select').first().inputValue(), '| date:', await win.inputValue('input[type="datetime-local"]'), '| title:', await win.inputValue('input[placeholder="Untitled meeting"]'))
  await shot(win, 'import-2-review')
  await win.click('button:has-text("Import and summarize")')
  await win.waitForSelector('button:has-text("AI notes")', { timeout: 30_000 })
  await win.waitForSelector('text=Writing your notes…', { state: 'detached', timeout: 600_000 })
  await shot(win, 'import-3-summary')
  log('AI NOTES:\n' + (await win.locator('.notes').first().innerText()))
  await win.click('button:has-text("Transcript")')
  await win.waitForSelector('aside.border-l >> text=Sarah Chen')
  await shot(win, 'import-4-transcript')

  const vtt = 'WEBVTT\n\n1\n00:00:01.000 --> 00:00:04.000\nDana Ortiz: Thanks for taking the call.\n\n2\n00:00:04.500 --> 00:00:08.000\nEduardo: Happy to. Let us look at the contract.\n\n3\n00:00:08.500 --> 00:00:12.000\nDana Ortiz: We need the renewal signed by October.\n'
  await win.evaluate((content) => {
    const dt = new DataTransfer()
    dt.items.add(new File([content], 'GMT20250902-143000_Recording.transcript.vtt', { type: 'text/vtt' }))
    const root = document.querySelector('#root > div')
    root.dispatchEvent(new DragEvent('dragenter', { dataTransfer: dt, bubbles: true }))
    root.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }))
  }, vtt)
  await win.waitForSelector('text=Which speaker is you?')
  log('dropped file detected:', await win.locator('.rounded-xl.bg-hover').first().innerText())
  await win.click('#summarize')
  await win.click('[role=dialog] button:has-text("Import")')
  await win.waitForSelector('text=Imported · WebVTT captions')
  await win.click('nav >> text=Home')
  await shot(win, 'import-5-home')
  log('HOME:\n' + (await win.locator('main, .overflow-y-auto').first().innerText()).slice(0, 600))
  await app.close()
}

/** Uploading a recording (.m4a of three LibriSpeech voices) to be transcribed, then changing the meeting's date. */
async function audio() {
  const libri = join(root, 'test', 'fixtures', 'libri')
  const index = JSON.parse(readFileSync(join(libri, 'index.json'), 'utf8'))
  const people = [...new Set(index.map((c) => c.speaker))].slice(0, 3)
  const clips = [0, 1, 2, 0, 1, 2].map((p, i) => index.filter((c) => c.speaker === people[p])[Math.floor(i / 3)])
  const pcm = Buffer.concat(clips.flatMap((c) => [readFileSync(join(libri, c.file)).subarray(44), Buffer.alloc(16000 * 2 * 0.7)]))
  const wav = join(tmpdir(), 'nitroscribe-e2e-call.wav')
  const h = Buffer.alloc(44)
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVEfmt ', 8); h.writeUInt32LE(16, 16)
  h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(16000, 24); h.writeUInt32LE(32000, 28)
  h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(pcm.length, 40)
  writeFileSync(wav, Buffer.concat([h, pcm]))
  const m4a = join(tmpdir(), 'nitroscribe-e2e-call.m4a')
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', wav, '-ar', '44100', '-ac', '2', '-c:a', 'aac', '-b:a', '96k', m4a])
  log(`recording: ${(pcm.length / 32000).toFixed(1)} s, ${clips.length} turns from ${people.length} people`)

  const { app, win } = await launch(dataDir({ onboarded: true, linkWhisper: true }))
  await win.waitForSelector('text=Coming up')
  await win.evaluate(
    ({ b64, name }) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
      const dt = new DataTransfer()
      dt.items.add(new File([bytes], name, { type: 'audio/mp4' }))
      const root = document.querySelector('#root > div')
      root.dispatchEvent(new DragEvent('dragenter', { dataTransfer: dt, bubbles: true }))
      root.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }))
    },
    { b64: readFileSync(m4a).toString('base64'), name: 'Client call 2025-06-12.m4a' }
  )
  await win.waitForSelector('text=Transcribe a recording', { timeout: 60_000 })
  log('review:', (await win.locator('[role=dialog] .rounded-xl.bg-hover').innerText()).replace(/\n/g, ' | '), '| date:', await win.inputValue('[role=dialog] input[type="datetime-local"]'))
  await win.click('#summarize-audio')
  await shot(win, 'audio-1-review')
  const t0 = Date.now()
  await win.click('[role=dialog] button:has-text("Transcribe")')
  await win.waitForSelector('text=/Transcribing \\d+%/', { timeout: 30_000 })
  await win.waitForSelector('text=Recording transcribed', { timeout: 600_000 })
  log(`transcribed in ${Math.round((Date.now() - t0) / 1000)} s`)
  await shot(win, 'audio-2-transcript')
  const panel = await win.locator('aside.border-l').innerText()
  const speakers = [...new Set(panel.match(/Speaker \d/g) ?? [])]
  log(`speakers: ${speakers.join(', ')} | transcript starts: ${panel.split('\n').slice(3, 9).join(' / ').slice(0, 300)}`)

  // Change the meeting's date and check that the home list follows.
  await win.click('button[title="Change the date"]')
  await win.fill('input[type="datetime-local"]', '2024-03-05T09:30')
  await win.click('button:has-text("Save")')
  await win.waitForSelector('button[title="Change the date"]:has-text("2024")')
  await shot(win, 'audio-3-date')
  await sleep(1200)
  await win.click('nav >> text=Home')
  await win.waitForSelector('text=/Mar 5, 2024/')
  log('home groups:', (await win.locator('main, .overflow-y-auto').first().innerText()).match(/\w{3}, \w{3} \d+, \d{4}/g)?.join(', '))
  await app.close()
  if (speakers.length < 2) throw new Error('expected the voices to be separated')
}

/** The Action items page: extraction with the local model from a seeded meeting, check-off, filters. */
async function actions() {
  const { app, win } = await launch(dataDir({ onboarded: true, linkWhisper: true, seed: true, theme: 'dark' }))
  await win.waitForSelector('text=Coming up')
  await win.click('nav >> text=Action items')
  await win.waitForSelector("text=/hasn't been checked/")
  await win.click('button:has-text("Find action items")')
  await win.waitForSelector('text=/Found \\d+ open action item|No action items found/', { timeout: 300_000 })
  await win.click('button:has-text("Everyone")')
  await sleep(500)
  await shot(win, 'actions-1-everyone')
  log('ITEMS:\n' + (await win.locator('section').allInnerTexts()).join('\n---\n'))
  await win.click('button:has-text("Mine")')
  await sleep(300)
  await shot(win, 'actions-2-mine')
  const first = win.locator('button[title="Mark as done"]').first()
  if (await first.count()) {
    await first.click()
    await win.click('button:has-text("Done")')
    await win.waitForSelector('button[title="Mark as not done"]')
    log('checked off one item')
  }
  await app.close()
}

/** Search moments + talk time, follow-up email and weekly review (local model), people pages. */
async function insights() {
  const dir = dataDir({ onboarded: true, linkWhisper: true, seed: true })
  const file = join(dir, 'meetings', 'demo-roadmap.json')
  const m = JSON.parse(readFileSync(file, 'utf8'))
  const due = (days) => {
    const d = new Date(m.startedAt)
    d.setDate(d.getDate() + days)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }
  m.actionItems = [
    { id: 'a1', task: 'Share the updated timeline', owner: 'Sarah', mine: false, due: due(2), done: false },
    { id: 'a2', task: 'Start the API migration', owner: 'Marcus', mine: false, due: due(5), done: false },
    { id: 'a3', task: 'Schedule a sync', owner: 'Eduardo', mine: true, due: due(6), done: false }
  ]
  m.actionItemsAt = m.startedAt
  writeFileSync(file, JSON.stringify(m))
  const { app, win } = await launch(dir)
  await win.waitForSelector('text=Coming up')

  await win.keyboard.press('Control+K')
  await win.keyboard.type('budget')
  const moment = win.locator('button[title="Jump to this moment in the transcript"]').first()
  await moment.waitFor()
  await shot(win, 'insights-1-search')
  await moment.click()
  await win.waitForSelector('[data-turn].ring-2')
  await shot(win, 'insights-2-jump-talktime')
  log('talk time: ' + (await win.locator('[title="Share of speaking time"]').innerText()).replace(/\n/g, ' '))

  await win.click('button:has-text("Follow-up email")')
  await win.waitForSelector('button:has-text("Copy email"):not([disabled])', { timeout: 300_000 })
  await shot(win, 'insights-3-followup')
  log('EMAIL body:\n' + (await win.locator('textarea').inputValue()))
  await win.keyboard.press('Escape')

  await win.click('nav >> text=People')
  await win.waitForSelector('text=Sarah Chen')
  await shot(win, 'insights-4-people')
  await win.click('text=Sarah Chen')
  await win.waitForSelector('text=They promised')
  await shot(win, 'insights-5-person')
  log('promised: ' + (await win.locator('section').first().innerText()).replace(/\n+/g, ' | '))

  await win.click('nav >> text=Week in review')
  await win.waitForSelector('h1:has-text("Week in review")')
  const write = win.locator('button:has-text("Write review")')
  if (await write.count()) await write.click()
  await win.waitForSelector('button:has-text("Rewrite")', { timeout: 300_000 })
  await shot(win, 'insights-6-digest')
  log('DIGEST:\n' + (await win.locator('.md').first().innerText()))
  await app.close()
}

const run = { full, onboarding, install, ui, packaged, import: importing, audio, actions, insights }[scenario]
run()
  .then(() => log('done'))
  .catch(async (err) => {
    console.error(err)
    if (current) {
      await current.screenshot({ path: join(shots, 'failure.png') }).catch(() => undefined)
      const toasts = await current.locator('.fixed.bottom-24').innerText().catch(() => '')
      log('toasts at failure:', JSON.stringify(toasts))
    }
    process.exit(1)
  })
