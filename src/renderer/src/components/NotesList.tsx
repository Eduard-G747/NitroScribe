import clsx from 'clsx'
import { FileText, MoreHorizontal, Sparkles, Trash2 } from 'lucide-react'
import type { MeetingSummary } from '@shared/types'
import { dayLabel, groupBy } from '../lib/dates'
import { useApp } from '../lib/store'
import { Dropdown, IconButton, MenuItem, Time } from './ui'

function NoteRow({ m, recording }: { m: MeetingSummary; recording: boolean }) {
  const { openMeeting, deleteMeeting } = useApp.getState()
  const when = m.startedAt ?? m.createdAt
  return (
    <div className="group relative">
      <button onClick={() => void openMeeting(m.id)} className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-hover">
        <span className="relative flex size-8 flex-none items-center justify-center rounded-md bg-tile">
          <FileText className="size-4 text-muted" strokeWidth={1.75} />
          {recording && <span className="pulse-dot absolute -right-0.5 -top-0.5 size-2.5 rounded-full border-2 border-app bg-red-500" />}
        </span>
        <span className="min-w-0 flex-1">
          <span className={clsx('block truncate text-[13.5px] font-medium', !m.title && 'text-muted')}>{m.title || 'Untitled meeting'}</span>
          <span className="flex items-center gap-1.5 truncate text-[12px] text-muted">
            {m.participants.length ? m.participants.slice(0, 4).join(', ') : 'Me'}
            {m.hasEnhanced && <Sparkles className="size-3 flex-none text-faint" />}
          </span>
        </span>
        <Time date={when} className="flex-none pr-1 text-[12px] text-muted group-hover:invisible" />
      </button>
      <div className="invisible absolute right-1.5 top-1/2 -translate-y-1/2 group-hover:visible">
        <Dropdown
          align="right"
          trigger={({ toggle }) => (
            <IconButton label="More" onClick={toggle}>
              <MoreHorizontal className="size-4" />
            </IconButton>
          )}
        >
          {(close) => (
            <MenuItem
              danger
              icon={<Trash2 className="size-3.5" />}
              onClick={() => {
                close()
                if (confirm(`Delete “${m.title || 'Untitled meeting'}”? It will be moved to the Recycle Bin.`)) void deleteMeeting(m.id)
              }}
            >
              Delete
            </MenuItem>
          )}
        </Dropdown>
      </div>
    </div>
  )
}

/** Meetings grouped by day, newest first. */
export function NotesList({ meetings }: { meetings: MeetingSummary[] }) {
  const recording = useApp((s) => s.recording)
  const groups = groupBy(meetings, (m) => dayLabel(m.startedAt ?? m.createdAt))
  return (
    <div className="space-y-5">
      {groups.map(([label, items]) => (
        <section key={label}>
          <div className="mb-1 px-2 text-[12px] font-medium text-muted">{label}</div>
          {items.map((m) => (
            <NoteRow key={m.id} m={m} recording={recording.status !== 'idle' && recording.meetingId === m.id} />
          ))}
        </section>
      ))}
    </div>
  )
}
