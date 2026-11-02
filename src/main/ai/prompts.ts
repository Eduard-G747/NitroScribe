import { formatClock, formatDuration, meetingDate, mergeTurns, speakerNamer } from '@shared/format'
import type { Meeting, Settings, Template } from '@shared/types'

type PromptMeeting = Pick<Meeting, 'transcript'> & Partial<Pick<Meeting, 'speakers'>>

/** Transcript lines labelled with people's names ("Me" for the user unless a name is set). */
export function transcriptForPrompt(meeting: PromptMeeting, maxChars = 350_000, userName = ''): string {
  const nameOf = speakerNamer(meeting, userName ? `${userName} (me)` : 'Me')
  const text = mergeTurns(meeting.transcript, nameOf, 2500)
    .map((t) => `[${formatClock(t.start)}] ${t.name}: ${t.text}`)
    .join('\n')
  if (text.length <= maxChars) return text
  const half = Math.floor(maxChars / 2)
  return `${text.slice(0, half)}\n[… middle of the transcript omitted for length …]\n${text.slice(-half)}`
}

export function meetingHeader(meeting: Meeting): string {
  const date = meetingDate(meeting)
  return [
    `Title: ${meeting.title.trim() || '(untitled)'}`,
    `Date: ${date.toLocaleString('en-US', { dateStyle: 'full', timeStyle: 'short' })}`,
    meeting.durationMs ? `Duration: ${formatDuration(meeting.durationMs)}` : '',
    meeting.attendees.length ? `Attendees: ${meeting.attendees.join(', ')}` : '',
    meeting.calendarEvent?.description ? `Calendar invite description: ${meeting.calendarEvent.description.slice(0, 1500)}` : ''
  ]
    .filter(Boolean)
    .join('\n')
}

function speakerNote(userName: string): string {
  const me = userName ? `"${userName} (me)"` : '"Me"'
  return (
    `In transcripts, ${me} is the user, who is taking these notes. Other participants are labelled by name when known, or as ` +
    '"Speaker 1", "Speaker 2"… when not (labels come from voice recognition and can occasionally be wrong; "Them" means the other side of ' +
    'the call when voices were not separated). Transcripts are machine-generated and may contain recognition errors: use context to ' +
    'interpret them, but never invent facts.'
  )
}

/** The language Whisper detected for most of the transcript, e.g. "English". */
export function dominantLanguage(meeting: Pick<Meeting, 'transcript'>): string | null {
  const counts = new Map<string, number>()
  for (const s of meeting.transcript) if (s.language) counts.set(s.language, (counts.get(s.language) ?? 0) + s.text.length)
  let best: string | null = null
  let max = 0
  for (const [lang, n] of counts) {
    if (n > max) {
      best = lang
      max = n
    }
  }
  return best ? best.charAt(0).toUpperCase() + best.slice(1) : null
}

function languageRule(settings: Settings, meeting: Meeting): string {
  if (settings.ai.notesLanguage !== 'auto') return `Write in ${settings.ai.notesLanguage}.`
  const spoken = dominantLanguage(meeting)
  return `Write in the same language as the user's notes; if they wrote no notes, use the main language spoken in the meeting${spoken ? ` (${spoken})` : ''}.`
}

export function enhancePrompt(meeting: Meeting, template: Template, settings: Settings): { system: string; user: string } {
  const system = [
    'You are NitroScribe, an expert note-taker. You turn the rough notes a user typed during a meeting, plus the raw meeting transcript, into excellent, well-organized meeting notes.',
    '',
    'How to write the notes:',
    "- The user's notes are the backbone: they show what the user cared about. Keep every point they wrote, preserving their wording where possible, and enrich each one with the relevant specifics from the transcript (facts, numbers, names, decisions, reasons, dates).",
    '- Then add the other important information from the transcript that the user did not capture.',
    '- Follow the template for structure.',
    '- Use Markdown: `###` headings, concise bullet points, nested bullets for details, **bold** sparingly for key facts. No long paragraphs and no tables.',
    '- Be specific and concrete. Avoid filler such as "the team discussed various topics".',
    '- Attribute statements and commitments to people by name when the transcript makes it clear who said them.',
    '- Only include information supported by the notes or the transcript. Never invent anything.',
    '- Do not add a title, date line, attendee list, preamble or closing remarks. Start directly with the first heading.',
    `- ${languageRule(settings, meeting)}`,
    '',
    speakerNote(settings.userName)
  ].join('\n')
  const user = [
    `<template name="${template.name}">`,
    template.instructions,
    '</template>',
    '',
    '<meeting>',
    meetingHeader(meeting),
    '</meeting>',
    '',
    '<my_notes>',
    meeting.notesMarkdown.trim() || '(The user did not write any notes.)',
    '</my_notes>',
    '',
    '<transcript>',
    transcriptForPrompt(meeting, 350_000, settings.userName) || '(No transcript was recorded.)',
    '</transcript>',
    '',
    'Write the enhanced notes now.'
  ].join('\n')
  return { system, user }
}

export function titlePrompt(meeting: Meeting, settings: Settings): { system: string; user: string } {
  const source = (meeting.enhancedMarkdown || meeting.notesMarkdown || transcriptForPrompt(meeting, 6000, settings.userName)).slice(0, 6000)
  const language = settings.ai.notesLanguage !== 'auto' ? settings.ai.notesLanguage : (dominantLanguage(meeting) ?? 'the same language as the notes')
  return {
    system: 'You write short, specific meeting titles.',
    user: `Write a title of at most 6 words for this meeting, in ${language}. Reply with only the title: no quotes, no trailing punctuation.\n\n<notes>\n${source}\n</notes>`
  }
}

export function meetingChatSystem(meeting: Meeting, settings: Settings): string {
  return [
    "You are NitroScribe, an assistant that helps the user with one of their meetings. Answer using the meeting information below. Be concise and specific and use Markdown (short paragraphs, bullets). Quote the transcript when it helps. If the answer is not in the meeting, say so plainly. When asked to draft something (an email, a message, a summary), write it ready to send.",
    'Reply in the language the user writes in.',
    speakerNote(settings.userName),
    `Today is ${new Date().toLocaleDateString('en-US', { dateStyle: 'full' })}.`,
    '',
    '<meeting>',
    meetingHeader(meeting),
    '</meeting>',
    '<my_notes>',
    meeting.notesMarkdown.trim() || '(none)',
    '</my_notes>',
    '<enhanced_notes>',
    meeting.enhancedMarkdown?.trim() || '(not generated yet)',
    '</enhanced_notes>',
    '<transcript>',
    transcriptForPrompt(meeting, 350_000, settings.userName) || '(no transcript)',
    '</transcript>'
  ].join('\n')
}

export function globalChatSystem(records: string, settings: Settings): string {
  return [
    "You are NitroScribe, an assistant with access to the user's past meetings. Answer the question using the meeting records below, which were selected automatically as the most relevant. Say which meeting (title and date) each piece of information comes from. If the records do not contain the answer, say so. Be concise and use Markdown.",
    'Reply in the language the user writes in.',
    speakerNote(settings.userName),
    `Today is ${new Date().toLocaleDateString('en-US', { dateStyle: 'full' })}.`,
    '',
    '<meetings>',
    records || '(The user has no recorded meetings yet.)',
    '</meetings>'
  ].join('\n')
}

/**
 * Asks the model to put names on voice-separated speakers. Returns the prompt and the label → speaker id
 * map (labels are the "Speaker N" names shown in the transcript).
 */
export function speakerIdPrompt(meeting: Meeting, settings: Settings): { system: string; user: string; labels: Map<string, string> } | null {
  const nameOf = speakerNamer(meeting, settings.userName || 'Me')
  const labels = new Map<string, string>()
  for (const s of [...meeting.transcript].sort((a, b) => a.start - b.start)) {
    if (s.speaker !== 'them' || !s.speakerId) continue
    const sp = meeting.speakers?.[s.speakerId]
    if (sp?.nameSource === 'manual' || sp?.nameSource === 'voice') continue
    labels.set(nameOf({ speaker: 'them', speakerId: s.speakerId }), s.speakerId)
  }
  if (!labels.size) return null
  const me = settings.userName || 'Me'
  const list = [...labels.keys()].map((l) => `"${l}"`).join(', ')
  return {
    labels,
    system: 'You figure out who is who in meeting transcripts. You reply with JSON only.',
    user: [
      `Participants other than the user ("${me}") were separated by voice and labelled ${list}.`,
      'Work out the real name of each labelled participant using only evidence in the transcript: self-introductions ("hi, I\'m Ana", "this is Marcus"), people addressing each other by name ("thanks, Sarah" followed by Sarah answering), or the attendee list when the conversation supports it.',
      '',
      'Rules:',
      `- Reply with one JSON object mapping each label to a name, or to null when you are not confident. Example: {"Speaker 1": "Sarah", "Speaker 2": null}`,
      `- Never give the same name to two labels and never use the user's own name ("${me}").`,
      '- Use the name as people say it (first names are fine).',
      meeting.attendees.length ? `\nCalendar attendees: ${meeting.attendees.join(', ')}` : '',
      '',
      '<transcript>',
      transcriptForPrompt(meeting, 80_000, settings.userName),
      '</transcript>'
    ].join('\n')
  }
}

/** Pulls the first JSON object out of a model reply. */
export function parseJsonObject(text: string): Record<string, unknown> | null {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end <= start) return null
  try {
    const v = JSON.parse(text.slice(start, end + 1))
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
  } catch {
    return null
  }
}

/** Strips code fences, a leading H1 and stray whitespace that some models add around Markdown. */
export function cleanMarkdown(text: string): string {
  let t = text.trim()
  const fence = /^```(?:markdown|md)?\s*\n([\s\S]*?)\n```$/i.exec(t)
  if (fence) t = fence[1].trim()
  t = t.replace(/^#\s+[^\n]*\n+/, '')
  return t.trim()
}

export function cleanTitle(text: string): string {
  return text
    .split('\n')[0]
    .replace(/^(title|título|titulo)\s*:\s*/i, '')
    .replace(/^["'“”«»*#\s]+|["'“”«».*\s]+$/g, '')
    .slice(0, 80)
    .trim()
}
