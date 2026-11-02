import { EventEmitter } from 'node:events'
import ICAL from 'ical.js'
import type { CalendarEvent, CalendarSource } from '@shared/types'

const MEETING_URL =
  /https?:\/\/(?:[\w-]+\.)?(?:zoom\.us\/(?:j|my|w)\/[^\s<>"')]+|meet\.google\.com\/[a-z0-9-]+|teams\.microsoft\.com\/l\/meetup-join\/[^\s<>"')]+|teams\.live\.com\/meet\/[^\s<>"')]+|[\w-]+\.webex\.com\/[^\s<>"')]+|whereby\.com\/[^\s<>"')]+|app\.slack\.com\/huddle\/[^\s<>"')]+)/i

function toEvent(ev: ICAL.Event, start: Date, end: Date, allDay: boolean, calendarName?: string): CalendarEvent | null {
  const status = String(ev.component.getFirstPropertyValue('status') ?? '').toUpperCase()
  if (status === 'CANCELLED') return null
  const attendees = ev.attendees
    .map((a) => {
      const cn = a.getParameter('cn')
      const email = String(a.getFirstValue() ?? '').replace(/^mailto:/i, '')
      return (typeof cn === 'string' && cn.trim()) || email
    })
    .filter(Boolean)
  const description = ev.description ?? ''
  const location = ev.location ?? ''
  const conference = String(ev.component.getFirstPropertyValue('x-google-conference') ?? '')
  const meetingUrl = [conference, location, description].map((s) => MEETING_URL.exec(s)?.[0]).find(Boolean)
  return {
    uid: `${ev.uid}|${start.toISOString()}`,
    title: ev.summary?.trim() || '(No title)',
    start: start.toISOString(),
    end: end.toISOString(),
    allDay,
    attendees: [...new Set(attendees)].slice(0, 30),
    location: location || undefined,
    meetingUrl,
    description: description.slice(0, 2000) || undefined,
    calendarName
  }
}

/** Parses an iCal feed and expands recurring events that overlap [from, to]. */
export function parseIcs(text: string, from: Date, to: Date, calendarName?: string): CalendarEvent[] {
  const root = new ICAL.Component(ICAL.parse(text))
  for (const tz of root.getAllSubcomponents('vtimezone')) {
    const tzid = String(tz.getFirstPropertyValue('tzid') ?? '')
    if (tzid && !ICAL.TimezoneService.has(tzid)) ICAL.TimezoneService.register(tz)
  }
  const masters = new Map<string, ICAL.Event>()
  const exceptions: ICAL.Event[] = []
  root.getAllSubcomponents('vevent').forEach((comp, i) => {
    const ev = new ICAL.Event(comp)
    if (ev.isRecurrenceException()) exceptions.push(ev)
    else masters.set(ev.uid || `event-${i}`, ev)
  })
  for (const ex of exceptions) {
    const master = masters.get(ex.uid)
    if (master) master.relateException(ex)
    else masters.set(`${ex.uid}-${ex.startDate?.toString()}`, ex)
  }
  const fromMs = from.getTime()
  const toMs = to.getTime()
  const out: CalendarEvent[] = []
  for (const ev of masters.values()) {
    if (!ev.startDate) continue
    if (ev.isRecurring()) {
      const it = ev.iterator()
      for (let i = 0; i < 20000; i++) {
        const next = it.next()
        if (!next || next.toJSDate().getTime() > toMs) break
        const d = ev.getOccurrenceDetails(next)
        const start = d.startDate.toJSDate()
        const end = d.endDate.toJSDate()
        if (end.getTime() < fromMs) continue
        const e = toEvent(d.item, start, end, d.startDate.isDate, calendarName)
        if (e) out.push(e)
      }
    } else {
      const start = ev.startDate.toJSDate()
      const end = (ev.endDate ?? ev.startDate).toJSDate()
      if (end.getTime() < fromMs || start.getTime() > toMs) continue
      const e = toEvent(ev, start, end, ev.startDate.isDate, calendarName)
      if (e) out.push(e)
    }
  }
  return out.sort((a, b) => a.start.localeCompare(b.start))
}

export async function fetchIcs(url: string): Promise<string> {
  const res = await fetch(url.trim().replace(/^webcal:\/\//i, 'https://'), {
    signal: AbortSignal.timeout(20_000),
    headers: { 'User-Agent': 'NitroScribe/1.0 (calendar sync)' }
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const text = await res.text()
  if (!text.includes('BEGIN:VCALENDAR')) throw new Error('This link is not an iCal (.ics) feed')
  return text
}

export class CalendarService extends EventEmitter {
  private events: CalendarEvent[] = []
  private errors: string[] = []
  private notified = new Set<string>()
  private timers: NodeJS.Timeout[] = []

  constructor(private sources: () => CalendarSource[]) {
    super()
  }

  getEvents(): CalendarEvent[] {
    return this.events
  }

  getErrors(): string[] {
    return this.errors
  }

  async refresh(): Promise<CalendarEvent[]> {
    const active = this.sources().filter((s) => s.enabled && s.url.trim())
    const from = new Date(Date.now() - 12 * 3600_000)
    const to = new Date(Date.now() + 14 * 24 * 3600_000)
    const errors: string[] = []
    const lists = await Promise.all(
      active.map(async (s) => {
        try {
          return parseIcs(await fetchIcs(s.url), from, to, s.name)
        } catch (err) {
          errors.push(`${s.name || 'Calendar'}: ${(err as Error).message}`)
          return []
        }
      })
    )
    const byUid = new Map(lists.flat().filter((e) => !e.allDay).map((e) => [e.uid, e]))
    this.events = [...byUid.values()].sort((a, b) => a.start.localeCompare(b.start))
    this.errors = errors
    this.emit('events', this.events)
    return this.events
  }

  start(): void {
    void this.refresh()
    this.timers.push(setInterval(() => void this.refresh(), 10 * 60_000))
    this.timers.push(setInterval(() => this.checkStarting(), 20_000))
  }

  private checkStarting() {
    const now = Date.now()
    for (const e of this.events) {
      const delta = Date.parse(e.start) - now
      if (delta <= 60_000 && delta > -3 * 60_000 && !this.notified.has(e.uid)) {
        this.notified.add(e.uid)
        this.emit('starting', e)
      }
    }
  }

  stop(): void {
    this.timers.forEach(clearInterval)
    this.timers = []
  }
}
