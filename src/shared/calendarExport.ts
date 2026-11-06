import type { ActionItem } from './types'

export interface ItemContext {
  item: ActionItem
  meetingTitle: string
  meetingDate: Date
}

const compact = (iso: string) => iso.replace(/-/g, '')

function nextDay(ymd: string): string {
  const d = new Date(`${ymd}T12:00:00`)
  d.setDate(d.getDate() + 1)
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
}

/** Local "YYYYMMDDTHHMMSS" for a due date + time, plus `minutes`. */
function stamp(ymd: string, time: string, minutes = 0): string {
  const d = new Date(`${ymd}T${time}:00`)
  d.setMinutes(d.getMinutes() + minutes)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}T${p(d.getHours())}${p(d.getMinutes())}00`
}

function description({ item, meetingTitle, meetingDate }: ItemContext): string {
  return [
    item.details,
    item.owner && !item.mine ? `Owner: ${item.owner}` : '',
    `From the meeting "${meetingTitle || 'Untitled meeting'}" on ${meetingDate.toLocaleDateString(undefined, { dateStyle: 'medium' })} (NitroScribe).`
  ]
    .filter(Boolean)
    .join('\n')
}

/**
 * A Google Calendar "new event" link, pre-filled. Opening it in the browser lets the user review and save
 * the event in their own calendar; NitroScribe itself never talks to Google.
 */
export function googleCalendarUrl(ctx: ItemContext, timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone): string {
  const { item } = ctx
  const params = new URLSearchParams({ action: 'TEMPLATE', text: item.task, details: description(ctx) })
  if (item.due) params.set('dates', item.time ? `${stamp(item.due, item.time)}/${stamp(item.due, item.time, 30)}` : `${compact(item.due)}/${nextDay(item.due)}`)
  if (item.time && timeZone) params.set('ctz', timeZone)
  return `https://calendar.google.com/calendar/render?${params.toString()}`
}

const escapeText = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n')

/** Folds long lines at 75 octets, as calendar files require. */
function fold(line: string): string {
  const bytes = new TextEncoder().encode(line)
  if (bytes.length <= 75) return line
  const out: string[] = []
  let current = ''
  let size = 0
  for (const ch of line) {
    const n = new TextEncoder().encode(ch).length
    if (size + n > (out.length ? 74 : 75)) {
      out.push(current)
      current = ''
      size = 0
    }
    current += ch
    size += n
  }
  out.push(current)
  return out.join('\r\n ')
}

/** An .ics calendar file with one event per action item that has a deadline (Google, Outlook and Apple Calendar can import it). */
export function actionItemsToIcs(entries: ItemContext[], now = new Date()): string {
  const dtstamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
  const events = entries
    .filter((e) => e.item.due)
    .flatMap((e) => {
      const { item } = e
      const when = item.time
        ? [`DTSTART:${stamp(item.due!, item.time)}`, `DTEND:${stamp(item.due!, item.time, 30)}`]
        : [`DTSTART;VALUE=DATE:${compact(item.due!)}`, `DTEND;VALUE=DATE:${nextDay(item.due!)}`]
      return ['BEGIN:VEVENT', `UID:${item.id}@nitroscribe`, `DTSTAMP:${dtstamp}`, ...when, `SUMMARY:${escapeText(item.task)}`, `DESCRIPTION:${escapeText(description(e))}`, 'END:VEVENT']
    })
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//NitroScribe//Action items//EN', 'CALSCALE:GREGORIAN', ...events, 'END:VCALENDAR'].map(fold).join('\r\n') + '\r\n'
}
