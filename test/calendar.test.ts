import { describe, expect, it } from 'vitest'
import { parseIcs } from '../src/main/calendar'

const ICS = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//EN
BEGIN:VTIMEZONE
TZID:America/Sao_Paulo
BEGIN:STANDARD
DTSTART:19700101T000000
TZOFFSETFROM:-0300
TZOFFSETTO:-0300
TZNAME:-03
END:STANDARD
END:VTIMEZONE
BEGIN:VEVENT
UID:weekly-1
DTSTART;TZID=America/Sao_Paulo:20261102T100000
DTEND;TZID=America/Sao_Paulo:20261102T103000
RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=6
EXDATE;TZID=America/Sao_Paulo:20261109T100000
SUMMARY:Weekly sync
DESCRIPTION:Join: https://us02web.zoom.us/j/123456789?pwd=abc
ATTENDEE;CN=Ana Souza:mailto:ana@example.com
ATTENDEE:mailto:bob@example.com
END:VEVENT
BEGIN:VEVENT
UID:weekly-1
RECURRENCE-ID;TZID=America/Sao_Paulo:20261116T100000
DTSTART;TZID=America/Sao_Paulo:20261116T140000
DTEND;TZID=America/Sao_Paulo:20261116T143000
SUMMARY:Weekly sync (moved)
END:VEVENT
BEGIN:VEVENT
UID:cancelled-1
DTSTART:20261103T150000Z
DTEND:20261103T160000Z
STATUS:CANCELLED
SUMMARY:Cancelled thing
END:VEVENT
BEGIN:VEVENT
UID:allday-1
DTSTART;VALUE=DATE:20261104
DTEND;VALUE=DATE:20261105
SUMMARY:Holiday
END:VEVENT
BEGIN:VEVENT
UID:meet-1
DTSTART:20261105T180000Z
DTEND:20261105T190000Z
SUMMARY:Design review
LOCATION:https://meet.google.com/abc-defg-hij
END:VEVENT
END:VCALENDAR`

describe('parseIcs', () => {
  const events = parseIcs(ICS, new Date('2026-11-01T00:00:00Z'), new Date('2026-11-20T00:00:00Z'), 'Work')

  it('expands recurrences, honours EXDATE and moved exceptions, skips cancelled events', () => {
    const weekly = events.filter((e) => e.title.startsWith('Weekly sync'))
    expect(weekly.map((e) => e.start)).toEqual(['2026-11-02T13:00:00.000Z', '2026-11-16T17:00:00.000Z'])
    expect(weekly[1].title).toBe('Weekly sync (moved)')
    expect(events.some((e) => e.title === 'Cancelled thing')).toBe(false)
  })

  it('extracts attendees, meeting links and all-day flags', () => {
    const first = events.find((e) => e.title === 'Weekly sync')!
    expect(first.attendees).toEqual(['Ana Souza', 'bob@example.com'])
    expect(first.meetingUrl).toBe('https://us02web.zoom.us/j/123456789?pwd=abc')
    expect(first.calendarName).toBe('Work')
    expect(events.find((e) => e.title === 'Design review')!.meetingUrl).toBe('https://meet.google.com/abc-defg-hij')
    expect(events.find((e) => e.title === 'Holiday')!.allDay).toBe(true)
  })
})
