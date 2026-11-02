import { formatClock, formatDuration, meetingDate, mergeTurns, speakerNamer } from '@shared/format'
import type { Meeting, MeetingSummary } from '@shared/types'
import { tokenize, type MeetingStore } from '../store/meetings'

const STOPWORDS = new Set(
  (
    'the a an and or but of to in on at for with about from by is are was were be been it this that these those what which who whom whose when where why how ' +
    'did do does done have has had we our us you your i me my they them their he she his her can could would should will shall may might any some all ' +
    'meeting meetings call calls said say says tell told talk talked discuss discussed last next week month today yesterday ' +
    'que de la el los las un una y o en por para con sobre del al lo se le les mi mis su sus nos fue era es son qué cuál cuando cómo dónde reunión reuniones dijo ' +
    'o os as um uma e em por para com sobre do da dos das no na nos nas meu minha seu sua foi era é são quando como onde reunião reuniões disse'
  ).split(/\s+/)
)

const DAY = 24 * 3600 * 1000

/** Recognizes simple relative dates ("last week", "ayer", "hoje"...) in a question. */
export function timeRange(question: string, now = new Date()): { from: number; to: number } | null {
  const q = question.toLowerCase()
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const weekStart = startOfDay - ((now.getDay() + 6) % 7) * DAY
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime()
  if (/\b(today|hoy|hoje)\b/.test(q)) return { from: startOfDay, to: startOfDay + DAY }
  if (/\b(yesterday|ayer|ontem)\b/.test(q)) return { from: startOfDay - DAY, to: startOfDay }
  if (/(last week|past week|semana pasada|semana passada|última semana|ultima semana)/.test(q)) return { from: weekStart - 7 * DAY, to: weekStart }
  if (/(this week|esta semana)/.test(q)) return { from: weekStart, to: startOfDay + DAY }
  if (/(last month|mes pasado|mês passado|mes passado)/.test(q)) return { from: new Date(now.getFullYear(), now.getMonth() - 1, 1).getTime(), to: monthStart }
  if (/(this month|este mes|este mês)/.test(q)) return { from: monthStart, to: startOfDay + DAY }
  return null
}

function when(s: Pick<MeetingSummary, 'startedAt' | 'createdAt'>): number {
  return Date.parse(s.startedAt ?? s.createdAt)
}

/** Picks transcript turns that mention the query terms (plus neighbours) within a character budget. */
export function excerptTranscript(meeting: Meeting, terms: string[], budget: number, userName = ''): string {
  const turns = mergeTurns(meeting.transcript, speakerNamer(meeting, userName ? `${userName} (me)` : 'Me'), 2500).map((t) => `[${formatClock(t.start)}] ${t.name}: ${t.text}`)
  const full = turns.join('\n')
  if (full.length <= budget) return full
  const hits = new Set<number>()
  turns.forEach((t, i) => {
    const lower = t.toLowerCase()
    if (terms.some((term) => lower.includes(term))) for (let k = Math.max(0, i - 2); k <= Math.min(turns.length - 1, i + 2); k++) hits.add(k)
  })
  const chosen = hits.size ? [...hits].sort((a, b) => a - b) : turns.map((_, i) => i)
  const out: string[] = []
  let used = 0
  let prev = -2
  for (const i of chosen) {
    const line = (i !== prev + 1 && out.length ? '…\n' : '') + turns[i]
    if (used + line.length > budget) break
    out.push(line)
    used += line.length + 1
    prev = i
  }
  return out.join('\n')
}

export async function buildMeetingRecords(store: MeetingStore, question: string, userName = '', maxMeetings = 8, budgetChars = 140_000): Promise<string> {
  const range = timeRange(question)
  const inRange = (s: MeetingSummary) => !range || (when(s) >= range.from && when(s) < range.to)
  const terms = [...new Set(tokenize(question))].filter((t) => !STOPWORDS.has(t))
  let ids = terms.length
    ? store
        .rank(terms, false)
        .filter((r) => inRange(r.entry.summary))
        .slice(0, maxMeetings)
        .map((r) => r.entry.summary.id)
    : []
  if (!ids.length) ids = store.list().filter(inRange).slice(0, maxMeetings).map((s) => s.id)
  const meetings = (await Promise.all(ids.map((id) => store.get(id)))).filter((m): m is Meeting => !!m)
  if (!meetings.length) return ''
  const per = Math.floor(budgetChars / meetings.length)
  return meetings
    .map((m) => {
      const notes = (m.enhancedMarkdown?.trim() || m.notesMarkdown.trim()).slice(0, Math.floor(per * 0.4))
      const transcript = excerptTranscript(m, terms, per - notes.length, userName)
      const attrs = `title="${(m.title || 'Untitled').replace(/"/g, "'")}" date="${meetingDate(m).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}"${m.durationMs ? ` duration="${formatDuration(m.durationMs)}"` : ''}`
      return [
        `<meeting ${attrs}>`,
        m.attendees.length ? `Attendees: ${m.attendees.join(', ')}` : '',
        notes ? `Notes:\n${notes}` : '',
        transcript ? `Transcript excerpt:\n${transcript}` : '',
        '</meeting>'
      ]
        .filter(Boolean)
        .join('\n')
    })
    .join('\n\n')
}
