import { describe, expect, it } from 'vitest'
import { actionItemsToIcs, googleCalendarUrl } from '@shared/calendarExport'
import { defaultSettings } from '@shared/defaults'
import type { ActionItem, Meeting } from '@shared/types'
import { resolveDue } from '@shared/dueDates'
import { actionItemsPrompt, dropEmptySections, parseActionItems, refineActionItems } from '../src/main/ai/prompts'

describe('weekly review cleanup', () => {
  it('drops sections a small model filled with "None"', () => {
    const md = '### The week in short\nOne meeting.\n\n### Decisions\n- Beta on Nov 15 (Q4 review)\n\n### Open loops\nNone\n\n### Coming up\n- None.\n\nNote: There are no upcoming tasks this week.'
    expect(dropEmptySections(md)).toBe('### The week in short\nOne meeting.\n\n### Decisions\n- Beta on Nov 15 (Q4 review)')
  })
})

describe('deadlines from what people said', () => {
  const wed = new Date(2026, 10, 4) // Wednesday, Nov 4 2026
  it('resolves weekdays, relative phrases and dates against the meeting day', () => {
    const cases: [string, string | undefined][] = [
      ['by Friday', '2026-11-06'],
      ['on Monday', '2026-11-09'],
      ['next Tuesday', '2026-11-10'],
      ['next Friday', '2026-11-13'],
      ['Wednesday', '2026-11-11'],
      ['by Fri', '2026-11-06'],
      ['tomorrow', '2026-11-05'],
      ['by end of the week', '2026-11-06'],
      ['next week', '2026-11-13'],
      ['end of month', '2026-11-30'],
      ['in 2 weeks', '2026-11-18'],
      ['Nov 15', '2026-11-15'],
      ['by the 3rd of December', '2026-12-03'],
      ['Jan 10', '2027-01-10'],
      ['end of the quarter', '2026-12-31'],
      ['send the monthly report', undefined],
      ['we sat down with legal', undefined]
    ]
    for (const [text, expected] of cases) expect(resolveDue(text, wed), text).toBe(expected)
  })

  it('cleans up a small model: owners, real deadlines, mine, no duplicates', () => {
    const meeting = {
      startedAt: new Date(2026, 10, 4, 10).toISOString(),
      createdAt: '',
      enhancedMarkdown: '### Next steps\n- [ ] Marcus: start the API migration on Monday\n- [ ] Sarah: share the updated timeline by Friday\n- [ ] Eduardo: schedule a sync for next Tuesday',
      transcript: []
    } as unknown as Meeting
    const messy = [
      { task: 'share the updated timeline', owner: 'Sarah', mine: false, due: '2026-11-05', details: 'for everyone' },
      { task: 'start the API migration', owner: 'Marcus', mine: false, details: 'for the API migration', time: '08:00' },
      { task: 'start the API migration', mine: false, details: 'for the API migration' },
      { task: 'schedule a sync', mine: false, details: 'for next Tuesday' }
    ]
    const refined = refineActionItems(messy, meeting, 'Eduardo')
    expect(refined[1].time).toBeUndefined()
    expect(refined.map((i) => [i.task, i.owner, i.mine, i.due])).toEqual([
      ['Share the updated timeline', 'Sarah', false, '2026-11-06'],
      ['Start the API migration', 'Marcus', false, '2026-11-09'],
      ['Schedule a sync', 'Eduardo', true, '2026-11-10']
    ])
    expect(refineActionItems(null, meeting, 'Eduardo').map((i) => i.task)).toEqual(['Start the API migration on Monday', 'Share the updated timeline by Friday', 'Schedule a sync for next Tuesday'])
  })
})

const item = (p: Partial<ActionItem> = {}): ActionItem => ({ id: 'a1', task: 'Send the updated timeline', mine: true, done: false, ...p })
const ctx = (i: ActionItem) => ({ item: i, meetingTitle: 'Q4 review', meetingDate: new Date(2026, 9, 15, 10) })

describe('action items', () => {
  it('parses model replies leniently and drops invented fields', () => {
    const reply = 'Here you go:\n```json\n[{"task":"Send the timeline","owner":"Sarah","mine":false,"due":"2026-10-17","time":"15:00","details":"For the launch"},' +
      '{"task":"Book the room","owner":null,"mine":"true","due":"Friday","time":"3pm"},{"owner":"nobody"}]\n```'
    expect(parseActionItems(reply)).toEqual([
      { task: 'Send the timeline', owner: 'Sarah', mine: false, due: '2026-10-17', time: '15:00', details: 'For the launch' },
      { task: 'Book the room', owner: undefined, mine: true, due: undefined, time: undefined, details: undefined }
    ])
    expect(parseActionItems('[]')).toEqual([])
    expect(parseActionItems('I could not find any.')).toBeNull()
  })

  it('gives the model the meeting date to resolve "Friday"', () => {
    const m = { id: 'm', title: 'Q4 review', createdAt: '2026-10-15T17:00:00.000Z', startedAt: '2026-10-15T17:00:00.000Z', updatedAt: '', durationMs: 0, notesHtml: '', notesMarkdown: '- ship it', enhancedMarkdown: '### Next steps\n- Sarah: timeline by Friday', transcript: [], chat: [], attendees: [] } as Meeting
    const { user } = actionItemsPrompt(m, { ...defaultSettings(), userName: 'Eduardo' })
    expect(user).toContain('(2026-10-15)')
    expect(user).toContain('"Eduardo" (shown as "Eduardo (me)" in the transcript)')
    expect(user).toContain('<ai_notes>\n### Next steps')
    expect(user).not.toContain('<transcript>')
  })

  it('builds Google Calendar links for all-day and timed deadlines', () => {
    const allDay = new URL(googleCalendarUrl(ctx(item({ due: '2026-10-31' })), 'America/Vancouver'))
    expect(allDay.origin + allDay.pathname).toBe('https://calendar.google.com/calendar/render')
    expect(allDay.searchParams.get('action')).toBe('TEMPLATE')
    expect(allDay.searchParams.get('text')).toBe('Send the updated timeline')
    expect(allDay.searchParams.get('dates')).toBe('20261031/20261101')
    expect(allDay.searchParams.get('details')).toContain('From the meeting "Q4 review"')
    const timed = new URL(googleCalendarUrl(ctx(item({ due: '2026-10-17', time: '15:00', owner: 'Sarah', mine: false })), 'America/Vancouver'))
    expect(timed.searchParams.get('dates')).toBe('20261017T150000/20261017T153000')
    expect(timed.searchParams.get('ctz')).toBe('America/Vancouver')
    expect(timed.searchParams.get('details')).toContain('Owner: Sarah')
    expect(new URL(googleCalendarUrl(ctx(item()))).searchParams.has('dates')).toBe(false)
  })

  it('writes a valid .ics file with only dated items', () => {
    const ics = actionItemsToIcs([ctx(item({ due: '2026-10-31', task: 'Review, sign; and send' })), ctx(item({ id: 'a2', due: '2026-11-02', time: '09:30' })), ctx(item({ id: 'a3' }))], new Date('2026-10-15T00:00:00Z'))
    const lines = ics.split('\r\n')
    expect(lines[0]).toBe('BEGIN:VCALENDAR')
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(2)
    expect(lines).toContain('DTSTART;VALUE=DATE:20261031')
    expect(lines).toContain('DTEND;VALUE=DATE:20261101')
    expect(lines).toContain('DTSTART:20261102T093000')
    expect(lines).toContain('SUMMARY:Review\\, sign\\; and send')
    expect(lines.every((l) => new TextEncoder().encode(l).length <= 75)).toBe(true)
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true)
  })
})
