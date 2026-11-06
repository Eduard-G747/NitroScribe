import clsx from 'clsx'
import { FileText, Play, Search } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { formatClock } from '@shared/format'
import type { SearchResult } from '@shared/types'
import { dayLabel } from '../lib/dates'
import { useApp } from '../lib/store'
import { Modal } from './ui'

function highlight(text: string, query: string) {
  const terms = query.toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) ?? []
  if (!terms.length) return text
  const re = new RegExp(`(${terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi')
  return text.split(re).map((part, i) => (i % 2 ? <mark key={i} className="rounded bg-[#f5d77a]/60 px-0.5 text-ink">{part}</mark> : part))
}

/** Ctrl+K: full-text search across every meeting. */
export function SearchPalette() {
  const open = useApp((s) => s.searchOpen)
  const meetings = useApp((s) => s.meetings)
  const { setSearchOpen, openMeeting } = useApp.getState()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [index, setIndex] = useState(0)

  useEffect(() => {
    if (!open) setQuery('')
  }, [open])
  useEffect(() => {
    if (!query.trim()) return setResults([])
    const t = setTimeout(() => void window.api.meetings.search(query).then(setResults), 150)
    return () => clearTimeout(t)
  }, [query])
  useEffect(() => setIndex(0), [results, query])

  const items = useMemo(
    () =>
      query.trim()
        ? results.map((r) => ({ id: r.id, title: r.title, sub: r.moments.length ? '' : r.snippet, date: r.createdAt, moments: r.moments }))
        : meetings.slice(0, 8).map((m) => ({ id: m.id, title: m.title, sub: m.preview, date: m.startedAt ?? m.createdAt, moments: [] as SearchResult['moments'] })),
    [query, results, meetings]
  )
  const { openMeetingAt } = useApp.getState()
  const choose = (id: string) => {
    setSearchOpen(false)
    void openMeeting(id)
  }

  return (
    <Modal open={open} top onClose={() => setSearchOpen(false)} className="w-[min(620px,92vw)]">
      <div className="flex items-center gap-2.5 border-b border-edge px-4">
        <Search className="size-4 text-faint" />
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') setIndex((i) => Math.min(items.length - 1, i + 1))
            else if (e.key === 'ArrowUp') setIndex((i) => Math.max(0, i - 1))
            else if (e.key === 'Enter' && items[index]) choose(items[index].id)
          }}
          placeholder="Search meetings, or what someone said…"
          className="h-12 flex-1 bg-transparent text-[14.5px] outline-none placeholder:text-faint"
        />
      </div>
      <div className="max-h-[56vh] overflow-y-auto p-1.5">
        {!query.trim() && items.length > 0 && <div className="px-3 pb-1 pt-2 text-[11.5px] font-medium text-faint">Recent</div>}
        {query.trim() && !items.length && <div className="px-3 py-8 text-center text-[13px] text-muted">No meetings match “{query}”.</div>}
        {items.map((it, i) => (
          <div key={it.id}>
            <button
              onMouseEnter={() => setIndex(i)}
              onClick={() => choose(it.id)}
              className={clsx('flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left', i === index && 'bg-hover')}
            >
              <span className="mt-0.5 flex size-7 flex-none items-center justify-center rounded-md bg-tile">
                <FileText className="size-3.5 text-muted" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline gap-2">
                  <span className="truncate text-[13.5px] font-medium">{highlight(it.title || 'Untitled meeting', query)}</span>
                  <span className="flex-none text-[11.5px] text-faint">{dayLabel(it.date)}</span>
                </span>
                {it.sub && <span className="mt-0.5 line-clamp-2 block text-[12.5px] leading-snug text-muted">{highlight(it.sub, query)}</span>}
              </span>
            </button>
            {it.moments.map((m) => (
              <button
                key={m.segmentId}
                onClick={() => void openMeetingAt(it.id, m.segmentId)}
                title="Jump to this moment in the transcript"
                className="ml-[52px] flex w-[calc(100%-52px)] items-baseline gap-2 rounded-md px-2 py-1 text-left text-[12.5px] hover:bg-hover"
              >
                <span className="flex flex-none items-center gap-1 font-mono text-[11px] text-accent">
                  <Play className="size-2.5 fill-current" />
                  {formatClock(m.start)}
                </span>
                <span className="min-w-0 truncate text-muted">
                  <span className="font-medium text-ink">{m.speaker}:</span> {highlight(m.text, query)}
                </span>
              </button>
            ))}
          </div>
        ))}
      </div>
    </Modal>
  )
}
