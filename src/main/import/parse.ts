import type { ImportedLine, ImportPreview } from '@shared/types'

interface Raw {
  speaker?: string
  text: string
  start?: number
  end?: number
}

const TS = String.raw`(?:\d{1,2}:)?\d{1,2}:\d{2}(?:[.,]\d{1,3})?`

/** "1:02:03", "01:02", "00:01:02.500", "00:01:02,500" → ms. */
export function parseTimestamp(s: string): number | null {
  const m = /^(?:(\d{1,2}):)?(\d{1,2}):(\d{2})(?:[.,](\d{1,3}))?$/.exec(s.trim())
  if (!m) return null
  const [, h, mi, se, frac] = m
  if (Number(se) > 59 || (h !== undefined && Number(mi) > 59)) return null
  return ((Number(h ?? 0) * 60 + Number(mi)) * 60 + Number(se)) * 1000 + (frac ? Number(frac.padEnd(3, '0')) : 0)
}

const NOT_NAMES = new Set(
  'note notes summary agenda date time title meeting attendees participants location subject transcript transcription duration recording tldr edit update warning important todo decision decisions http https www re fwd ps cc bcc to from'.split(
    ' '
  )
)
const NOT_NAME_PHRASES = ['action items', 'next steps', 'key points', 'to do', 'follow up', 'follow-up']

function looksLikeName(s: string): boolean {
  const t = s.trim()
  if (!t || t.length > 48 || !/^\p{L}[\p{L}\p{M}\p{N} .'’\-_&()@]*$/u.test(t)) return false
  if (t.split(/\s+/).length > 5) return false
  const lower = t.toLowerCase()
  return !NOT_NAMES.has(lower) && !NOT_NAME_PHRASES.includes(lower)
}

const cleanName = (s: string) => s.replace(/\*+/g, '').replace(/\s+/g, ' ').trim()

/** Generic speaker labels ("Speaker 2") are not real names, so the AI may still identify them. */
export const isGenericSpeaker = (name: string) => /^(speaker|participant|person|unknown|guest|spk)[\s_-]*\d*$/i.test(name.trim())

const decodeEntities = (s: string) =>
  s
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&')

/** Keeps "Name: text" labels only for names that recur, or when most lines are labelled that way. */
function acceptLabels<T extends { label?: string }>(items: T[], total: number): (label: string) => boolean {
  const counts = new Map<string, number>()
  for (const it of items) if (it.label) counts.set(it.label, (counts.get(it.label) ?? 0) + 1)
  const labelled = [...counts.values()].reduce((a, b) => a + b, 0)
  const dominant = labelled >= Math.max(2, total * 0.4) && counts.size <= 40
  return (label) => (counts.get(label) ?? 0) >= 2 || dominant
}

// --- Captions: WebVTT and SRT ------------------------------------------------------------------

const CUE_TIME = new RegExp(String.raw`(${TS})\s*-->\s*(${TS})`)

function parseCues(text: string): Raw[] {
  const cues: (Raw & { label?: string })[] = []
  for (const block of text.split(/\n\s*\n/)) {
    const lines = block
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
    const ti = lines.findIndex((l) => CUE_TIME.test(l))
    if (ti === -1) continue
    const [, a, b] = CUE_TIME.exec(lines[ti])!
    let payload = lines.slice(ti + 1).join(' ')
    const voice = /<v(?:\.[^\s>]+)*\s+([^>]+)>/.exec(payload)
    payload = decodeEntities(payload.replace(/<[^>]+>/g, ''))
      .replace(/^-\s+/, '')
      .replace(/\s+/g, ' ')
      .trim()
    if (!payload) continue
    const cue: Raw & { label?: string } = { text: payload, start: parseTimestamp(a) ?? undefined, end: parseTimestamp(b) ?? undefined }
    if (voice) cue.speaker = cleanName(voice[1])
    else {
      const m = /^([^:]{1,48}?):\s+(.+)$/.exec(payload)
      if (m && looksLikeName(m[1])) cue.label = cleanName(m[1])
    }
    cues.push(cue)
  }
  const accept = acceptLabels(cues, cues.length)
  return cues.map(({ label, ...c }) => {
    if (!label || !accept(label)) return c
    return { ...c, speaker: label, text: c.text.slice(c.text.indexOf(':') + 1).trim() }
  })
}

// --- Plain text (Otter, Teams .docx, Google Meet, "Name: text", NitroScribe exports) ------------

const TS_NAME_TEXT = new RegExp(String.raw`^[\[(]?(${TS})[\])]?\s*[-–—|]?\s*([^:]{1,48}?):\s+(.+)$`)
const NAME_TS_TEXT = new RegExp(String.raw`^([^:\[(]{1,48}?)\s*[\[(](${TS})[\])]\s*:?\s+(.+)$`)
const NAME_TEXT = /^([^:]{1,48}?):\s+(.+)$/
const HEADER = new RegExp(String.raw`^\**([^*]{1,48}?)\**\s*(?:[|·•-]\s*)?\x60?[\[(]?(${TS})[\])]?\x60?$`)
const BARE_TS = new RegExp(String.raw`^[\[(]?(${TS})[\])]?$`)

type Line =
  | { kind: 'blank' }
  | { kind: 'ts'; ts: number }
  | { kind: 'header'; label: string; ts: number; raw: string }
  | { kind: 'labelled'; label: string; text: string; ts?: number; raw: string }
  | { kind: 'text'; text: string }

function classify(raw: string): Line {
  const l = raw.trim()
  if (!l) return { kind: 'blank' }
  let m = BARE_TS.exec(l)
  if (m) return { kind: 'ts', ts: parseTimestamp(m[1])! }
  m = HEADER.exec(l)
  if (m && looksLikeName(m[1]) && parseTimestamp(m[2]) !== null) return { kind: 'header', label: cleanName(m[1]), ts: parseTimestamp(m[2])!, raw: l }
  m = TS_NAME_TEXT.exec(l)
  if (m && looksLikeName(m[2])) return { kind: 'labelled', label: cleanName(m[2]), text: m[3], ts: parseTimestamp(m[1]) ?? undefined, raw: l }
  m = NAME_TS_TEXT.exec(l)
  if (m && looksLikeName(m[1])) return { kind: 'labelled', label: cleanName(m[1]), text: m[3], ts: parseTimestamp(m[2]) ?? undefined, raw: l }
  m = NAME_TEXT.exec(l)
  if (m && looksLikeName(cleanName(m[1]))) return { kind: 'labelled', label: cleanName(m[1]), text: m[2], raw: l }
  return { kind: 'text', text: l }
}

function parsePlain(text: string): { raw: Raw[]; header: string[] } {
  const lines = text.split('\n').map(classify)
  const content = lines.filter((l) => l.kind === 'text' || l.kind === 'labelled' || l.kind === 'header')
  const byLabel = acceptLabels(
    lines.filter((l): l is Extract<Line, { label: string }> => l.kind === 'labelled' || l.kind === 'header'),
    content.length
  )
  // "Name  0:03" lines followed by text are a strong layout signal (Teams, Otter, Markdown exports).
  const blocks = lines.filter((l) => l.kind === 'header').length >= 2
  const accept = (l: Extract<Line, { label: string }>) => byLabel(l.label) || (l.kind === 'header' && blocks)
  const dominant = content.some((l) => 'label' in l && accept(l))

  const out: Raw[] = []
  const header: string[] = []
  let current: Raw | null = null
  let blockSpeaker: string | undefined
  let lastSpeaker: string | undefined
  let pendingTs: number | undefined
  const addText = (text: string) => {
    if (current) {
      current.text += ' ' + text
      return
    }
    const speaker = blockSpeaker ?? (dominant ? lastSpeaker : undefined)
    // Lines before the first speaker of a labelled transcript are its header (title, date, length).
    if (dominant && !speaker && !out.length) {
      header.push(text)
      return
    }
    current = { speaker, text, start: pendingTs }
    pendingTs = undefined
    out.push(current)
  }
  for (const l of lines) {
    if (l.kind === 'blank') {
      current = null
    } else if (l.kind === 'ts') {
      pendingTs = l.ts
      current = null
    } else if (l.kind === 'header' && accept(l)) {
      blockSpeaker = l.label
      lastSpeaker = l.label
      pendingTs = l.ts
      current = null
    } else if (l.kind === 'labelled' && accept(l)) {
      blockSpeaker = undefined
      lastSpeaker = l.label
      current = { speaker: l.label, text: l.text, start: l.ts ?? pendingTs }
      pendingTs = undefined
      out.push(current)
    } else {
      addText(l.kind === 'text' ? l.text : l.raw)
    }
  }
  if (!out.length && header.length) return { raw: header.map((text) => ({ text })), header: [] }
  return { raw: out, header }
}

// --- JSON (NitroScribe export, Whisper / AssemblyAI / Deepgram-style segment lists) -------------

function parseJson(text: string): { raw: Raw[]; title?: string; date?: string; me?: string } | null {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    return null
  }
  const obj = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>
  const list = Array.isArray(data) ? data : (obj.segments ?? obj.transcript ?? obj.utterances ?? obj.results)
  if (!Array.isArray(list)) return null
  const items = list.filter((x): x is Record<string, unknown> => !!x && typeof x === 'object')
  const num = (x: Record<string, unknown>, keys: string[]) => {
    for (const k of keys) if (typeof x[k] === 'number' && Number.isFinite(x[k])) return x[k] as number
    return undefined
  }
  const str = (x: Record<string, unknown>, keys: string[]) => {
    for (const k of keys) if (typeof x[k] === 'string' && (x[k] as string).trim()) return (x[k] as string).trim()
    return undefined
  }
  const ours = items.some((x) => x.channel === 'me' || x.channel === 'them')
  // Fractional times are seconds (Whisper, Deepgram); whole numbers are milliseconds (NitroScribe, AssemblyAI).
  const starts = items.map((x) => num(x, ['start', 'start_time', 'startTime', 'offset'])).filter((v): v is number => v !== undefined)
  const scale = !ours && starts.some((v) => !Number.isInteger(v)) ? 1000 : 1
  let me: string | undefined
  const raw: Raw[] = []
  for (const x of items) {
    const text = str(x, ['text', 'content', 'transcript', 'utterance'])
    if (!text) continue
    let speaker = str(x, ['speaker', 'speaker_name', 'speakerName', 'name', 'label'])
    if (typeof x.speaker === 'number') speaker = `Speaker ${x.speaker + 1}`
    if (ours && x.channel === 'me' && speaker) me = speaker
    const start = num(x, ['start', 'start_time', 'startTime', 'offset'])
    const end = num(x, ['end', 'end_time', 'endTime'])
    raw.push({ speaker, text, start: start !== undefined ? start * scale : undefined, end: end !== undefined ? end * scale : undefined })
  }
  const title = typeof obj.title === 'string' ? obj.title : undefined
  const dateValue = [obj.startedAt, obj.date, obj.created_at, obj.createdAt].find((v) => typeof v === 'string') as string | undefined
  return { raw, title, date: dateValue ? validDate(new Date(dateValue)) : undefined, me }
}

// --- Dates and titles ---------------------------------------------------------------------------

function validDate(d: Date): string | undefined {
  const t = d.getTime()
  if (Number.isNaN(t) || d.getFullYear() < 2000 || t > Date.now() + 366 * 86_400_000) return undefined
  return d.toISOString()
}

const MONTHS = 'jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec'

/** Finds a meeting date in a file name or transcript header. */
export function findDate(text: string): string | undefined {
  let m = /GMT(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})/.exec(text)
  if (m) return validDate(new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6])))
  m = /\b(20\d{2})[-_.](\d{1,2})[-_.](\d{1,2})(?:[ T_](\d{1,2})[:.h-]?(\d{2}))?/.exec(text)
  if (m && +m[2] >= 1 && +m[2] <= 12 && +m[3] >= 1 && +m[3] <= 31) {
    return validDate(new Date(+m[1], +m[2] - 1, +m[3], m[4] ? +m[4] : 12, m[5] ? +m[5] : 0))
  }
  const time = String.raw`(?:,?\s+(?:at\s+)?(\d{1,2}(?::\d{2})?\s*(?:[ap]\.?m\.?)?))?`
  m = new RegExp(String.raw`\b((?:${MONTHS})[a-z]*\.?\s+\d{1,2}(?:st|nd|rd|th)?,?\s+20\d{2}|\d{1,2}(?:st|nd|rd|th)?\s+(?:${MONTHS})[a-z]*\.?,?\s+20\d{2})${time}`, 'i').exec(text)
  if (m) {
    const day = m[1].replace(/(\d)(st|nd|rd|th)/i, '$1').replace(/[,.]/g, ' ')
    const t = m[2]?.replace(/\./g, '').replace(/\s*([ap]m)$/i, ' $1') ?? '12:00'
    return validDate(new Date(`${day} ${/:/.test(t) || / [ap]m$/i.test(t) ? t : `${t}:00`}`))
  }
  m = /\b(\d{1,2})\/(\d{1,2})\/(20\d{2})\b/.exec(text)
  if (m) {
    const [a, b] = [+m[1], +m[2]]
    const [month, day] = a > 12 ? [b, a] : [a, b]
    return validDate(new Date(+m[3], month - 1, day, 12, 0))
  }
  return undefined
}

function fileTitle(fileName: string): string {
  const base = fileName
    .replace(/\.[a-z0-9]{1,5}$/i, '')
    .replace(/GMT\d{8}-\d{6}_?/g, '')
    .replace(/[_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return /^(pasted|transcript|recording|meeting_saved_closed_caption|closed caption|untitled)/i.test(base) ? '' : base
}

function headerTitle(header: string[]): string {
  for (const line of header.slice(0, 4)) {
    const l = line.replace(/^#+\s*/, '').replace(/^\*+|\*+$/g, '').trim()
    if (l.length < 3 || l.length > 120 || findDate(l) || /^\d/.test(l) || /^\d+\s*[hm]/.test(l)) continue
    return l.replace(/\s*[-–—|:]\s*(transcript|transcription)\s*$/i, '').replace(/^(transcript|transcription)\s*[-–—:]\s*/i, '').trim()
  }
  return ''
}

// --- Assembly -------------------------------------------------------------------------------------

const estimateMs = (text: string) => Math.max(1500, Math.round((text.split(/\s+/).length / 2.5) * 1000))

/** Fills in missing or out-of-order times so every line has a sensible start and end. */
function withTimes(raw: Raw[]): { lines: ImportedLine[]; timed: boolean } {
  const timed = raw.some((r) => r.start !== undefined)
  const firstStart = raw.find((r) => r.start !== undefined)?.start ?? 0
  // Wall-clock timestamps (e.g. 10:02:15) are shifted so the meeting starts at 0.
  const shift = firstStart > 3_600_000 ? firstStart : 0
  const starts: number[] = []
  let cursor = 0
  for (const r of raw) {
    const prev = starts[starts.length - 1] ?? 0
    const start = r.start !== undefined ? Math.max(prev, r.start - shift) : Math.max(prev, cursor)
    starts.push(start)
    cursor = start + estimateMs(r.text) + 400
  }
  const lines = raw.map((r, i) => {
    const start = starts[i]
    const next = starts[i + 1]
    const own = r.end !== undefined ? r.end - shift : start + estimateMs(r.text)
    const end = Math.max(start + 200, next !== undefined && next > start ? Math.min(own, next) : own)
    return { speaker: r.speaker, text: r.text.replace(/\s+/g, ' ').trim(), start: Math.round(start), end: Math.round(end) }
  })
  return { lines: lines.filter((l) => l.text), timed }
}

export function parseTranscript(input: string, fileName = '', format?: string): ImportPreview {
  const text = input.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
  let raw: Raw[]
  let title = ''
  let date: string | undefined
  let fmt = format
  let me: string | undefined
  const json = /^\s*[[{]/.test(text) ? parseJson(text) : null
  if (json) {
    raw = json.raw
    title = json.title ?? ''
    date = json.date
    me = json.me
    fmt = json.me ? 'NitroScribe export' : 'JSON'
  } else if (/^WEBVTT/.test(text.trimStart()) || CUE_TIME.test(text.split('\n').slice(0, 12).join('\n'))) {
    raw = parseCues(text)
    fmt ??= /^WEBVTT/.test(text.trimStart()) ? 'WebVTT captions' : 'SRT subtitles'
  } else {
    const plain = parsePlain(text)
    raw = plain.raw
    title = headerTitle(plain.header)
    date = findDate(plain.header.join('\n'))
    fmt ??= 'Text'
  }
  date ??= findDate(fileName) ?? (json ? undefined : findDate(text.split('\n').slice(0, 20).join('\n')))
  const { lines, timed } = withTimes(raw)
  const counts = new Map<string, number>()
  for (const l of lines) if (l.speaker) counts.set(l.speaker, (counts.get(l.speaker) ?? 0) + 1)
  const speakers = [...counts.entries()].map(([name, n]) => ({ name, lines: n }))
  if (me && counts.has(me)) {
    const i = speakers.findIndex((s) => s.name === me)
    speakers.unshift(...speakers.splice(i, 1))
  }
  return { fileName, format: fmt, title: title || fileTitle(fileName), date, timed, lines, speakers, suggestedMe: me && counts.has(me) ? me : undefined }
}
