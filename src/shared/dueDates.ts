const WEEKDAYS: Record<string, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 }
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const day = (d: Date, n = 0) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)
/** Monday-based start of the week. */
const weekStart = (d: Date) => day(d, -((d.getDay() + 6) % 7))

/**
 * Turns a spoken deadline ("by Friday", "next Tuesday", "end of month", "in 2 weeks", "Nov 15") into a date,
 * counted from the meeting's date. English only; returns undefined when nothing date-like is found.
 */
export function resolveDue(text: string | undefined, meeting: Date): string | undefined {
  if (!text) return undefined
  const t = ` ${text.toLowerCase().replace(/[(),.;]/g, ' ').replace(/\s+/g, ' ')} `
  const base = day(meeting)

  const iso = /\b(20\d{2})-(\d{2})-(\d{2})\b/.exec(t)
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`

  const monthDay = new RegExp(String.raw`\b(?:(${MONTHS.join('|')})[a-z]*\s+(\d{1,2})(?:st|nd|rd|th)?|(\d{1,2})(?:st|nd|rd|th)?(?:\s+of)?\s+(${MONTHS.join('|')})[a-z]*)\b`).exec(t)
  if (monthDay) {
    const month = MONTHS.indexOf((monthDay[1] ?? monthDay[4]).slice(0, 3))
    const date = Number(monthDay[2] ?? monthDay[3])
    if (date >= 1 && date <= 31) {
      let d = new Date(base.getFullYear(), month, date)
      if (d < day(base, -7)) d = new Date(base.getFullYear() + 1, month, date)
      return ymd(d)
    }
  }

  if (/\b(today|tonight|end of (the )?day|eod|this afternoon|this evening)\b/.test(t)) return ymd(base)
  if (/\bday after tomorrow\b/.test(t)) return ymd(day(base, 2))
  if (/\btomorrow\b/.test(t)) return ymd(day(base, 1))

  const inN = /\bin (\d{1,2}|a|one|two|three|four) (day|week)s?\b/.exec(t)
  if (inN) {
    const n = { a: 1, one: 1, two: 2, three: 3, four: 4 }[inN[1] as 'a'] ?? Number(inN[1])
    return ymd(day(base, inN[2] === 'week' ? n * 7 : n))
  }

  // Abbreviations are fine for weekdays ("by Fri"), but "sat"/"sun" must be spelled out.
  const weekday = /\b(?:(next|this|coming)\s+)?(?:(mon|tues?|wed(?:nes)?|thu(?:rs)?|fri)(?:day)?|(satur|sun)day)\b/.exec(t)
  if (weekday) {
    const target = WEEKDAYS[(weekday[2] ?? weekday[3]).slice(0, 3)]
    let d = day(base, ((target - base.getDay() + 7) % 7) || 7)
    // "next Friday" said early in a week means the Friday of the following week.
    if (weekday[1] === 'next' && weekStart(d).getTime() === weekStart(base).getTime()) d = day(d, 7)
    return ymd(d)
  }

  if (/\b(end of (the )?week|this week|eow)\b/.test(t)) {
    const friday = day(weekStart(base), 4)
    return ymd(friday < base ? day(friday, 7) : friday)
  }
  if (/\b(next week)\b/.test(t)) return ymd(day(weekStart(base), 11))
  if (/\b(end of (the )?month|this month|eom)\b/.test(t)) return ymd(new Date(base.getFullYear(), base.getMonth() + 1, 0))
  if (/\bnext month\b/.test(t)) return ymd(new Date(base.getFullYear(), base.getMonth() + 2, 0))
  if (/\b(end of (the )?quarter|this quarter|eoq)\b/.test(t)) return ymd(new Date(base.getFullYear(), Math.floor(base.getMonth() / 3) * 3 + 3, 0))
  return undefined
}
