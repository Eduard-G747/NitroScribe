import { ChevronRight, Search, Users } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import { buildPeople, type Person } from '@shared/insights'
import { dayLabel } from '../lib/dates'
import { useApp } from '../lib/store'
import { ItemRow, ymd } from './ActionsView'
import { NotesList } from './NotesList'
import { TopBar } from './TopBar'
import { Avatar, speakerColor } from './ui'

export function Page({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full flex-col">
      <TopBar />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[640px] px-6 pb-24 pt-3">{children}</div>
      </div>
    </div>
  )
}

export function Section({ title, count, children }: { title: string; count?: number; children: ReactNode }) {
  return (
    <section className="mt-7">
      <div className="mb-1 px-2 text-[12px] font-medium text-muted">
        {title} {count !== undefined && <span className="text-faint">· {count}</span>}
      </div>
      {children}
    </section>
  )
}

function usePeople(): Person[] {
  const meetings = useApp((s) => s.meetings)
  const userName = useApp((s) => s.view?.settings.userName ?? '')
  return useMemo(() => buildPeople(meetings, userName), [meetings, userName])
}

export function PeopleView() {
  const people = usePeople()
  const { go } = useApp.getState()
  const [query, setQuery] = useState('')
  const shown = query.trim() ? people.filter((p) => p.name.toLowerCase().includes(query.trim().toLowerCase())) : people
  return (
    <Page>
      <h1 className="serif text-[30px] font-normal">People</h1>
      <div className="mb-5 text-[12.5px] text-muted">Everyone you've met with, what they promised, and what you owe them.</div>
      {people.length > 6 && (
        <label className="mb-3 flex h-9 items-center gap-2 rounded-lg border border-edge px-3">
          <Search className="size-3.5 text-faint" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a person" className="flex-1 bg-transparent text-[13px] outline-none placeholder:text-faint" />
        </label>
      )}
      {shown.map((p) => (
        <button key={p.key} onClick={() => void go({ name: 'person', key: p.key })} className="flex w-full items-center gap-3 rounded-xl px-2 py-2.5 text-left hover:bg-hover">
          <Avatar name={p.name} color={speakerColor(p.key)} size={32} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[14px] font-medium">{p.name}</span>
            <span className="block text-[12px] text-muted">
              {p.meetings.length} meeting{p.meetings.length === 1 ? '' : 's'} · last {dayLabel(p.lastMet.toISOString())}
            </span>
          </span>
          {p.promised.length > 0 && <span className="rounded-full bg-hover px-2 py-0.5 text-[11.5px] text-muted">{p.promised.length} promised</span>}
          {p.owed.length > 0 && <span className="rounded-full bg-accent/15 px-2 py-0.5 text-[11.5px] text-accent">you owe {p.owed.length}</span>}
          <ChevronRight className="size-4 text-faint" />
        </button>
      ))}
      {!people.length && (
        <div className="flex flex-col items-center px-6 py-16 text-center">
          <Users className="size-6 text-faint" />
          <div className="mt-3 max-w-[380px] text-[12.5px] leading-relaxed text-muted">
            People appear here once speakers in your meetings have names (the AI suggests them, or click a speaker in a transcript), or when your calendar lists attendees.
          </div>
        </div>
      )}
    </Page>
  )
}

export function PersonView({ personKey }: { personKey: string }) {
  const people = usePeople()
  const person = people.find((p) => p.key === personKey) ?? people.find((p) => p.key.split(' ')[0] === personKey.split(' ')[0])
  const { go } = useApp.getState()
  const today = ymd(new Date())
  if (!person) return <Page>This person no longer appears in any meeting.</Page>
  return (
    <Page>
      <button onClick={() => void go({ name: 'people' })} className="mb-3 text-[12.5px] text-muted hover:text-ink">
        ← People
      </button>
      <div className="flex items-center gap-3.5">
        <Avatar name={person.name} color={speakerColor(person.key)} size={46} />
        <div>
          <h1 className="serif text-[28px] font-normal leading-tight">{person.name}</h1>
          <div className="text-[12.5px] text-muted">
            {person.meetings.length} meeting{person.meetings.length === 1 ? '' : 's'} together · last met {dayLabel(person.lastMet.toISOString())}
          </div>
        </div>
      </div>
      <Section title="They promised" count={person.promised.length}>
        {person.promised.length ? person.promised.map((e) => <ItemRow key={e.item.id} entry={e} today={today} />) : <div className="px-2 text-[12.5px] text-faint">Nothing open.</div>}
      </Section>
      <Section title="You owe them" count={person.owed.length}>
        {person.owed.length ? person.owed.map((e) => <ItemRow key={e.item.id} entry={e} today={today} />) : <div className="px-2 text-[12.5px] text-faint">You're all caught up.</div>}
      </Section>
      <Section title="Meetings">
        <NotesList meetings={person.meetings} />
      </Section>
    </Page>
  )
}
