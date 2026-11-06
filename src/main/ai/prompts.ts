import { resolveDue } from '@shared/dueDates'
import { formatClock, formatDuration, meetingDate, mergeTurns, speakerNamer } from '@shared/format'
import type { ActionItem, Meeting, Settings, Template } from '@shared/types'

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

const dueText = (i: ActionItem) =>
  i.due ? ` (by ${new Date(`${i.due}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}${i.time ? ` ${i.time}` : ''})` : ''

/** The user message for a recap email; the system prompt is the meeting chat context. */
export function followUpPrompt(meeting: Meeting, settings: Settings): string {
  const items = (meeting.actionItems ?? []).filter((i) => !i.done)
  return [
    'Write a follow-up email I can send to the other participants right after this meeting.',
    'Format exactly:',
    'Subject: <short, specific subject>',
    '',
    '<body>',
    '',
    'The body: a greeting (first names if known), one or two sentences on what the meeting was about and how it ended, "Decisions:" as short bullets (only real decisions; skip the section if there were none), "Action items:" as bullets like "- Name: task (by date)", the next meeting if one was set, then a short friendly closing signed with my name' +
      (settings.userName ? ` (${settings.userName})` : '') +
      '.',
    'Plain text only: no markdown headings or bold. Bullets start with "- ". Under 200 words. Only facts from the meeting.',
    languageRule(settings, meeting),
    items.length ? `\nUse these action items (already checked):\n${items.map((i) => `- ${i.mine ? settings.userName || 'Me' : (i.owner ?? 'Someone')}: ${i.task}${dueText(i)}`).join('\n')}` : ''
  ].join('\n')
}

/** A short review of a week of meetings. */
export function digestPrompt(meetings: Meeting[], open: { item: ActionItem; meeting: string }[], label: string, settings: Settings): { system: string; user: string } {
  const per = Math.max(1200, Math.floor(60_000 / Math.max(1, meetings.length)))
  const records = meetings.map((m) => {
    const body = (m.enhancedMarkdown?.trim() || m.notesMarkdown.trim() || transcriptForPrompt(m, per, settings.userName)).slice(0, per)
    return `<meeting title="${(m.title || 'Untitled').replace(/"/g, "'")}" date="${meetingDate(m).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}">\n${body}\n</meeting>`
  })
  return {
    system: `You write a short weekly review of ${settings.userName || 'the user'}'s meetings. Be concrete, use names and numbers, never invent anything.`,
    user: [
      `Review the week of ${label}: ${meetings.length} meeting${meetings.length === 1 ? '' : 's'}.`,
      'Use these Markdown sections: `### The week in short` (2-4 sentences: what happened, what moved forward, what is at risk), `### Decisions` (every concrete decision, number or commitment from the notes, as bullets ending with the meeting name in parentheses), `### Risks and questions` (only if any were raised).',
      'The open action items are listed separately below your review, so don\'t repeat them as a list. Leave out a section that would be empty; never write "None".',
      settings.ai.notesLanguage !== 'auto' ? `Write in ${settings.ai.notesLanguage}.` : 'Write in the language most of the meetings used.',
      '',
      ...records,
      open.length ? `\nOpen action items:\n${open.map(({ item, meeting }) => `- ${item.mine ? 'Me' : (item.owner ?? 'Someone')}: ${item.task}${dueText(item)} [${meeting}]`).join('\n')}` : ''
    ].join('\n')
  }
}

/** Removes sections a small model filled with "None", and "Note: there is nothing…" filler. */
export function dropEmptySections(markdown: string): string {
  const empty = /^(?:[-*]\s*)?(?:none|n\/a|nothing(?: to report)?|no (?:\w+ ?){1,3})\.?$/i
  return markdown
    .replace(/\n*^\**note:?\**.*\b(no|none|nothing)\b.*$/gim, '')
    .split(/(?=^#{2,4} )/m)
    .filter((part) => {
      if (!/^#{2,4} /.test(part)) return true
      const body = part.replace(/^#{2,4} .*\n?/, '').trim()
      return body && !body.split('\n').every((l) => !l.trim() || empty.test(l.trim()))
    })
    .join('')
    .trim()
}

/** Asks for the meeting's action items as JSON, with relative deadlines resolved against the meeting date. */
export function actionItemsPrompt(meeting: Meeting, settings: Settings): { system: string; user: string } {
  const date = meetingDate(meeting)
  const me = settings.userName || 'Me'
  const day = (d: Date) => `${d.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })} (${d.toISOString().slice(0, 10)})`
  const notes = (meeting.enhancedMarkdown || '').trim()
  return {
    system: 'You extract action items from meetings. You reply with JSON only.',
    user: [
      `The meeting "${meeting.title || 'Untitled'}" took place on ${day(date)}. Use that date to turn relative deadlines ("Friday", "next week", "end of month") into real dates.`,
      `The user taking these notes is "${me}"${settings.userName ? ` (shown as "${me} (me)" in the transcript)` : ''}.`,
      '',
      'List every concrete action item: something a person committed to do, or was asked to do.',
      'Reply with a JSON array. Each item: {"task": "short, specific, starts with a verb", "owner": "name or null", "mine": true or false, "due_text": "the deadline exactly as said, e.g. \\"by Friday\\", or null", "due": "YYYY-MM-DD" or null, "time": "HH:MM" or null, "details": "one sentence: what exactly, for whom, why"}',
      'Rules:',
      `- "mine" is true only when ${me} owns the item.`,
      '- Use a deadline only if one was said; never invent one. A time only if a time was said.',
      '- Only items actually discussed, no duplicates, at most 20. Reply [] if there are none.',
      '',
      notes ? `<ai_notes>\n${notes}\n</ai_notes>` : '',
      meeting.notesMarkdown.trim() ? `<my_notes>\n${meeting.notesMarkdown.trim()}\n</my_notes>` : '',
      meeting.transcript.length ? `<transcript>\n${transcriptForPrompt(meeting, notes ? 40_000 : 120_000, settings.userName)}\n</transcript>` : ''
    ]
      .filter((l, i, all) => l || all[i - 1])
      .join('\n')
  }
}

export type FoundItem = Omit<ActionItem, 'id' | 'done'> & { dueText?: string }

/** Validates the model's action items; null when the reply isn't a JSON array. */
export function parseActionItems(text: string): FoundItem[] | null {
  const start = text.indexOf('[')
  const end = text.lastIndexOf(']')
  if (start === -1 || end <= start) return /^\s*\{\s*\}\s*$|none/i.test(text) ? [] : null
  let raw: unknown
  try {
    raw = JSON.parse(text.slice(start, end + 1))
  } catch {
    return null
  }
  if (!Array.isArray(raw)) return null
  const str = (v: unknown, max: number) => (typeof v === 'string' && v.trim() && !/^(null|none|n\/a|unknown)$/i.test(v.trim()) ? v.trim().slice(0, max) : undefined)
  const out: FoundItem[] = []
  for (const r of raw.slice(0, 30)) {
    if (!r || typeof r !== 'object') continue
    const o = r as Record<string, unknown>
    const task = str(o.task ?? o.title ?? o.action, 300)
    if (!task) continue
    const due = str(o.due ?? o.deadline ?? o.date, 10)
    const time = str(o.time, 5)
    const item: FoundItem = {
      task,
      owner: str(o.owner ?? o.assignee, 80),
      mine: o.mine === true || o.mine === 'true',
      due: due && /^\d{4}-\d{2}-\d{2}$/.test(due) && !Number.isNaN(Date.parse(due)) ? due : undefined,
      time: time && /^([01]\d|2[0-3]):[0-5]\d$/.test(time) ? time : undefined,
      details: str(o.details ?? o.context, 500)
    }
    const dueText = str(o.due_text ?? o.dueText, 80)
    if (dueText) item.dueText = dueText
    out.push(item)
  }
  return out
}

/** "Owner: task" bullets from the notes' Next steps / Action items section. */
export function noteActionBullets(markdown: string): { owner?: string; text: string }[] {
  const out: { owner?: string; text: string }[] = []
  let inSection = false
  for (const line of markdown.split('\n')) {
    const heading = /^#{1,6}\s+(.*)$/.exec(line.trim())
    if (heading) {
      inSection = /next steps|action items?|to-?dos?|follow[- ]?ups?|tasks|assignments/i.test(heading[1])
      continue
    }
    const bullet = /^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?(.+)$/.exec(line)
    if (!inSection || !bullet) continue
    const text = bullet[1].replace(/\*\*/g, '').trim()
    const m = /^([\p{L}][\p{L}\p{M} .'-]{0,40}?)\s*[:–—-]\s+(.+)$/u.exec(text)
    out.push(m && m[1].split(/\s+/).length <= 4 ? { owner: m[1].trim(), text: m[2].trim() } : { text })
  }
  return out
}

const words = (s: string) => new Set(s.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? [])
const overlap = (a: Set<string>, b: Set<string>) => {
  let n = 0
  for (const w of a) if (b.has(w)) n++
  return n / Math.max(1, Math.min(a.size, b.size))
}

/**
 * Cleans up what a (possibly small, local) model returned: owners from "Name: task" or the notes,
 * real deadlines from phrases like "by Friday" (counted from the meeting date), "mine" from the user's
 * name, and no duplicates. Falls back to the notes' Next steps when the model found nothing.
 */
export function refineActionItems(found: FoundItem[] | null, meeting: Meeting, userName: string): FoundItem[] {
  const bullets = noteActionBullets(meeting.enhancedMarkdown ?? '')
  const base = meetingDate(meeting)
  const minDue = new Date(base.getFullYear(), base.getMonth(), base.getDate() - 1).toISOString().slice(0, 10)
  const me = userName.trim().toLowerCase()
  const isMe = (owner?: string) => {
    const o = owner?.trim().toLowerCase().replace(/\s*\(me\)$/, '')
    return !!o && (['me', 'i', 'myself', 'you'].includes(o) || (!!me && (o === me || o === me.split(/\s+/)[0])))
  }
  const items: FoundItem[] = found?.length ? found : bullets.map((b) => ({ task: b.text, owner: b.owner, mine: false }))
  const out: FoundItem[] = []
  for (const raw of items) {
    const item: FoundItem = { ...raw }
    const prefixed = /^([\p{L}][\p{L}\p{M} .'-]{0,40}?):\s+(.+)$/u.exec(item.task)
    if (prefixed && prefixed[1].split(/\s+/).length <= 4) {
      item.owner ??= prefixed[1].trim()
      item.task = prefixed[2].trim()
    }
    const w = words(item.task)
    const match = bullets.map((b) => ({ b, score: overlap(w, words(b.text)) })).sort((x, y) => y.score - x.score)[0]
    const source = match && match.score >= 0.5 ? match.b : undefined
    item.owner ??= source?.owner
    const resolved = resolveDue(item.dueText, base) ?? resolveDue(`${item.task} ${item.details ?? ''}`, base) ?? resolveDue(source?.text, base)
    item.due = resolved ?? (item.due && item.due >= minDue ? item.due : undefined)
    // Small models like to invent times; keep one only if a time was actually mentioned.
    const said = `${item.dueText ?? ''} ${item.task} ${item.details ?? ''} ${source?.text ?? ''}`
    if (!item.due || !/\b\d{1,2}(:\d{2})?\s*(am|pm|a\.m\.|p\.m\.)|\b\d{1,2}:\d{2}\b|\b(noon|midday|midnight)\b/i.test(said)) item.time = undefined
    item.owner = item.owner?.replace(/\s*\(me\)$/i, '').trim() || undefined
    if (item.owner) item.mine = isMe(item.owner)
    item.task = item.task.charAt(0).toUpperCase() + item.task.slice(1)
    delete item.dueText
    const key = words(item.task)
    if (out.some((o) => (o.owner ?? '') === (item.owner ?? '') && overlap(words(o.task), key) >= 0.75)) continue
    out.push(item)
  }
  return out
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
