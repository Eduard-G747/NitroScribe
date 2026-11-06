import { meetingDate, speakerNamer } from './format'
import type { ActionItem, Meeting, MeetingSummary } from './types'

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/** Monday (local time) of the week containing `d`, as 'YYYY-MM-DD'. */
export function weekOf(d: Date): string {
  return ymd(new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7)))
}

export function shiftWeek(week: string, weeks: number): string {
  const d = new Date(`${week}T12:00:00`)
  d.setDate(d.getDate() + weeks * 7)
  return weekOf(d)
}

/** [Monday 00:00, next Monday 00:00) in local time. */
export function weekRange(week: string): { start: Date; end: Date } {
  const start = new Date(`${week}T00:00:00`)
  return { start, end: new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7) }
}

export function weekLabel(week: string): string {
  const { start, end } = weekRange(week)
  const last = new Date(end.getFullYear(), end.getMonth(), end.getDate() - 1)
  const f = (d: Date) => d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  return `${f(start)} – ${f(last)}`
}

export function inWeek(m: Pick<MeetingSummary, 'startedAt' | 'createdAt'>, week: string): boolean {
  const { start, end } = weekRange(week)
  const d = meetingDate(m)
  return d >= start && d < end
}

/** Splits "Subject: …" off the top of a drafted email. */
export function splitEmail(text: string): { subject: string; body: string } {
  const m = /^\s*(?:\*\*)?subject(?:\*\*)?\s*:\s*(?:\*\*)?(.+)\n+/i.exec(text)
  return m ? { subject: m[1].replace(/\*\*/g, '').trim(), body: text.slice(m[0].length).trim() } : { subject: '', body: text.trim() }
}

export interface TalkShare {
  key: string
  name: string
  ms: number
  share: number
}

/** How long each person spoke (sum of their transcript lines), largest first. */
export function talkTime(meeting: Pick<Meeting, 'transcript' | 'speakers'>, userName = ''): TalkShare[] {
  const nameOf = speakerNamer(meeting, userName)
  const totals = new Map<string, TalkShare>()
  for (const s of meeting.transcript) {
    const name = nameOf(s)
    const key = s.speaker === 'me' ? 'me' : (s.speakerId ?? 'them')
    const t = totals.get(name) ?? { key, name, ms: 0, share: 0 }
    t.ms += Math.max(0, s.end - s.start)
    totals.set(name, t)
  }
  const all = [...totals.values()].filter((t) => t.ms > 0)
  const sum = all.reduce((n, t) => n + t.ms, 0) || 1
  return all.map((t) => ({ ...t, share: t.ms / sum })).sort((a, b) => b.ms - a.ms)
}

export interface PersonEntry {
  item: ActionItem
  meeting: MeetingSummary
}

export interface Person {
  key: string
  name: string
  meetings: MeetingSummary[]
  lastMet: Date
  /** Open items this person committed to. */
  promised: PersonEntry[]
  /** Open items the user owns, from meetings with this person. */
  owed: PersonEntry[]
}

const first = (name: string) => name.toLowerCase().split(/\s+/)[0]

/** Everyone the user has met: named speakers and calendar attendees, merged across meetings. */
export function buildPeople(meetings: MeetingSummary[], userName = ''): Person[] {
  const me = userName.trim().toLowerCase()
  const isMe = (n: string) => !!me && (n.toLowerCase() === me || first(n) === first(me))
  const names = new Map<string, string>()
  for (const m of meetings) for (const p of m.participants) if (!isMe(p) && p.trim()) names.set(p.toLowerCase(), names.get(p.toLowerCase()) ?? p.trim())
  // "Sarah" and "Sarah Chen" are the same person when only one full name starts with "Sarah".
  const fullNames = [...names.keys()].filter((k) => k.includes(' '))
  const canonical = (name: string) => {
    const k = name.trim().toLowerCase()
    if (k.includes(' ')) return k
    const full = fullNames.filter((f) => first(f) === k)
    return full.length === 1 ? full[0] : k
  }
  const people = new Map<string, Person>()
  for (const m of meetings) {
    const here = new Set(m.participants.filter((p) => !isMe(p) && p.trim()).map(canonical))
    for (const key of here) {
      const p = people.get(key) ?? { key, name: names.get(key) ?? key, meetings: [], lastMet: new Date(0), promised: [], owed: [] }
      p.meetings.push(m)
      if (meetingDate(m) > p.lastMet) p.lastMet = meetingDate(m)
      for (const item of m.actionItems) {
        if (item.done) continue
        if (item.mine) p.owed.push({ item, meeting: m })
        else if (item.owner && canonical(item.owner) === key) p.promised.push({ item, meeting: m })
      }
      people.set(key, p)
    }
  }
  return [...people.values()].sort((a, b) => b.lastMet.getTime() - a.lastMet.getTime())
}
