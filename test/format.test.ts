import { describe, expect, it } from 'vitest'
import { formatClock, isUntitled, meetingFileBase, mergeTurns, transcriptToSrt, transcriptToText } from '@shared/format'
import type { TranscriptSegment } from '@shared/types'

const seg = (speaker: 'me' | 'them', start: number, end: number, text: string): TranscriptSegment => ({ id: `${start}`, speaker, start, end, text })

describe('format', () => {
  it('formats clocks', () => {
    expect(formatClock(0)).toBe('0:00')
    expect(formatClock(65_400)).toBe('1:05')
    expect(formatClock(3_725_000)).toBe('1:02:05')
  })

  it('merges consecutive turns from the same speaker', () => {
    const turns = mergeTurns([seg('them', 5000, 7000, 'B'), seg('me', 0, 2000, 'A1'), seg('me', 2500, 4000, 'A2'), seg('me', 20_000, 21_000, 'A3')])
    expect(turns.map((t) => [t.speaker, t.text])).toEqual([
      ['me', 'A1 A2'],
      ['them', 'B'],
      ['me', 'A3']
    ])
  })

  it('exports text and SRT', () => {
    const m = { transcript: [seg('me', 1000, 2500, 'Hello'), seg('them', 3000, 4000, 'Hi')] }
    expect(transcriptToText(m, 'Ana')).toBe('[0:01] Ana: Hello\n[0:03] Them: Hi')
    expect(transcriptToSrt(m)).toBe('1\n00:00:01,000 --> 00:00:02,500\nMe: Hello\n\n2\n00:00:03,000 --> 00:00:04,000\nThem: Hi\n')
  })

  it('builds safe file names', () => {
    const name = meetingFileBase({ title: 'Q3: plan / review?', createdAt: '2026-03-04T10:00:00' })
    expect(name).toBe('2026-03-04 Q3 plan review')
  })

  it('recognizes untitled meetings', () => {
    expect(isUntitled('')).toBe(true)
    expect(isUntitled('Untitled meeting')).toBe(true)
    expect(isUntitled('Weekly sync')).toBe(false)
  })
})
