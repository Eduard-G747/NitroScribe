import clsx from 'clsx'
import { ArrowUp, ChevronLeft, ChevronRight, Cpu, ListTodo, Mic, Sparkles, Video } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { CalendarEvent } from '@shared/types'
import { groupBy } from '../lib/dates'
import { useTicker } from '../lib/hooks'
import { aiReady, useApp } from '../lib/store'
import { NotesList } from './NotesList'
import { TopBar } from './TopBar'
import { Button, Time } from './ui'

const DAYS_PER_PAGE = 4

function dayKey(iso: string) {
  const d = new Date(iso)
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}

function EventRow({ e, now }: { e: CalendarEvent; now: number }) {
  const recording = useApp((s) => s.recording)
  const newMeeting = useApp((s) => s.newMeeting)
  const live = Date.parse(e.start) <= now && Date.parse(e.end) > now
  return (
    <div className="group flex items-start gap-2.5">
      <span className={clsx('mt-0.5 h-[34px] w-[3px] flex-none rounded-full', live ? 'bg-accent' : 'bg-cal')} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13.5px] font-medium">{e.title}</div>
        <div className="text-[11.5px] text-muted">
          <Time date={e.start} /> – <Time date={e.end} />
          {e.attendees.length > 0 && (
            <span className="text-faint">
              {' '}
              · {e.attendees.length} {e.attendees.length === 1 ? 'person' : 'people'}
            </span>
          )}
        </div>
      </div>
      <div className={clsx('flex flex-none items-center gap-1 transition-opacity', live ? 'opacity-100' : 'opacity-0 group-hover:opacity-100')}>
        {e.meetingUrl && (
          <Button size="sm" variant="ghost" onClick={() => void window.api.app.openExternal(e.meetingUrl!)}>
            <Video className="size-3.5" /> Join
          </Button>
        )}
        <Button size="sm" variant={live ? 'primary' : 'secondary'} disabled={recording.status !== 'idle'} onClick={() => void newMeeting({ record: true, event: e })}>
          <Mic className="size-3.5" /> Take notes
        </Button>
      </div>
    </div>
  )
}

function ComingUp() {
  const calendar = useApp((s) => s.calendar)
  const connected = useApp((s) => (s.view?.settings.calendars.length ?? 0) > 0)
  const openSettings = useApp((s) => s.openSettings)
  const now = useTicker(true, 30_000)
  const [page, setPage] = useState(0)
  const days = useMemo(() => groupBy(calendar.events.filter((e) => Date.parse(e.end) > now), (e) => dayKey(e.start)), [calendar.events, now])
  const pages = Math.max(1, Math.ceil(days.length / DAYS_PER_PAGE))
  const shown = days.slice(page * DAYS_PER_PAGE, page * DAYS_PER_PAGE + DAYS_PER_PAGE)
  const today = dayKey(new Date(now).toISOString())

  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <h1 className="serif text-[30px] font-normal">Coming up</h1>
        {connected && days.length > DAYS_PER_PAGE && (
          <div className="flex items-center gap-0.5 text-faint">
            <button disabled={page === 0} onClick={() => setPage(page - 1)} className="rounded p-1 hover:bg-hover hover:text-ink disabled:opacity-30">
              <ChevronLeft className="size-4" />
            </button>
            <button disabled={page >= pages - 1} onClick={() => setPage(page + 1)} className="rounded p-1 hover:bg-hover hover:text-ink disabled:opacity-30">
              <ChevronRight className="size-4" />
            </button>
          </div>
        )}
      </div>
      <div className="card overflow-hidden">
        {!connected ? (
          <div className="flex items-center gap-4 px-5 py-5">
            <div className="min-w-0 flex-1">
              <div className="text-[13.5px] font-medium">Connect your calendar</div>
              <div className="text-[12.5px] text-muted">See upcoming meetings here, with titles and attendees filled in for you.</div>
            </div>
            <Button size="sm" onClick={() => openSettings('calendar')}>
              Connect
            </Button>
          </div>
        ) : !shown.length ? (
          <div className="px-5 py-5 text-[13px] text-muted">Nothing on your calendar for the next two weeks.</div>
        ) : (
          shown.map(([key, events], i) => {
            const d = new Date(events[0].start)
            return (
              <div key={key} className={clsx('flex gap-4 px-5 py-3.5', i > 0 && 'border-t border-dashed border-edge')}>
                <div className="serif w-6 flex-none pt-0.5 text-right text-[24px] leading-none">{d.getDate()}</div>
                <div className="w-[88px] flex-none pt-0.5">
                  <div className="flex items-center gap-1 text-[11.5px] font-semibold">
                    {d.toLocaleDateString(undefined, { month: 'long' })}
                    {key === today && <span className="size-1.5 rounded-full bg-[#d4573c]" />}
                  </div>
                  <div className="text-[11px] text-muted">{d.toLocaleDateString(undefined, { weekday: 'short' })}</div>
                </div>
                <div className="min-w-0 flex-1 space-y-2.5">
                  {events.map((e) => (
                    <EventRow key={e.uid} e={e} now={now} />
                  ))}
                </div>
              </div>
            )
          })
        )}
      </div>
    </section>
  )
}

function SetupHints() {
  const view = useApp((s) => s.view)
  const whisper = useApp((s) => s.whisper)
  const openSettings = useApp((s) => s.openSettings)
  const needsModel = whisper && !whisper.installedModels.includes(view?.settings.transcription.model ?? 'large-v3-q5_0')
  const needsAi = !aiReady(view)
  if (!needsModel && !needsAi) return null
  return (
    <div className="space-y-2">
      {needsModel && (
        <button onClick={() => openSettings('transcription')} className="card flex w-full gap-3 p-3.5 text-left hover:bg-hover">
          <Cpu className="mt-0.5 size-4 flex-none text-accent" />
          <div>
            <div className="text-[13px] font-medium">{whisper?.installing ? 'Downloading the speech model…' : 'Set up local transcription'}</div>
            <div className="text-[12px] text-muted">Whisper runs on your own GPU: free and private.</div>
          </div>
        </button>
      )}
      {needsAi && (
        <button onClick={() => openSettings('ai')} className="card flex w-full gap-3 p-3.5 text-left hover:bg-hover">
          <Sparkles className="mt-0.5 size-4 flex-none text-accent" />
          <div>
            <div className="text-[13px] font-medium">Connect an AI model</div>
            <div className="text-[12px] text-muted">Any provider's API key, or a local model, for AI notes, speaker names and chat.</div>
          </div>
        </button>
      )}
    </div>
  )
}

export function AskBar({ placeholder, onAsk, chip }: { placeholder: string; onAsk: (q: string) => void; chip?: { label: string; question: string } }) {
  const [question, setQuestion] = useState('')
  const submit = (q = question) => {
    if (!q.trim()) return
    onAsk(q)
    setQuestion('')
  }
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-4 z-20 flex justify-center px-8">
      <div className="pointer-events-auto flex w-full max-w-[580px] items-center gap-2 rounded-2xl border border-edge bg-card py-1.5 pl-4 pr-1.5 shadow-[0_10px_30px_rgba(0,0,0,0.12)]">
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          placeholder={placeholder}
          className="h-9 min-w-0 flex-1 bg-transparent text-[13.5px] outline-none placeholder:text-muted"
        />
        {question.trim() ? (
          <button onClick={() => submit()} className="flex size-8 items-center justify-center rounded-xl bg-ink text-app hover:opacity-90" title="Ask">
            <ArrowUp className="size-4" />
          </button>
        ) : (
          chip && (
            <button onClick={() => submit(chip.question)} className="flex h-8 items-center gap-1.5 rounded-xl border border-edge px-3 text-[12.5px] font-medium hover:bg-hover">
              <ListTodo className="size-3.5 text-muted" /> {chip.label}
            </button>
          )
        )}
      </div>
    </div>
  )
}

export function HomeView() {
  const meetings = useApp((s) => s.meetings)
  const ask = useApp((s) => s.ask)
  return (
    <div className="flex h-full flex-col">
      <TopBar />
      <div className="relative min-h-0 flex-1">
        <div className="h-full overflow-y-auto">
          <div className="mx-auto max-w-[580px] space-y-8 px-6 pb-36 pt-3">
            <SetupHints />
            <ComingUp />
            {meetings.length ? (
              <NotesList meetings={meetings.slice(0, 60)} />
            ) : (
              <div className="px-2 text-[13px] leading-relaxed text-muted">
                No notes yet. Click <span className="font-medium text-ink">New note</span> when a call starts: NitroScribe transcribes everyone on the call and you can jot
                notes alongside. Have a transcript from an earlier meeting?{' '}
                <button className="font-medium text-ink underline decoration-faint underline-offset-2" onClick={() => useApp.getState().openImport()}>
                  Import it
                </button>{' '}
                and get a summary.
              </div>
            )}
          </div>
        </div>
        <AskBar placeholder="Ask anything" onAsk={(q) => ask(q, 'global')} chip={{ label: 'List recent todos', question: 'List my open todos and action items from recent meetings, grouped by meeting.' }} />
      </div>
    </div>
  )
}
