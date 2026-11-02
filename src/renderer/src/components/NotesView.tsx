import { Lock, Search, Upload } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useApp } from '../lib/store'
import { NotesList } from './NotesList'
import { TopBar } from './TopBar'
import { Button } from './ui'

/** "My notes": every meeting, with a quick filter. */
export function NotesView() {
  const meetings = useApp((s) => s.meetings)
  const [query, setQuery] = useState('')
  const [ids, setIds] = useState<Set<string> | null>(null)

  useEffect(() => {
    if (!query.trim()) return setIds(null)
    const t = setTimeout(() => void window.api.meetings.search(query).then((r) => setIds(new Set(r.map((x) => x.id)))), 150)
    return () => clearTimeout(t)
  }, [query])

  const shown = ids ? meetings.filter((m) => ids.has(m.id)) : meetings
  return (
    <div className="flex h-full flex-col">
      <TopBar />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[580px] px-6 pb-24 pt-3">
          <div className="mb-1 flex items-center gap-2 text-[12px] text-muted">
            <Lock className="size-3.5" /> Private to this computer
          </div>
          <div className="mb-5 flex items-end justify-between gap-3">
            <h1 className="serif text-[30px] font-normal">My notes</h1>
            <Button size="sm" onClick={() => useApp.getState().openImport()}>
              <Upload className="size-3.5" /> Import transcript
            </Button>
          </div>
          <div className="relative mb-6">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-faint" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={`Search ${meetings.length} note${meetings.length === 1 ? '' : 's'}`}
              className="h-9 w-full rounded-lg border border-edge bg-card pl-9 pr-3 text-[13.5px] outline-none placeholder:text-faint focus:border-accent/50"
            />
          </div>
          {shown.length ? <NotesList meetings={shown} /> : <div className="px-2 text-[13px] text-muted">{query ? 'No matching notes.' : 'No notes yet.'}</div>}
        </div>
      </div>
    </div>
  )
}
