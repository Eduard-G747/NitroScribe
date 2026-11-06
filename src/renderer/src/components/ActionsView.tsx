import clsx from 'clsx'
import { CalendarPlus, Check, Clock, Download, ListChecks, MoreHorizontal, Sparkles, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { actionItemsToIcs, googleCalendarUrl, type ItemContext } from '@shared/calendarExport'
import { meetingDate } from '@shared/format'
import type { ActionItem, MeetingSummary } from '@shared/types'
import { aiReady, useApp } from '../lib/store'
import { TopBar } from './TopBar'
import { Avatar, Button, Dropdown, IconButton, MenuItem, Segmented } from './ui'

interface Entry {
  item: ActionItem
  meeting: MeetingSummary
}

export const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const localDate = (due: string) => new Date(`${due}T12:00:00`)
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)
const context = ({ item, meeting }: Entry): ItemContext => ({ item, meetingTitle: meeting.title, meetingDate: meetingDate(meeting) })

function dueLabel(item: ActionItem, today: string): { text: string; overdue: boolean } {
  if (!item.due) return { text: 'No deadline', overdue: false }
  const tomorrow = ymd(addDays(localDate(today), 1))
  const day = item.due === today ? 'Today' : item.due === tomorrow ? 'Tomorrow' : localDate(item.due).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
  const time = item.time ? ` · ${new Date(`${item.due}T${item.time}`).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}` : ''
  return { text: day + time, overdue: !item.done && item.due < today }
}

function DueEditor({ item, onSave, close }: { item: ActionItem; onSave: (p: Partial<ActionItem>) => void; close: () => void }) {
  const [due, setDue] = useState(item.due ?? '')
  const [time, setTime] = useState(item.time ?? '')
  const input = 'h-8 w-full rounded-lg border border-edge bg-app px-2.5 text-[13px] outline-none focus:border-accent/60'
  return (
    <div className="w-60 space-y-2 p-2.5">
      <div className="text-[11.5px] font-medium text-faint">Deadline</div>
      <input type="date" value={due} onChange={(e) => setDue(e.target.value)} className={input} />
      <input type="time" value={time} onChange={(e) => setTime(e.target.value)} disabled={!due} className={input} />
      <div className="flex justify-between pt-1">
        <Button size="sm" variant="ghost" onClick={() => (onSave({ due: undefined, time: undefined }), close())}>
          No deadline
        </Button>
        <Button size="sm" variant="solid" disabled={!due} onClick={() => (onSave({ due, time: time || undefined }), close())}>
          Save
        </Button>
      </div>
    </div>
  )
}

export function ItemRow({ entry, today }: { entry: Entry; today: string }) {
  const { item, meeting } = entry
  const { updateActionItem, openMeeting, toast } = useApp.getState()
  const [editing, setEditing] = useState(false)
  const [task, setTask] = useState(item.task)
  const save = (patch: Partial<ActionItem>) => updateActionItem(meeting.id, item.id, patch)
  const due = dueLabel(item, today)
  const downloadIcs = async () => {
    const path = await window.api.files.save({
      defaultName: `${item.task.slice(0, 60).replace(/[\\/:*?"<>|]+/g, ' ').trim()}.ics`,
      content: actionItemsToIcs([context(entry)]),
      filters: [{ name: 'Calendar', extensions: ['ics'] }]
    })
    if (path) toast('success', 'Saved. Open the file to add it to your calendar.')
  }
  return (
    <div className="group flex gap-3 rounded-xl px-2 py-2.5 hover:bg-hover">
      <button
        onClick={() => save({ done: !item.done })}
        title={item.done ? 'Mark as not done' : 'Mark as done'}
        className={clsx('mt-0.5 flex size-[18px] flex-none items-center justify-center rounded-md border', item.done ? 'border-accent bg-accent text-white' : 'border-faint hover:border-accent')}
      >
        {item.done && <Check className="size-3" strokeWidth={3} />}
      </button>
      <div className="min-w-0 flex-1">
        {editing ? (
          <input
            autoFocus
            value={task}
            onChange={(e) => setTask(e.target.value)}
            onBlur={() => {
              setEditing(false)
              if (task.trim() && task.trim() !== item.task) save({ task: task.trim() })
              else setTask(item.task)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur()
              if (e.key === 'Escape') {
                setTask(item.task)
                setEditing(false)
              }
            }}
            className="w-full rounded-md border border-edge bg-card px-2 py-0.5 text-[14px] outline-none"
          />
        ) : (
          <div onDoubleClick={() => setEditing(true)} className={clsx('text-[14px] leading-snug', item.done && 'text-faint line-through')} title="Double-click to edit">
            {item.task}
          </div>
        )}
        {item.details && <div className="mt-0.5 line-clamp-2 text-[12.5px] leading-relaxed text-muted">{item.details}</div>}
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-muted">
          <Dropdown
            className="!p-0"
            trigger={({ toggle }) => (
              <button onClick={toggle} className={clsx('inline-flex items-center gap-1 rounded hover:text-ink', due.overdue && 'font-medium text-danger')} title="Change the deadline">
                <Clock className="size-3" />
                {due.overdue ? `Overdue · ${due.text}` : due.text}
              </button>
            )}
          >
            {(close) => <DueEditor item={item} onSave={save} close={close} />}
          </Dropdown>
          {item.owner && !item.mine && (
            <button onClick={() => void useApp.getState().go({ name: 'person', key: item.owner!.toLowerCase() })} className="inline-flex items-center gap-1 hover:text-ink" title="See everything with this person">
              <Avatar name={item.owner} size={14} /> {item.owner}
            </button>
          )}
          <button onClick={() => void openMeeting(meeting.id)} className="truncate hover:text-ink hover:underline" title="Open the meeting">
            {meeting.title || 'Untitled meeting'} · {meetingDate(meeting).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
          </button>
        </div>
      </div>
      <div className="flex flex-none items-start gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
        <IconButton label="Add to Google Calendar" onClick={() => void window.api.app.openExternal(googleCalendarUrl(context(entry)))}>
          <CalendarPlus className="size-4" />
        </IconButton>
        <Dropdown
          align="right"
          trigger={({ toggle }) => (
            <IconButton label="More" onClick={toggle}>
              <MoreHorizontal className="size-4" />
            </IconButton>
          )}
        >
          {(close) => (
            <>
              <MenuItem icon={<Download className="size-3.5" />} onClick={() => (close(), void downloadIcs())} hint="Outlook, Apple Calendar…">
                Download calendar file
              </MenuItem>
              <MenuItem icon={<Trash2 className="size-3.5" />} danger onClick={() => (close(), updateActionItem(meeting.id, item.id, null))}>
                Delete
              </MenuItem>
            </>
          )}
        </Dropdown>
      </div>
    </div>
  )
}

export function ActionsView() {
  const meetings = useApp((s) => s.meetings)
  const scanning = useApp((s) => s.scanning)
  const ready = useApp((s) => aiReady(s.view))
  const { findActionItems, toast } = useApp.getState()
  const [who, setWho] = useState<'mine' | 'all'>('mine')
  const [show, setShow] = useState<'open' | 'done'>('open')
  const today = ymd(new Date())

  const all = useMemo(() => meetings.flatMap((meeting) => meeting.actionItems.map((item) => ({ item, meeting }))), [meetings])
  const visible = all.filter((e) => (who === 'all' || e.item.mine) && e.item.done === (show === 'done'))
  const unchecked = meetings.filter((m) => !m.actionItemsChecked && (m.hasEnhanced || m.segmentCount > 0)).slice(0, 30)

  const groups = useMemo(() => {
    if (show === 'done') return [['Done', visible] as const]
    const week = ymd(addDays(localDate(today), 7))
    const tomorrow = ymd(addDays(localDate(today), 1))
    const order = ['Overdue', 'Today', 'Tomorrow', 'Next 7 days', 'Later', 'No deadline'] as const
    const bucket = (i: ActionItem) =>
      !i.due ? 'No deadline' : i.due < today ? 'Overdue' : i.due === today ? 'Today' : i.due === tomorrow ? 'Tomorrow' : i.due <= week ? 'Next 7 days' : 'Later'
    const sorted = [...visible].sort((a, b) => (a.item.due ?? '9999').localeCompare(b.item.due ?? '9999') || (a.item.time ?? '').localeCompare(b.item.time ?? ''))
    return order.map((label) => [label, sorted.filter((e) => bucket(e.item) === label)] as const).filter(([, list]) => list.length)
  }, [visible, show, today])

  const exportAll = async () => {
    const dated = visible.filter((e) => e.item.due)
    if (!dated.length) return toast('info', 'None of these have a deadline yet. Set one by clicking "No deadline".')
    const path = await window.api.files.save({ defaultName: 'NitroScribe action items.ics', content: actionItemsToIcs(dated.map(context)), filters: [{ name: 'Calendar', extensions: ['ics'] }] })
    if (path) toast('success', `Saved ${dated.length} deadline${dated.length === 1 ? '' : 's'}. In Google Calendar: Settings → Import & export → Import.`)
  }

  return (
    <div className="flex h-full flex-col">
      <TopBar />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[640px] px-6 pb-24 pt-3">
          <div className="mb-5 flex items-end justify-between gap-3">
            <div>
              <h1 className="serif text-[30px] font-normal">Action items</h1>
              <div className="text-[12.5px] text-muted">From your meetings, with owners and deadlines. Hover one to add it to Google Calendar.</div>
            </div>
            {show === 'open' && visible.length > 0 && (
              <Button size="sm" onClick={() => void exportAll()} title="One calendar file with every deadline (Google, Outlook, Apple)">
                <Download className="size-3.5" /> Export to calendar
              </Button>
            )}
          </div>

          <div className="mb-4 flex flex-wrap items-center gap-2">
            <Segmented value={who} onChange={setWho} options={[{ value: 'mine', label: 'Mine' }, { value: 'all', label: 'Everyone' }]} />
            <Segmented value={show} onChange={setShow} options={[{ value: 'open', label: 'To do' }, { value: 'done', label: 'Done' }]} />
          </div>

          {(unchecked.length > 0 || scanning) && (
            <div className="mb-5 flex items-center gap-3 rounded-xl border border-edge px-3.5 py-3">
              <Sparkles className="size-4 flex-none text-accent" />
              <div className="min-w-0 flex-1 text-[12.5px]">
                {scanning ? (
                  <span>
                    Reading meetings… {scanning.done} of {scanning.total}
                  </span>
                ) : (
                  <span>
                    {unchecked.length} meeting{unchecked.length === 1 ? " hasn't" : "s haven't"} been checked for action items yet.
                    {!ready && ' Connect an AI model to do this.'}
                  </span>
                )}
              </div>
              <Button size="sm" loading={!!scanning} onClick={() => void findActionItems(unchecked.map((m) => m.id))}>
                Find action items
              </Button>
            </div>
          )}

          {groups.length ? (
            <div className="space-y-5">
              {groups.map(([label, list]) => (
                <section key={label}>
                  <div className={clsx('mb-0.5 px-2 text-[12px] font-medium', label === 'Overdue' ? 'text-danger' : 'text-muted')}>
                    {label} <span className="text-faint">· {list.length}</span>
                  </div>
                  {list.map((e) => (
                    <ItemRow key={e.item.id} entry={e} today={today} />
                  ))}
                </section>
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center px-6 py-16 text-center">
              <ListChecks className="size-6 text-faint" />
              <div className="mt-3 text-[13.5px] font-medium">{show === 'done' ? 'Nothing checked off yet' : 'Nothing to do'}</div>
              <div className="mt-1 max-w-[380px] text-[12.5px] leading-relaxed text-muted">
                {who === 'mine' && all.some((e) => !e.item.mine && !e.item.done) ? (
                  <>
                    Nothing is assigned to you.{' '}
                    <button className="font-medium text-ink underline" onClick={() => setWho('all')}>
                      Show everyone's
                    </button>
                  </>
                ) : (
                  'After a meeting, NitroScribe writes your notes and pulls out who promised to do what, and by when.'
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
