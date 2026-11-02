const NON_SPEECH =
  /\[(?:blank_audio|music|noise|silence|inaudible|sound|applause|laughter|laughs|static|_[a-z]+_)\]|\((?:[^)]*?(?:music|applause|laugh|silence|noise|static|inaudible)[^)]*)\)|\*[^*]*(?:music|laugh|applause)[^*]*\*|[♪♫]+/gi

const ALWAYS_HALLUCINATED = [
  /amara\.org/i,
  /castingwords/i,
  /\bsubtitles? (?:by|made by|created by)\b/i,
  /subt[ií]tulos? (?:realizados|hechos|por)/i,
  /legendas? (?:pela|por|feitas)/i,
  /sous-titr/i,
  /untertitel/i,
  /字幕/,
  /MBC\s?뉴스/,
  /^(?:www\.)?[a-z0-9-]+\.(?:com|org|net)$/i
]

const SHORT_HALLUCINATIONS = new Set([
  'thank you',
  'thank you very much',
  'thank you so much',
  'thanks for watching',
  'thank you for watching',
  'thank you so much for watching',
  'thanks for watching and see you next time',
  'please subscribe',
  'subscribe',
  'like and subscribe',
  'bye',
  'bye bye',
  'you',
  'gracias',
  'muchas gracias',
  'gracias por ver',
  'gracias por ver el video',
  'obrigado',
  'obrigada',
  'obrigado por assistir',
  'merci',
  'merci d avoir regarde',
  'vielen dank',
  'danke',
  'ご視聴ありがとうございました'
])

function normalizePhrase(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function collapseRepeats(text: string): string {
  const sentences = text.split(/(?<=[.!?。！？])\s+/)
  const out: string[] = []
  let run = 0
  for (const s of sentences) {
    if (out.length && normalizePhrase(out[out.length - 1]) === normalizePhrase(s)) {
      if (++run >= 2) continue
    } else {
      run = 0
    }
    out.push(s)
  }
  return out.join(' ').replace(/(?<![\p{L}])(\p{L}+)(?:[\s,]+\1(?![\p{L}])){3,}/giu, '$1')
}

/** Removes non-speech tags and decoding loops; returns '' if nothing speech-like remains. */
export function cleanTranscriptText(text: string): string {
  const t = collapseRepeats(text.replace(NON_SPEECH, ' ').replace(/\s+/g, ' ').trim())
  return /[\p{L}\p{N}]/u.test(t) ? t : ''
}

export function isHallucination(text: string, info: { durationMs: number; probability: number }): boolean {
  if (ALWAYS_HALLUCINATED.some((r) => r.test(text))) return true
  return SHORT_HALLUCINATIONS.has(normalizePhrase(text)) && (info.durationMs < 2500 || info.probability < 0.5)
}

export function wordTokens(text: string): string[] {
  return normalizePhrase(text).split(' ').filter(Boolean)
}

interface Timed {
  text: string
  start: number
  end: number
}

/** True when a mic segment is just the remote audio leaking from the speakers into the microphone. */
export function isEcho(me: Timed, them: Timed): boolean {
  if (me.start > them.end + 2500 || them.start > me.end + 2500) return false
  const a = wordTokens(me.text)
  const b = new Set(wordTokens(them.text))
  if (!a.length || !b.size) return false
  const shared = a.filter((t) => b.has(t)).length
  if (a.length <= 2) return shared === a.length && b.size <= 4
  return shared / a.length >= 0.6
}

export function buildPrompt(vocabulary: string, context: string): string {
  const vocab = vocabulary
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .join(', ')
  const ctx = context.trim().slice(vocab ? -200 : -300)
  return [vocab ? `${vocab}.` : '', ctx].filter(Boolean).join(' ').slice(-450)
}
