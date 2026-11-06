import { describe, expect, it } from 'vitest'
import { buildPeople, inWeek, shiftWeek, splitEmail, talkTime, weekOf } from '@shared/insights'
import type { ActionItem, Meeting, MeetingSummary } from '@shared/types'

const summary = (id: string, date: Date, participants: string[], actionItems: Partial<ActionItem>[] = []): MeetingSummary =>
  ({
    id,
    title: id,
    createdAt: date.toISOString(),
    startedAt: date.toISOString(),
    participants,
    actionItems: actionItems.map((a, i) => ({ id: `${id}-${i}`, task: 'x', mine: false, done: false, ...a }))
  }) as MeetingSummary

describe('weeks', () => {
  it('starts weeks on Monday in local time', () => {
    expect(weekOf(new Date(2026, 10, 4, 15))).toBe('2026-11-02') // Wednesday
    expect(weekOf(new Date(2026, 10, 8, 23))).toBe('2026-11-02') // Sunday night
    expect(weekOf(new Date(2026, 10, 9, 0, 5))).toBe('2026-11-09') // Monday
    expect(shiftWeek('2026-11-02', -1)).toBe('2026-10-26')
    expect(shiftWeek('2026-12-28', 1)).toBe('2027-01-04')
    expect(inWeek(summary('a', new Date(2026, 10, 8, 23), []), '2026-11-02')).toBe(true)
    expect(inWeek(summary('a', new Date(2026, 10, 9, 0, 5), []), '2026-11-02')).toBe(false)
  })
})

describe('talk time', () => {
  it('adds up speaking time per person', () => {
    const meeting = {
      speakers: { 'spk-1': { id: 'spk-1', name: 'Sarah' } },
      transcript: [
        { id: 'a', speaker: 'me', text: 'hi', start: 0, end: 10_000 },
        { id: 'b', speaker: 'them', speakerId: 'spk-1', text: 'hello', start: 10_000, end: 30_000 },
        { id: 'c', speaker: 'them', speakerId: 'spk-1', text: 'more', start: 30_000, end: 40_000 },
        { id: 'd', speaker: 'them', speakerId: 'spk-2', text: 'yo', start: 40_000, end: 50_000 }
      ]
    } as unknown as Meeting
    const talk = talkTime(meeting, 'Eduardo')
    expect(talk.map((t) => [t.key, Math.round(t.share * 100)])).toEqual([
      ['spk-1', 60],
      ['me', 20],
      ['spk-2', 20]
    ])
    expect(talk[0]).toMatchObject({ name: 'Sarah', ms: 30_000 })
  })
})

describe('people', () => {
  it('merges first names, skips the user, and splits promised vs owed', () => {
    const meetings = [
      summary('m2', new Date(2026, 10, 3), ['Sarah Chen', 'Priya', 'Eduardo'], [{ owner: 'Priya', task: 'Draft the contract' }]),
      summary('m1', new Date(2026, 10, 1), ['Sarah Chen', 'Marcus'], [
        { owner: 'sarah', task: 'Send the deck' },
        { mine: true, task: 'Book the room' },
        { owner: 'Sarah', task: 'Old thing', done: true }
      ])
    ]
    const people = buildPeople(meetings, 'Eduardo Georgescu')
    expect(people.map((p) => p.name)).toEqual(['Sarah Chen', 'Priya', 'Marcus'])
    const sarah = people[0]
    expect(sarah.meetings.map((m) => m.id)).toEqual(['m2', 'm1'])
    expect(sarah.promised.map((e) => e.item.task)).toEqual(['Send the deck'])
    expect(sarah.owed.map((e) => e.item.task)).toEqual(['Book the room'])
    expect(people[1].promised.map((e) => e.item.task)).toEqual(['Draft the contract'])
    expect(people[2].owed.map((e) => e.item.task)).toEqual(['Book the room'])
  })
})

describe('follow-up email', () => {
  it('splits the subject from the body', () => {
    expect(splitEmail('Subject: Q4 recap\n\nHi all,\nThanks!')).toEqual({ subject: 'Q4 recap', body: 'Hi all,\nThanks!' })
    expect(splitEmail('**Subject:** Next steps\nHi Sarah')).toEqual({ subject: 'Next steps', body: 'Hi Sarah' })
    expect(splitEmail('Hi team')).toEqual({ subject: '', body: 'Hi team' })
  })
})
