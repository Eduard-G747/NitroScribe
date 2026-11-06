import { EventEmitter } from 'node:events'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { Meeting, MeetingPatch, MeetingSpeaker, MeetingSummary, SearchResult, SpeakerNameSource, TranscriptSegment } from '@shared/types'
import { readJson, writeFileAtomic, writeFileAtomicSync } from '../util/fsx'

interface IndexEntry {
  summary: MeetingSummary
  /** Lower-cased searchable text (title, notes, AI notes, transcript). */
  text: string
}

export function tokenize(text: string): string[] {
  return text.toLowerCase().match(/[\p{L}\p{N}]+/gu)?.filter((t) => t.length > 1) ?? []
}

function plainMarkdown(md: string): string {
  return md
    .replace(/^\s*#{1,6}\s+/gm, '')
    .replace(/^\s*[-*+]\s+\[[ xX]\]\s+/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/[*_`]+/g, '')
}

function plainTranscript(m: Meeting): string {
  return m.transcript.map((s) => s.text).join(' ')
}

function speakerNames(m: Meeting): string[] {
  return [...new Set(Object.values(m.speakers ?? {}).map((s) => s.name?.trim()).filter((n): n is string => !!n))]
}

/** Calendar attendees plus named speakers, without repeating "Sarah" when "Sarah Chen" is invited. */
function participants(m: Meeting): string[] {
  const out = [...m.attendees]
  const known = (name: string) => out.some((a) => a.toLowerCase() === name.toLowerCase() || a.toLowerCase().split(/\s+/)[0] === name.toLowerCase().split(/\s+/)[0])
  for (const name of speakerNames(m)) if (!known(name)) out.push(name)
  return out.slice(0, 8)
}

function searchText(m: Meeting): string {
  return [m.title, m.attendees.join(' '), speakerNames(m).join(' '), m.notesMarkdown, m.enhancedMarkdown ?? '', plainTranscript(m)].join('\n').toLowerCase()
}

function summarize(m: Meeting): MeetingSummary {
  const preview = (m.enhancedMarkdown || m.notesMarkdown || plainTranscript(m))
    .replace(/[#*_>`[\]-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160)
  return {
    id: m.id,
    title: m.title,
    createdAt: m.createdAt,
    updatedAt: m.updatedAt,
    startedAt: m.startedAt,
    durationMs: m.durationMs,
    hasEnhanced: !!m.enhancedMarkdown,
    segmentCount: m.transcript.length,
    attendees: m.attendees,
    participants: participants(m),
    preview,
    actionItems: m.actionItems ?? [],
    actionItemsChecked: !!m.actionItemsAt
  }
}

function countOccurrences(haystack: string, needle: string, cap = 50): number {
  let n = 0
  for (let i = haystack.indexOf(needle); i !== -1 && n < cap; i = haystack.indexOf(needle, i + needle.length)) n++
  return n
}

export function makeSnippet(text: string, terms: string[], radius = 90): string {
  const lower = text.toLowerCase()
  let at = -1
  for (const t of terms) {
    at = lower.indexOf(t)
    if (at !== -1) break
  }
  if (at === -1) return text.slice(0, radius * 2).replace(/\s+/g, ' ').trim()
  const start = Math.max(0, at - radius)
  const end = Math.min(text.length, at + radius)
  return `${start > 0 ? '…' : ''}${text.slice(start, end).replace(/\s+/g, ' ').trim()}${end < text.length ? '…' : ''}`
}

export class MeetingStore extends EventEmitter {
  private index = new Map<string, IndexEntry>()
  private cache = new Map<string, Meeting>()
  private dirty = new Set<string>()
  private timers = new Map<string, NodeJS.Timeout>()

  constructor(
    readonly dir: string,
    private trash: (path: string) => Promise<void> = (p) => fs.rm(p, { force: true })
  ) {
    super()
  }

  private file(id: string) {
    if (!/^[\w-]{1,64}$/.test(id)) throw new Error('Invalid meeting id')
    return join(this.dir, `${id}.json`)
  }

  async init(): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true })
    const files = (await fs.readdir(this.dir)).filter((f) => f.endsWith('.json'))
    await Promise.all(
      files.map(async (f) => {
        const raw = await readJson<Meeting>(join(this.dir, f))
        if (!raw?.id) return
        const m = normalize(raw)
        this.index.set(m.id, { summary: summarize(m), text: searchText(m) })
      })
    )
  }

  list(): MeetingSummary[] {
    return [...this.index.values()]
      .map((e) => e.summary)
      .sort((a, b) => (b.startedAt ?? b.createdAt).localeCompare(a.startedAt ?? a.createdAt))
  }

  has(id: string): boolean {
    return this.index.has(id)
  }

  async get(id: string): Promise<Meeting | null> {
    const cached = this.cache.get(id)
    if (cached) return cached
    if (!this.index.has(id)) return null
    const m = await readJson<Meeting>(this.file(id))
    if (!m) return null
    const meeting = normalize(m)
    this.remember(meeting)
    return meeting
  }

  private remember(m: Meeting) {
    this.cache.delete(m.id)
    this.cache.set(m.id, m)
    // Keep a small LRU of full meetings in memory; dirty ones stay until saved.
    for (const key of this.cache.keys()) {
      if (this.cache.size <= 40) break
      if (!this.dirty.has(key)) this.cache.delete(key)
    }
  }

  async create(init: Partial<Meeting> = {}): Promise<Meeting> {
    const now = new Date().toISOString()
    const meeting: Meeting = normalize({
      id: randomUUID(),
      title: '',
      createdAt: now,
      updatedAt: now,
      durationMs: 0,
      notesHtml: '',
      notesMarkdown: '',
      transcript: [],
      chat: [],
      attendees: [],
      ...init
    } as Meeting)
    this.remember(meeting)
    this.touch(meeting, true)
    return meeting
  }

  async update(id: string, patch: MeetingPatch): Promise<Meeting> {
    const m = await this.mustGet(id)
    Object.assign(m, patch)
    this.touch(m)
    return m
  }

  async markStarted(id: string, startedAt: string): Promise<Meeting> {
    const m = await this.mustGet(id)
    if (!m.startedAt) {
      m.startedAt = startedAt
      this.touch(m)
    }
    return m
  }

  async addDuration(id: string, ms: number): Promise<void> {
    const m = await this.mustGet(id)
    m.durationMs += Math.max(0, Math.round(ms))
    this.touch(m)
  }

  async applySegments(id: string, added: TranscriptSegment[], removed: string[]): Promise<void> {
    const m = await this.mustGet(id)
    if (removed.length) m.transcript = m.transcript.filter((s) => !removed.includes(s.id))
    if (added.length) m.transcript = [...m.transcript, ...added].sort((a, b) => a.start - b.start)
    this.touch(m)
  }

  /** Merges speaker info from the live clustering without overriding better names (manual > voice > AI). */
  async mergeSpeakers(id: string, incoming: Record<string, MeetingSpeaker>): Promise<Record<string, MeetingSpeaker>> {
    const m = await this.mustGet(id)
    m.speakers = mergeSpeakerMaps(m.speakers ?? {}, incoming)
    this.touch(m)
    return m.speakers
  }

  /** Moves segments to new speakers after re-clustering and drops speakers nobody refers to any more. */
  async relabel(id: string, relabeled: Record<string, string>, incoming: Record<string, MeetingSpeaker>): Promise<Record<string, MeetingSpeaker>> {
    const m = await this.mustGet(id)
    m.transcript = m.transcript.map((s) => (relabeled[s.id] ? { ...s, speakerId: relabeled[s.id] } : s))
    const merged = mergeSpeakerMaps(m.speakers ?? {}, incoming)
    const used = new Set(m.transcript.map((s) => s.speakerId))
    m.speakers = Object.fromEntries(Object.entries(merged).filter(([sid, s]) => used.has(sid) || s.nameSource === 'manual'))
    this.touch(m)
    return m.speakers
  }

  async delete(id: string): Promise<void> {
    clearTimeout(this.timers.get(id))
    this.timers.delete(id)
    this.dirty.delete(id)
    this.cache.delete(id)
    this.index.delete(id)
    await this.trash(this.file(id)).catch(() => fs.rm(this.file(id), { force: true }))
    this.emit('deleted', id)
  }

  /** Full-text search with simple TF scoring and title boost. Multi-word queries require all terms. */
  async search(query: string, limit = 40): Promise<SearchResult[]> {
    const terms = [...new Set(tokenize(query))]
    if (!terms.length) return []
    const scored = this.rank(terms).slice(0, limit)
    const results: SearchResult[] = []
    for (const { entry, score } of scored) {
      const m = await this.get(entry.summary.id)
      if (!m) continue
      const body = [plainMarkdown(m.enhancedMarkdown ?? ''), plainMarkdown(m.notesMarkdown), plainTranscript(m)].join('\n')
      results.push({ id: m.id, title: m.title, createdAt: m.startedAt ?? m.createdAt, snippet: makeSnippet(body, terms), score })
    }
    return results
  }

  /** Ranks meetings for the given terms. With `requireAll`, meetings containing every term win (falling back to any). */
  rank(terms: string[], requireAll = true): { entry: IndexEntry; score: number }[] {
    const n = this.index.size || 1
    const df = new Map(terms.map((t) => [t, 0]))
    const rows: { entry: IndexEntry; tf: number[] }[] = []
    for (const entry of this.index.values()) {
      const tf = terms.map((t) => countOccurrences(entry.text, t))
      tf.forEach((c, i) => c && df.set(terms[i], (df.get(terms[i]) ?? 0) + 1))
      rows.push({ entry, tf })
    }
    const scoreRows = (requireAll: boolean) =>
      rows
        .filter((r) => (requireAll ? r.tf.every((c) => c > 0) : r.tf.some((c) => c > 0)))
        .map(({ entry, tf }) => {
          const title = entry.summary.title.toLowerCase()
          let score = 0
          terms.forEach((t, i) => {
            const idf = Math.log(1 + n / (1 + (df.get(t) ?? 0)))
            score += idf * (Math.log(1 + tf[i]) + (title.includes(t) ? 3 : 0))
          })
          return { entry, score }
        })
        .sort((a, b) => b.score - a.score)
    const strict = requireAll ? scoreRows(true) : []
    return strict.length ? strict : scoreRows(false)
  }

  private async mustGet(id: string): Promise<Meeting> {
    const m = await this.get(id)
    if (!m) throw new Error(`Meeting ${id} not found`)
    return m
  }

  private touch(m: Meeting, immediate = false) {
    m.updatedAt = new Date().toISOString()
    const entry = { summary: summarize(m), text: searchText(m) }
    this.index.set(m.id, entry)
    this.dirty.add(m.id)
    this.emit('changed', entry.summary)
    clearTimeout(this.timers.get(m.id))
    this.timers.set(
      m.id,
      setTimeout(() => void this.save(m.id), immediate ? 0 : 600)
    )
  }

  private async save(id: string) {
    this.timers.delete(id)
    const m = this.cache.get(id)
    if (!m || !this.dirty.has(id)) return
    this.dirty.delete(id)
    try {
      await writeFileAtomic(this.file(id), JSON.stringify(m, null, 1))
    } catch (err) {
      this.dirty.add(id)
      this.emit('saveError', err)
    }
  }

  async flush(): Promise<void> {
    await Promise.all([...this.dirty].map((id) => this.save(id)))
  }

  flushSync(): void {
    for (const id of this.dirty) {
      const m = this.cache.get(id)
      if (m) writeFileAtomicSync(this.file(id), JSON.stringify(m, null, 1))
    }
    this.dirty.clear()
  }
}

const NAME_RANK: Record<SpeakerNameSource, number> = { manual: 3, voice: 2, ai: 1 }

export function mergeSpeakerMaps(existing: Record<string, MeetingSpeaker>, incoming: Record<string, MeetingSpeaker>): Record<string, MeetingSpeaker> {
  const out = { ...existing }
  for (const s of Object.values(incoming)) {
    const e = existing[s.id]
    const takeName = (s.nameSource ? NAME_RANK[s.nameSource] : 0) > (e?.nameSource ? NAME_RANK[e.nameSource] : 0)
    out[s.id] = {
      ...e,
      ...s,
      name: takeName ? s.name : e?.name,
      nameSource: takeName ? s.nameSource : e?.nameSource,
      voiceId: s.voiceId ?? e?.voiceId
    }
  }
  return out
}

function normalize(m: Meeting): Meeting {
  m.title ??= ''
  m.notesHtml ??= ''
  m.notesMarkdown ??= ''
  m.transcript ??= []
  m.chat ??= []
  m.attendees ??= []
  m.durationMs ??= 0
  return m
}
