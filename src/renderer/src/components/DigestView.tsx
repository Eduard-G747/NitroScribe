import { ChevronLeft, ChevronRight, Copy, RefreshCw, Sparkles } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { inWeek, shiftWeek, weekLabel, weekOf } from '@shared/insights'
import type { Digest } from '@shared/types'
import { markdownToHtml } from '../lib/markdown'
import { aiReady, useApp } from '../lib/store'
import { useAiStream } from '../lib/useAiStream'
import { ItemRow, ymd } from './ActionsView'
import { NotesList } from './NotesList'
import { Page, Section } from './PeopleView'
import { Button, IconButton, Spinner } from './ui'

/** Week in review: the AI's summary, what's overdue, what's still open, and the week's meetings. */
export function DigestView({ week }: { week: string }) {
  const meetings = useApp((s) => s.meetings)
  const ready = useApp((s) => aiReady(s.view))
  const seenWeek = useApp((s) => s.view?.settings.digest.seenWeek)
  const { go, toast, updateSettings, openSettings } = useApp.getState()
  const { text, status, error, start } = useAiStream()
  const [saved, setSaved] = useState<Digest | null | undefined>(undefined)
  const autoStarted = useRef(false)
  const finished = week < weekOf(new Date())
  const today = ymd(new Date())

  const list = useMemo(() => meetings.filter((m) => inWeek(m, week)), [meetings, week])
  const open = useMemo(() => meetings.flatMap((meeting) => meeting.actionItems.filter((i) => !i.done).map((item) => ({ item, meeting }))), [meetings])
  const overdue = open.filter((e) => e.item.due && e.item.due < today)
  const fromWeek = open.filter((e) => inWeek(e.meeting, week) && !(e.item.due && e.item.due < today))
  const minutes = Math.round(list.reduce((n, m) => n + m.durationMs, 0) / 60_000)

  useEffect(() => {
    void window.api.ai.savedDigest(week).then(setSaved)
  }, [week])
  // A finished week gets its review written on the first visit.
  useEffect(() => {
    if (saved !== null || autoStarted.current || !finished || !list.length || !ready) return
    autoStarted.current = true
    void start(() => window.api.ai.digest(week))
  }, [saved, finished, list.length, ready, start, week])
  useEffect(() => {
    if (finished && seenWeek !== undefined && seenWeek < week) void updateSettings({ digest: { seenWeek: week } })
  }, [finished, seenWeek, week, updateSettings])

  const markdown = status === 'idle' ? (saved?.markdown ?? '') : text
  const write = () => void start(() => window.api.ai.digest(week))

  return (
    <Page>
      <div className="flex items-center gap-1">
        <h1 className="serif flex-1 text-[30px] font-normal">Week in review</h1>
        <IconButton label="Previous week" onClick={() => void go({ name: 'digest', week: shiftWeek(week, -1) })}>
          <ChevronLeft className="size-4" />
        </IconButton>
        <IconButton label="Next week" disabled={!finished} onClick={() => void go({ name: 'digest', week: shiftWeek(week, 1) })}>
          <ChevronRight className="size-4" />
        </IconButton>
      </div>
      <div className="text-[12.5px] text-muted">
        {weekLabel(week)}
        {!finished && ' (so far)'} · {list.length} meeting{list.length === 1 ? '' : 's'}
        {minutes > 0 && ` · ${minutes >= 90 ? `${Math.round(minutes / 6) / 10} h` : `${minutes} min`}`} · {fromWeek.length} still open
        {overdue.length > 0 && <span className="text-danger"> · {overdue.length} overdue</span>}
      </div>

      <div className="mt-5 rounded-2xl border border-edge bg-card px-5 py-4">
        {markdown ? (
          <>
            <div className="md select-text text-[13.5px]" dangerouslySetInnerHTML={{ __html: markdownToHtml(markdown) }} />
            {status !== 'writing' && (
              <div className="mt-3 flex gap-1.5 border-t border-edge pt-3">
                <Button size="sm" variant="ghost" onClick={write} disabled={!ready}>
                  <RefreshCw className="size-3.5" /> Rewrite
                </Button>
                <Button size="sm" variant="ghost" onClick={() => void window.api.files.copy(markdown).then(() => toast('success', 'Review copied'))}>
                  <Copy className="size-3.5" /> Copy
                </Button>
              </div>
            )}
          </>
        ) : status === 'writing' ? (
          <div className="flex items-center gap-2 text-[13px] text-muted">
            <Spinner className="size-3.5" /> Reading {list.length} meeting{list.length === 1 ? '' : 's'}…
          </div>
        ) : status === 'error' ? (
          <div className="flex items-center gap-3 text-[13px]">
            <span className="flex-1 text-danger">{error}</span>
            <Button size="sm" onClick={write}>
              Try again
            </Button>
          </div>
        ) : !list.length ? (
          <div className="text-[13px] text-muted">No meetings this week.</div>
        ) : !ready ? (
          <div className="flex items-center gap-3 text-[13px] text-muted">
            <span className="flex-1">Connect an AI model to get a written review of the week.</span>
            <Button size="sm" onClick={() => openSettings('ai')}>
              Connect
            </Button>
          </div>
        ) : saved === undefined ? (
          <Spinner className="size-3.5 text-muted" />
        ) : (
          <div className="flex items-center gap-3 text-[13px] text-muted">
            <Sparkles className="size-4 text-accent" />
            <span className="flex-1">Decisions, open loops and what's coming up, written from this week's meetings.</span>
            <Button size="sm" variant="solid" onClick={write}>
              Write review
            </Button>
          </div>
        )}
      </div>

      {overdue.length > 0 && (
        <Section title="Overdue" count={overdue.length}>
          {overdue.map((e) => (
            <ItemRow key={e.item.id} entry={e} today={today} />
          ))}
        </Section>
      )}
      {fromWeek.length > 0 && (
        <Section title="Still open from this week" count={fromWeek.length}>
          {fromWeek.map((e) => (
            <ItemRow key={e.item.id} entry={e} today={today} />
          ))}
        </Section>
      )}
      {list.length > 0 && (
        <Section title="Meetings" count={list.length}>
          <NotesList meetings={list} />
        </Section>
      )}
    </Page>
  )
}
