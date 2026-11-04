import { randomUUID } from 'node:crypto'
import type { ImportPreview, ImportRequest, Meeting, MeetingSpeaker, TranscriptSegment } from '@shared/types'
import { docxToText } from './docx'
import { isGenericSpeaker, parseTranscript } from './parse'

export const MAX_IMPORT_BYTES = 25 * 1024 * 1024

const MEDIA = /\.(mp3|wav|m4a|mp4|webm|ogg|opus|flac|aac|wma|mov|mkv|avi)$/i
const UNSUPPORTED = /\.(doc|pdf|rtf|pages|odt|xlsx?|pptx?)$/i

function decodeText(buf: Buffer): string {
  if (buf[0] === 0xff && buf[1] === 0xfe) return buf.subarray(2).toString('utf16le')
  if (buf[0] === 0xfe && buf[1] === 0xff) return Buffer.from(buf.subarray(2)).swap16().toString('utf16le')
  return buf.toString('utf8')
}

/** Reads a transcript file of any supported format into a preview the user can review. */
export function previewFile(buf: Buffer, fileName: string): ImportPreview {
  if (MEDIA.test(fileName)) throw new Error('That is a recording, not a transcript. Drop it on the window or use Import to transcribe it.')
  if (buf.length > MAX_IMPORT_BYTES) throw new Error('This file is too big to be a transcript (25 MB max).')
  if (UNSUPPORTED.test(fileName)) throw new Error('This file type is not supported. Save the transcript as .txt or .docx and try again.')
  const isDocx = /\.docx$/i.test(fileName) || (buf[0] === 0x50 && buf[1] === 0x4b)
  const preview = parseTranscript(isDocx ? docxToText(buf) : decodeText(buf), fileName, isDocx ? 'Word document' : undefined)
  if (!preview.lines.length) throw new Error('No transcript text was found in this file.')
  return preview
}

export function previewText(text: string): ImportPreview {
  if (text.length > MAX_IMPORT_BYTES) throw new Error('That is too much text for one transcript.')
  const preview = parseTranscript(text, '', 'Pasted text')
  if (!preview.lines.length) throw new Error('Paste the transcript text first.')
  return preview
}

const num = (v: unknown, fallback = 0) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.round(v) : fallback)
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '')

/**
 * Builds the meeting for a reviewed import. The user's own lines become "me"; everyone else keeps the
 * name from the file (generic labels like "Speaker 2" stay unnamed so the AI can still identify them).
 */
export function meetingFromImport(req: ImportRequest): Partial<Meeting> {
  const startedAt = new Date(str(req.startedAt, 40))
  if (Number.isNaN(startedAt.getTime())) throw new Error('Pick when the meeting happened.')
  const lines = (Array.isArray(req.lines) ? req.lines : []).slice(0, 200_000)
  const ids = new Map<string, string>()
  const speakers: Record<string, MeetingSpeaker> = {}
  const transcript: TranscriptSegment[] = []
  for (const l of lines) {
    const text = str(l?.text, 20_000).trim()
    if (!text) continue
    const speaker = str(l.speaker, 60).trim()
    const isMe = !!req.me && speaker === req.me
    let speakerId: string | undefined
    if (!isMe && speaker) {
      speakerId = ids.get(speaker)
      if (!speakerId) {
        speakerId = `s${ids.size + 1}`
        ids.set(speaker, speakerId)
        speakers[speakerId] = isGenericSpeaker(speaker) ? { id: speakerId } : { id: speakerId, name: speaker, nameSource: 'manual' }
      }
    }
    const start = num(l.start)
    transcript.push({ id: randomUUID(), speaker: isMe ? 'me' : 'them', speakerId, text, start, end: Math.max(start, num(l.end, start)) })
  }
  if (!transcript.length) throw new Error('The transcript is empty.')
  transcript.sort((a, b) => a.start - b.start)
  const iso = startedAt.toISOString()
  return {
    title: str(req.title, 300).trim(),
    createdAt: iso,
    startedAt: iso,
    durationMs: Math.max(...transcript.map((s) => s.end)),
    transcript,
    speakers,
    attendees: [],
    source: { kind: 'import', fileName: str(req.fileName, 260) || undefined, format: str(req.format, 60) || 'Text', importedAt: new Date().toISOString() }
  }
}
