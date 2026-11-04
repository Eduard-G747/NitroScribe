const DAY = 86_400_000

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

export function formatTime(iso: string | Date): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

export function dayLabel(iso: string | Date, now = new Date()): string {
  const d = new Date(iso)
  const diff = Math.round((startOfDay(d) - startOfDay(now)) / DAY)
  if (diff === 0) return 'Today'
  if (diff === -1) return 'Yesterday'
  if (diff === 1) return 'Tomorrow'
  if (diff > 1 && diff < 7) return d.toLocaleDateString(undefined, { weekday: 'long' })
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' })
}

/** Sidebar-style buckets: Today, Yesterday, Previous 7 days, Previous 30 days, then months. */
export function bucketLabel(iso: string, now = new Date()): string {
  const d = new Date(iso)
  const diff = Math.round((startOfDay(now) - startOfDay(d)) / DAY)
  if (diff <= 0) return 'Today'
  if (diff === 1) return 'Yesterday'
  if (diff < 7) return 'Previous 7 days'
  if (diff < 30) return 'Previous 30 days'
  return d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
}

export function groupBy<T>(items: T[], key: (item: T) => string): [string, T[]][] {
  const groups = new Map<string, T[]>()
  for (const item of items) {
    const k = key(item)
    const list = groups.get(k)
    if (list) list.push(item)
    else groups.set(k, [item])
  }
  return [...groups.entries()]
}

export function relativeStart(iso: string, now = Date.now()): string {
  const mins = Math.round((Date.parse(iso) - now) / 60_000)
  if (mins <= 0 && mins > -90) return 'Now'
  if (mins < 60) return `In ${mins} min`
  if (mins < 24 * 60) return `In ${Math.floor(mins / 60)} h ${mins % 60 ? `${mins % 60} min` : ''}`.trim()
  return dayLabel(iso)
}

export function greeting(now = new Date()): string {
  const h = now.getHours()
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'
}

/** "YYYY-MM-DDTHH:mm" in local time, for <input type="datetime-local">. */
export function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
