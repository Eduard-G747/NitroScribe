import type { Meeting, Speaker, TranscriptSegment } from './types'

export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const mm = String(m).padStart(h ? 2 : 1, '0')
  return h ? `${h}:${mm}:${String(s).padStart(2, '0')}` : `${mm}:${String(s).padStart(2, '0')}`
}

export function formatDuration(ms: number): string {
  const min = Math.round(ms / 60000)
  if (min < 1) return '<1 min'
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  return `${h} h ${min % 60} min`
}

export type SpeakerNamer = (segment: Pick<TranscriptSegment, 'speaker' | 'speakerId'>) => string

/**
 * Display names: the user's name (or "Me") for the microphone; a remote speaker's name when known,
 * otherwise "Speaker N" numbered by first appearance; "Them" when speakers were not separated.
 */
export function speakerNamer(meeting: Pick<Meeting, 'transcript' | 'speakers'>, userName?: string): SpeakerNamer {
  const numbers = new Map<string, number>()
  for (const s of [...meeting.transcript].sort((a, b) => a.start - b.start)) {
    if (s.speaker === 'them' && s.speakerId && !numbers.has(s.speakerId)) numbers.set(s.speakerId, numbers.size + 1)
  }
  return (seg) => {
    if (seg.speaker === 'me') return userName?.trim() || 'Me'
    if (!seg.speakerId) return 'Them'
    return meeting.speakers?.[seg.speakerId]?.name?.trim() || `Speaker ${numbers.get(seg.speakerId) ?? numbers.size + 1}`
  }
}

/** Remote speakers in order of first appearance, with their display names. */
export function remoteSpeakers(meeting: Pick<Meeting, 'transcript' | 'speakers'>, userName?: string): { id: string; name: string; named: boolean; segments: number }[] {
  const nameOf = speakerNamer(meeting, userName)
  const out = new Map<string, { id: string; name: string; named: boolean; segments: number }>()
  for (const s of [...meeting.transcript].sort((a, b) => a.start - b.start)) {
    if (s.speaker !== 'them' || !s.speakerId) continue
    const e = out.get(s.speakerId)
    if (e) e.segments++
    else out.set(s.speakerId, { id: s.speakerId, name: nameOf(s), named: !!meeting.speakers?.[s.speakerId]?.name?.trim(), segments: 1 })
  }
  return [...out.values()]
}

export interface SpeakerTurn {
  speaker: Speaker
  speakerId?: string
  name: string
  start: number
  end: number
  text: string
  ids: string[]
}

/** Groups consecutive segments from the same person into turns. */
export function mergeTurns(segments: TranscriptSegment[], nameOf: SpeakerNamer = (s) => (s.speaker === 'me' ? 'Me' : 'Them'), maxGapMs = 4000): SpeakerTurn[] {
  const turns: SpeakerTurn[] = []
  for (const s of [...segments].sort((a, b) => a.start - b.start)) {
    const name = nameOf(s)
    const last = turns[turns.length - 1]
    if (last && last.speaker === s.speaker && last.name === name && s.start - last.end <= maxGapMs) {
      last.text += ' ' + s.text
      last.end = Math.max(last.end, s.end)
      last.ids.push(s.id)
    } else {
      turns.push({ speaker: s.speaker, speakerId: s.speakerId, name, start: s.start, end: s.end, text: s.text, ids: [s.id] })
    }
  }
  return turns
}

type TranscriptSource = Pick<Meeting, 'transcript'> & Partial<Pick<Meeting, 'speakers'>>

export function transcriptToText(meeting: TranscriptSource, userName?: string): string {
  return mergeTurns(meeting.transcript, speakerNamer(meeting, userName))
    .map((t) => `[${formatClock(t.start)}] ${t.name}: ${t.text}`)
    .join('\n')
}

function srtTime(ms: number): string {
  const h = Math.floor(ms / 3600000)
  const m = Math.floor((ms % 3600000) / 60000)
  const s = Math.floor((ms % 60000) / 1000)
  const milli = Math.floor(ms % 1000)
  const p = (n: number, l = 2) => String(n).padStart(l, '0')
  return `${p(h)}:${p(m)}:${p(s)},${p(milli, 3)}`
}

export function transcriptToSrt(meeting: TranscriptSource, userName?: string): string {
  const nameOf = speakerNamer(meeting, userName)
  return [...meeting.transcript]
    .sort((a, b) => a.start - b.start)
    .map((s, i) => `${i + 1}\n${srtTime(s.start)} --> ${srtTime(Math.max(s.end, s.start + 500))}\n${nameOf(s)}: ${s.text}\n`)
    .join('\n')
}

export function meetingDate(meeting: Pick<Meeting, 'startedAt' | 'createdAt'>): Date {
  return new Date(meeting.startedAt ?? meeting.createdAt)
}

export function transcriptToMarkdown(meeting: Meeting, userName?: string): string {
  const header = [`# ${meeting.title || 'Untitled meeting'}`, '', `*${meetingDate(meeting).toLocaleString()}*`, '']
  const body = mergeTurns(meeting.transcript, speakerNamer(meeting, userName)).map((t) => `**${t.name}** \`${formatClock(t.start)}\`  \n${t.text}\n`)
  return [...header, ...body].join('\n')
}

export function transcriptToJson(meeting: Meeting, userName?: string): string {
  const nameOf = speakerNamer(meeting, userName)
  return JSON.stringify(
    {
      title: meeting.title,
      startedAt: meeting.startedAt ?? meeting.createdAt,
      durationMs: meeting.durationMs,
      segments: [...meeting.transcript].sort((a, b) => a.start - b.start).map(({ id, speaker, speakerId, text, start, end, language }) => ({ id, speaker: nameOf({ speaker, speakerId }), channel: speaker, text, start, end, language }))
    },
    null,
    2
  )
}

export function meetingFileBase(meeting: Pick<Meeting, 'title' | 'startedAt' | 'createdAt'>): string {
  const d = meetingDate(meeting)
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  const title = (meeting.title || 'Untitled meeting').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80)
  return `${date} ${title}`
}

export function isUntitled(title: string): boolean {
  return !title.trim() || /^untitled( meeting)?$/i.test(title.trim()) || /^new (note|meeting)$/i.test(title.trim())
}
