import clsx from 'clsx'
import { CalendarDays, ChevronRight, Clock, Copy, Download, FileText, MoreHorizontal, Sparkles, Trash2, Upload, Video } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { formatDuration, meetingDate, meetingFileBase, remoteSpeakers } from '@shared/format'
import { findTemplate } from '@shared/templates'
import type { Meeting, MeetingPatch } from '@shared/types'
import { dayLabel, toLocalInput } from '../lib/dates'
import { htmlToMarkdown, markdownToHtml } from '../lib/markdown'
import { useApp } from '../lib/store'
import { BottomBar } from './BottomBar'
import { ChatPanel } from './ChatPanel'
import { NotesEditor } from './NotesEditor'
import { TopBar } from './TopBar'
import { TranscriptPanel, downloadTranscript } from './TranscriptPanel'
import { Avatar, Button, Dropdown, IconButton, MenuItem, Time, speakerColor } from './ui'

/** Debounces calls; a pending call is flushed (not dropped) when the component unmounts. */
function useDebounced<T extends unknown[]>(fn: (...args: T) => void, ms: number) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingArgs = useRef<T | null>(null)
  const latest = useRef(fn)
  latest.current = fn
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
      if (pendingArgs.current) latest.current(...pendingArgs.current)
    },
    []
  )
  return useMemo(
    () =>
      (...args: T) => {
        pendingArgs.current = args
        if (timer.current) clearTimeout(timer.current)
        timer.current = setTimeout(() => {
          pendingArgs.current = null
          latest.current(...args)
        }, ms)
      },
    [ms]
  )
}

/** Saves to the open meeting through the store, or straight to disk if the user has already moved on. */
function saveFor(id: string, patch: MeetingPatch) {
  const { current, patchCurrent } = useApp.getState()
  if (current?.id === id) patchCurrent(patch)
  else void window.api.meetings.update(id, patch)
}

const chip = 'inline-flex h-7 items-center gap-1.5 rounded-full border border-edge px-2.5 text-[12px] text-muted'

/** The meeting's date; click to change it (not while it is being recorded or transcribed). */
function DateChip({ meeting }: { meeting: Meeting }) {
  const recording = useApp((s) => s.recording)
  const transcribing = useApp((s) => !!s.audioJobs[meeting.id])
  const patchCurrent = useApp((s) => s.patchCurrent)
  const date = meetingDate(meeting)
  const label = (
    <>
      <CalendarDays className="size-3.5" />
      {dayLabel(date)} · <Time date={date} />
    </>
  )
  if ((recording.meetingId === meeting.id && recording.status !== 'idle') || transcribing) return <span className={chip}>{label}</span>
  return (
    <Dropdown
      className="!p-0"
      trigger={({ toggle }) => (
        <button className={clsx(chip, 'hover:bg-hover hover:text-ink')} onClick={toggle} title="Change the date">
          {label}
        </button>
      )}
    >
      {(close) => <DateEditor initial={date} onSave={(iso) => (patchCurrent({ startedAt: iso }), close())} onCancel={close} />}
    </Dropdown>
  )
}

function DateEditor({ initial, onSave, onCancel }: { initial: Date; onSave: (iso: string) => void; onCancel: () => void }) {
  const [value, setValue] = useState(toLocalInput(initial))
  const valid = !Number.isNaN(new Date(value).getTime())
  return (
    <div className="w-64 p-2.5">
      <div className="px-0.5 pb-1.5 text-[11.5px] font-medium text-faint">Date and time of the meeting</div>
      <input
        type="datetime-local"
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && valid && onSave(new Date(value).toISOString())}
        className="h-8 w-full rounded-lg border border-edge bg-app px-2.5 text-[13px] outline-none focus:border-accent/60"
      />
      <div className="mt-2.5 flex justify-end gap-1.5">
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="sm" variant="solid" disabled={!valid} onClick={() => onSave(new Date(value).toISOString())}>
          Save
        </Button>
      </div>
    </div>
  )
}

function MetaChips({ meeting }: { meeting: Meeting }) {
  const userName = useApp((s) => s.view?.settings.userName ?? '')
  const setPanel = useApp((s) => s.setPanel)
  const people = remoteSpeakers(meeting, userName)
  const extraAttendees = meeting.attendees.filter((a) => !people.some((p) => p.name === a))
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <DateChip meeting={meeting} />
      {meeting.durationMs > 0 && (
        <span className={chip}>
          <Clock className="size-3.5" />
          {formatDuration(meeting.durationMs)}
        </span>
      )}
      {(people.length > 0 || extraAttendees.length > 0) && (
        <button className={clsx(chip, 'hover:bg-hover hover:text-ink')} onClick={() => setPanel('transcript')} title={[...people.map((p) => p.name), ...extraAttendees].join(', ')}>
          <span className="flex -space-x-1.5">
            {people.slice(0, 4).map((p) => (
              <span key={p.id} className="rounded-full ring-2 ring-app">
                <Avatar name={p.named ? p.name : p.name.replace('Speaker ', '')} color={speakerColor(p.id)} size={18} />
              </span>
            ))}
            {!people.length &&
              extraAttendees.slice(0, 4).map((a) => (
                <span key={a} className="rounded-full ring-2 ring-app">
                  <Avatar name={a} size={18} />
                </span>
              ))}
          </span>
          {people.length ? `${people.length + 1} people` : `${extraAttendees.length} invited`}
        </button>
      )}
      {meeting.source?.kind === 'import' && (
        <span className={chip} title={meeting.source.fileName ? `Imported from ${meeting.source.fileName}` : 'Imported transcript'}>
          <Upload className="size-3.5" />
          Imported{meeting.source.format ? ` · ${meeting.source.format}` : ''}
        </span>
      )}
      {meeting.calendarEvent?.meetingUrl && (
        <button className={clsx(chip, 'hover:bg-hover hover:text-ink')} onClick={() => void window.api.app.openExternal(meeting.calendarEvent!.meetingUrl!)}>
          <Video className="size-3.5" />
          Join call
        </button>
      )}
    </div>
  )
}

function NotesToggle({ meeting }: { meeting: Meeting }) {
  const mode = useApp((s) => s.notesMode)
  const enhancing = useApp((s) => s.enhancing)
  const view = useApp((s) => s.view)
  const setNotesMode = useApp((s) => s.setNotesMode)
  const busy = enhancing?.meetingId === meeting.id
  if (!meeting.enhancedMarkdown && !busy) return null
  const template = findTemplate(meeting.templateId, view?.settings.customTemplates ?? [])
  const btn = (active: boolean) =>
    clsx('flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[12.5px] font-medium transition-colors', active ? 'bg-card text-ink shadow-sm' : 'text-muted hover:text-ink')
  return (
    <div className="mb-5 flex items-center gap-3">
      <div className="inline-flex rounded-lg bg-hover p-0.5">
        <button className={btn(mode === 'ai')} onClick={() => setNotesMode('ai')}>
          <Sparkles className="size-3.5" /> AI notes
        </button>
        <button className={btn(mode === 'mine')} onClick={() => setNotesMode('mine')}>
          <FileText className="size-3.5" /> My notes
        </button>
      </div>
      {mode === 'ai' && !busy && <span className="text-[12px] text-faint">{template.name} template</span>}
      {busy && <span className="text-[12px] text-muted">Writing your notes…</span>}
    </div>
  )
}

function StreamingNotes({ text }: { text: string }) {
  return text ? (
    <div className="notes pb-40 text-ai [&_strong]:text-ai" dangerouslySetInnerHTML={{ __html: markdownToHtml(text) }} />
  ) : (
    <div className="space-y-3 pt-1">
      {[0.5, 0.9, 0.75, 0.85, 0.6].map((w, i) => (
        <div key={i} className="shimmer h-3.5 rounded" style={{ width: `${w * 100}%` }} />
      ))}
    </div>
  )
}

function MoreMenu({ meeting }: { meeting: Meeting }) {
  const { deleteMeeting, toast } = useApp.getState()
  const userName = useApp((s) => s.view?.settings.userName ?? '')
  const notesMd = () => [`# ${meeting.title || 'Untitled meeting'}`, '', meeting.enhancedMarkdown || meeting.notesMarkdown].join('\n')
  return (
    <Dropdown
      align="right"
      className="w-60"
      trigger={({ toggle }) => (
        <IconButton label="More" onClick={toggle}>
          <MoreHorizontal className="size-4" />
        </IconButton>
      )}
    >
      {(close) => (
        <>
          <MenuItem
            icon={<Copy className="size-3.5" />}
            onClick={() => {
              close()
              void window.api.files.copy(notesMd())
              toast('success', 'Notes copied as Markdown')
            }}
          >
            Copy notes
          </MenuItem>
          <MenuItem
            icon={<Download className="size-3.5" />}
            onClick={async () => {
              close()
              const path = await window.api.files.save({ defaultName: `${meetingFileBase(meeting)}.md`, content: notesMd(), filters: [{ name: 'Markdown', extensions: ['md'] }] })
              if (path) toast('success', `Saved ${path}`)
            }}
          >
            Download notes (.md)
          </MenuItem>
          <MenuItem
            icon={<Download className="size-3.5" />}
            onClick={() => {
              close()
              void downloadTranscript(meeting, 'txt', userName)
            }}
          >
            Download transcript (.txt)
          </MenuItem>
          <div className="my-1 h-px bg-edge" />
          <MenuItem
            danger
            icon={<Trash2 className="size-3.5" />}
            onClick={() => {
              close()
              if (confirm(`Delete “${meeting.title || 'Untitled meeting'}”? It will be moved to the Recycle Bin.`)) void deleteMeeting(meeting.id)
            }}
          >
            Delete meeting
          </MenuItem>
        </>
      )}
    </Dropdown>
  )
}

export function MeetingView() {
  const meeting = useApp((s) => s.current)
  const mode = useApp((s) => s.notesMode)
  const panel = useApp((s) => s.panel)
  const enhancing = useApp((s) => s.enhancing)
  const recording = useApp((s) => s.recording)
  const { patchCurrent, setPanel, goNotes } = useApp.getState()

  const saveNotes = useDebounced((id: string, html: string) => saveFor(id, { notesHtml: html, notesMarkdown: htmlToMarkdown(html) }), 250)
  const saveEnhanced = useDebounced((id: string, html: string) => saveFor(id, { enhancedHtml: html, enhancedMarkdown: htmlToMarkdown(html) }), 400)

  if (!meeting) return null
  const busy = enhancing?.meetingId === meeting.id
  const isRecording = recording.meetingId === meeting.id && recording.status === 'recording'
  const showAi = mode === 'ai' && (busy || !!meeting.enhancedMarkdown)

  return (
    <div className="flex h-full flex-col">
      <TopBar
        left={
          <button onClick={() => void goNotes()} className="no-drag flex items-center gap-1 rounded-md px-1.5 py-1 text-[12.5px] text-muted hover:bg-hover hover:text-ink">
            My notes <ChevronRight className="size-3.5 text-faint" />
            <span className="max-w-[260px] truncate text-ink">{meeting.title || 'Untitled meeting'}</span>
          </button>
        }
      >
        <MoreMenu meeting={meeting} />
      </TopBar>
      <div className="flex min-h-0 flex-1">
        <main className="relative min-w-0 flex-1">
          <div className="h-full overflow-y-auto">
            <div className="mx-auto max-w-[660px] px-10 pt-6">
              <input
                value={meeting.title}
                onChange={(e) => patchCurrent({ title: e.target.value })}
                placeholder="Untitled meeting"
                className="serif mb-3 w-full bg-transparent text-[32px] font-normal leading-tight outline-none placeholder:text-faint"
              />
              <MetaChips meeting={meeting} />
              <div className="h-7" />
              <NotesToggle meeting={meeting} />
              {showAi ? (
                busy ? (
                  <StreamingNotes text={enhancing!.text} />
                ) : (
                  <NotesEditor key={`${meeting.id}-ai-${meeting.enhancedAt ?? ''}`} initialHtml={meeting.enhancedHtml ?? ''} onChange={(html) => saveEnhanced(meeting.id, html)} placeholder="AI notes" ai />
                )
              ) : (
                <NotesEditor
                  key={`${meeting.id}-mine`}
                  initialHtml={meeting.notesHtml}
                  onChange={(html) => saveNotes(meeting.id, html)}
                  autofocus={!meeting.notesHtml}
                  placeholder={
                    isRecording
                      ? 'Write notes… NitroScribe is transcribing in the background. Jot down what matters and it will be woven into your AI notes.'
                      : 'Write notes…'
                  }
                />
              )}
            </div>
          </div>
          <BottomBar meeting={meeting} />
        </main>
        {panel && (
          <aside className="w-[400px] flex-none border-l border-edge bg-app">
            {panel === 'transcript' ? <TranscriptPanel meeting={meeting} /> : <ChatPanel scope="meeting" onClose={() => setPanel(null)} />}
          </aside>
        )}
      </div>
    </div>
  )
}
