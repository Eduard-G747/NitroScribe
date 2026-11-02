import { describe, expect, it } from 'vitest'
import { deflateRawSync } from 'node:zlib'
import { transcriptToJson, transcriptToMarkdown, transcriptToText } from '@shared/format'
import { isLocalUrl } from '@shared/net'
import type { Meeting } from '@shared/types'
import { meetingFromImport, previewFile, previewText } from '../src/main/import'
import { findDate, parseTimestamp, parseTranscript } from '../src/main/import/parse'

const summary = (text: string, name = '') => {
  const p = parseTranscript(text, name)
  return { ...p, rows: p.lines.map((l) => `${l.speaker ?? '-'}@${l.start}: ${l.text}`) }
}

/** Minimal ZIP writer, enough to build a .docx for the reader. */
function zip(files: Record<string, string>): Buffer {
  const parts: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0
  for (const [name, content] of Object.entries(files)) {
    const data = deflateRawSync(Buffer.from(content))
    const n = Buffer.from(name)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(8, 8)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(Buffer.byteLength(content), 22)
    local.writeUInt16LE(n.length, 26)
    const c = Buffer.alloc(46)
    c.writeUInt32LE(0x02014b50, 0)
    c.writeUInt16LE(8, 10)
    c.writeUInt32LE(data.length, 20)
    c.writeUInt32LE(Buffer.byteLength(content), 24)
    c.writeUInt16LE(n.length, 28)
    c.writeUInt32LE(offset, 42)
    parts.push(local, n, data)
    central.push(c, n)
    offset += 30 + n.length + data.length
  }
  const cd = Buffer.concat(central)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(Object.keys(files).length, 8)
  end.writeUInt16LE(Object.keys(files).length, 10)
  end.writeUInt32LE(cd.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...parts, cd, end])
}

describe('timestamps and dates', () => {
  it('parses common timestamp shapes', () => {
    expect(parseTimestamp('0:05')).toBe(5000)
    expect(parseTimestamp('01:02:03')).toBe(3723000)
    expect(parseTimestamp('00:00:01.170')).toBe(1170)
    expect(parseTimestamp('00:00:01,5')).toBe(1500)
    expect(parseTimestamp('1:75')).toBeNull()
  })
  it('finds meeting dates in names and headers', () => {
    expect(findDate('GMT20251015-153000_Recording.transcript.vtt')).toBe('2025-10-15T15:30:00.000Z')
    expect(new Date(findDate('weekly-sync-2025-10-15.txt')!).getDate()).toBe(15)
    const d = new Date(findDate('Weekly sync\nOctober 15, 2025, 3:00PM')!)
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()]).toEqual([2025, 9, 15, 15])
    expect(new Date(findDate('Recorded 3 Mar 2024')!).getMonth()).toBe(2)
    expect(findDate('Team sync notes')).toBeUndefined()
  })
})

describe('parseTranscript', () => {
  it('reads Zoom WebVTT with "Name: text" captions', () => {
    const p = summary(
      'WEBVTT\n\n1\n00:00:01.170 --> 00:00:04.470\nAlex Rivera: Hello everyone, thanks for joining.\n\n2\n00:00:05.000 --> 00:00:08.000\nSarah Chen: Happy to be here.\n\n3\n00:00:08.500 --> 00:00:10.000\nAlex Rivera: Sounds good.\n',
      'GMT20251015-153000_Recording.transcript.vtt'
    )
    expect(p.format).toBe('WebVTT captions')
    expect(p.timed).toBe(true)
    expect(p.rows).toEqual(['Alex Rivera@1170: Hello everyone, thanks for joining.', 'Sarah Chen@5000: Happy to be here.', 'Alex Rivera@8500: Sounds good.'])
    expect(p.speakers).toEqual([
      { name: 'Alex Rivera', lines: 2 },
      { name: 'Sarah Chen', lines: 1 }
    ])
    expect(p.date).toBe('2025-10-15T15:30:00.000Z')
  })

  it('reads Teams WebVTT voice tags and decodes entities', () => {
    const p = summary('WEBVTT\n\nab12/12-0\n00:00:03.059 --> 00:00:05.769\n<v Alex Rivera>Hello everyone.</v>\n\nab12/13-0\n00:00:06.000 --> 00:00:09.250\n<v Sarah Chen>Q&amp;A at the end.</v>\n')
    expect(p.rows).toEqual(['Alex Rivera@3059: Hello everyone.', 'Sarah Chen@6000: Q&A at the end.'])
  })

  it('reads SRT subtitles', () => {
    const p = summary('1\n00:00:01,000 --> 00:00:03,500\nMarcus: We should ship on Friday.\n\n2\n00:00:04,000 --> 00:00:06,000\nPriya: Agreed, after the review.\n')
    expect(p.format).toBe('SRT subtitles')
    expect(p.rows).toEqual(['Marcus@1000: We should ship on Friday.', 'Priya@4000: Agreed, after the review.'])
  })

  it('reads Teams/Otter style blocks with a header', () => {
    const p = summary(
      'Weekly sync\nOctober 15, 2025, 3:00PM\n45m 12s\n\nAlex Rivera   0:03\nHello everyone, let us get going.\n\nSarah Chen   0:15\nThanks. First item is the roadmap.\nIt slipped by a week.\n\nAlex Rivera   1:02\nUnderstood.\n'
    )
    expect(p.title).toBe('Weekly sync')
    expect(new Date(p.date!).getHours()).toBe(15)
    expect(p.rows).toEqual([
      'Alex Rivera@3000: Hello everyone, let us get going.',
      'Sarah Chen@15000: Thanks. First item is the roadmap. It slipped by a week.',
      'Alex Rivera@62000: Understood.'
    ])
  })

  it('reads Google Meet style transcripts with periodic timestamps', () => {
    const p = summary('Project kickoff - Transcript\n00:00:00\n\nEduard: Welcome to the kickoff.\nDana: Thanks for having me.\n\n00:05:00\n\nEduard: Let us review the timeline.\n')
    expect(p.title).toBe('Project kickoff')
    expect(p.rows[0]).toBe('Eduard@0: Welcome to the kickoff.')
    expect(p.rows[2]).toBe('Eduard@300000: Let us review the timeline.')
    expect(p.lines[1].start).toBeGreaterThan(0)
  })

  it('round-trips NitroScribe text, Markdown and JSON exports', () => {
    const meeting: Meeting = {
      id: 'm1',
      title: 'Budget review',
      createdAt: '2025-10-15T15:00:00.000Z',
      updatedAt: '2025-10-15T15:00:00.000Z',
      startedAt: '2025-10-15T15:00:00.000Z',
      durationMs: 9000,
      notesHtml: '',
      notesMarkdown: '',
      transcript: [
        { id: 'a', speaker: 'me', text: 'What is the budget?', start: 0, end: 1500 },
        { id: 'b', speaker: 'them', speakerId: 's1', text: 'About forty thousand.', start: 2000, end: 4000 },
        { id: 'c', speaker: 'them', speakerId: 's2', text: 'For the whole quarter.', start: 6000, end: 9000 }
      ],
      speakers: { s1: { id: 's1', name: 'Sarah' }, s2: { id: 's2', name: 'Marcus' } },
      chat: [],
      attendees: []
    }
    const expected = ['Eduardo@0: What is the budget?', 'Sarah@2000: About forty thousand.', 'Marcus@6000: For the whole quarter.']
    expect(summary(transcriptToText(meeting, 'Eduardo')).rows).toEqual(expected)
    const md = summary(transcriptToMarkdown(meeting, 'Eduardo'))
    expect(md.rows).toEqual(expected)
    expect(md.title).toBe('Budget review')
    const json = summary(transcriptToJson(meeting, 'Eduardo'))
    expect(json.format).toBe('NitroScribe export')
    expect(json.rows).toEqual(expected)
    expect(json.suggestedMe).toBe('Eduardo')
    expect(json.date).toBe('2025-10-15T15:00:00.000Z')
  })

  it('reads speaker-less text and estimates times', () => {
    const p = summary('We discussed the Q4 roadmap and agreed to hire two contractors.\n\nThe launch moves to November.')
    expect(p.timed).toBe(false)
    expect(p.speakers).toEqual([])
    expect(p.lines).toHaveLength(2)
    expect(p.lines[1].start).toBeGreaterThan(p.lines[0].start)
  })

  it('does not mistake "Note:" or links for speakers, and keeps continuation lines', () => {
    const p = summary('Note: this call was recorded.\nSarah: Hi all, see https://example.com/doc\nfor the agenda.\nSarah: Let us begin.\nMarcus: Sounds good.\n')
    expect(p.speakers.map((s) => s.name)).toEqual(['Sarah', 'Marcus'])
    expect(p.rows[0]).toBe('Sarah@0: Hi all, see https://example.com/doc for the agenda.')
  })

  it('understands "Me"/"Them" labels from other note apps', () => {
    const p = summary('Me: Thanks for joining.\nThem: No problem.\nMe: Let us start.')
    expect(p.speakers.map((s) => s.name)).toEqual(['Me', 'Them'])
  })
})

describe('import files', () => {
  it('reads Word (.docx) transcripts', () => {
    const p = (t: string) => `<w:p><w:r><w:t xml:space="preserve">${t}</w:t></w:r></w:p>`
    const xml =
      '<?xml version="1.0"?><w:document><w:body>' +
      p('Weekly sync') +
      p('October 15, 2025, 3:00PM') +
      '<w:p><w:r><w:t>Alex Rivera</w:t></w:r><w:r><w:tab/><w:t>0:03</w:t></w:r></w:p>' +
      p('Hello &amp; welcome.') +
      '<w:p><w:r><w:t>Sarah Chen</w:t></w:r><w:r><w:tab/><w:t>0:15</w:t></w:r></w:p>' +
      p('Thanks.') +
      '</w:body></w:document>'
    const preview = previewFile(zip({ '[Content_Types].xml': '<Types/>', 'word/document.xml': xml }), 'Weekly sync.docx')
    expect(preview.format).toBe('Word document')
    expect(preview.title).toBe('Weekly sync')
    expect(preview.lines.map((l) => `${l.speaker}: ${l.text}`)).toEqual(['Alex Rivera: Hello & welcome.', 'Sarah Chen: Thanks.'])
  })

  it('reads UTF-16 text files and rejects media files', () => {
    const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('Ana: Olá a todos.\nBruno: Bom dia.', 'utf16le')])
    expect(previewFile(utf16, 'notes.txt').lines.map((l) => l.speaker)).toEqual(['Ana', 'Bruno'])
    expect(() => previewFile(Buffer.from('x'), 'call.mp3')).toThrow(/audio or video/)
    expect(() => previewText('   ')).toThrow()
  })

  it('builds a meeting: the user becomes "me", generic labels stay unnamed', () => {
    const preview = parseTranscript('Speaker 1: Hello.\nEduard: Hi there.\nSarah: Hey.\nSpeaker 1: Shall we?\n')
    const m = meetingFromImport({ title: 'Sync', startedAt: '2025-10-15T15:00:00.000Z', lines: preview.lines, me: 'Eduard', fileName: 'sync.txt', format: preview.format })
    expect(m.transcript!.map((s) => [s.speaker, s.speakerId ?? null])).toEqual([
      ['them', 's1'],
      ['me', null],
      ['them', 's2'],
      ['them', 's1']
    ])
    expect(m.speakers).toEqual({ s1: { id: 's1' }, s2: { id: 's2', name: 'Sarah', nameSource: 'manual' } })
    expect(m.startedAt).toBe('2025-10-15T15:00:00.000Z')
    expect(m.createdAt).toBe(m.startedAt)
    expect(m.durationMs).toBe(m.transcript![3].end)
    expect(m.source).toMatchObject({ kind: 'import', fileName: 'sync.txt', format: 'Text' })
    expect(() => meetingFromImport({ title: '', startedAt: 'not a date', lines: preview.lines, fileName: '', format: '' })).toThrow()
  })
})

describe('isLocalUrl', () => {
  it('accepts this PC and the local network only', () => {
    for (const u of ['http://127.0.0.1:11434', 'http://localhost:1234/v1', 'http://[::1]:8080', 'http://192.168.1.20:11434', 'http://10.0.0.5', 'http://172.20.1.1', 'http://nas.local:11434', 'http://100.101.1.2'])
      expect(isLocalUrl(u), u).toBe(true)
    for (const u of ['https://api.openai.com/v1', 'https://8.8.8.8', 'http://172.32.0.1', 'https://example.com', 'not a url', ''])
      expect(isLocalUrl(u), u).toBe(false)
  })
})
