import clsx from 'clsx'
import { AlertTriangle, Copy, Download, Sparkles, UserRound } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { talkTime } from '@shared/insights'
import type { VoiceSummary } from '@shared/api'
import {
  formatClock,
  formatDuration,
  meetingFileBase,
  mergeTurns,
  remoteSpeakers,
  speakerNamer,
  transcriptToJson,
  transcriptToMarkdown,
  transcriptToSrt,
  transcriptToText
} from '@shared/format'
import type { Meeting } from '@shared/types'
import { aiReady, useApp } from '../lib/store'
import { Avatar, Button, CloseButton, Dropdown, IconButton, MenuItem, speakerColor } from './ui'

export async function downloadTranscript(meeting: Meeting, format: 'txt' | 'md' | 'srt' | 'json', userName: string) {
  const content =
    format === 'txt'
      ? transcriptToText(meeting, userName)
      : format === 'md'
        ? transcriptToMarkdown(meeting, userName)
        : format === 'srt'
          ? transcriptToSrt(meeting, userName)
          : transcriptToJson(meeting, userName)
  const names = { txt: 'Text', md: 'Markdown', srt: 'Subtitles', json: 'JSON' }
  const path = await window.api.files.save({
    defaultName: `${meetingFileBase(meeting)} - transcript.${format}`,
    content,
    filters: [{ name: names[format], extensions: [format] }]
  })
  if (path) useApp.getState().toast('success', `Saved ${path}`)
}

/** Popover form to put a name on a voice-separated speaker. */
function RenameForm({ meeting, speakerId, current, close }: { meeting: Meeting; speakerId: string; current: string; close: () => void }) {
  const rememberDefault = useApp((s) => s.view?.settings.transcription.rememberVoices ?? true)
  const renameSpeaker = useApp((s) => s.renameSpeaker)
  const named = !!meeting.speakers?.[speakerId]?.name
  const [name, setName] = useState(named ? current : '')
  const [remember, setRemember] = useState(rememberDefault)
  const [voices, setVoices] = useState<VoiceSummary[]>([])
  useEffect(() => void window.api.speakers.voices().then(setVoices), [])
  const suggestions = [...new Set([...meeting.attendees, ...voices.map((v) => v.name)])]
    .filter((n) => n.toLowerCase().includes(name.trim().toLowerCase()) && n !== name)
    .slice(0, 5)
  const save = (value = name) => {
    void renameSpeaker(speakerId, value, remember)
    close()
  }
  return (
    <div className="w-64 p-2">
      <div className="px-1 pb-1.5 text-[11.5px] font-medium text-faint">Who is {current}?</div>
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && save()}
        placeholder="Name"
        className="h-8 w-full rounded-lg border border-edge bg-app px-2.5 text-[13px] outline-none focus:border-accent/60"
      />
      {suggestions.length > 0 && (
        <div className="mt-1">
          {suggestions.map((s) => (
            <MenuItem key={s} icon={<UserRound className="size-3.5" />} onClick={() => save(s)}>
              {s}
            </MenuItem>
          ))}
        </div>
      )}
      <label className="mt-2 flex items-center gap-2 px-1 text-[12px] text-muted">
        <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="accent-[var(--accent)]" />
        Recognize this voice in future meetings
      </label>
      <div className="mt-2 flex justify-end gap-1.5">
        {named && (
          <Button size="sm" variant="ghost" onClick={() => save('')}>
            Clear
          </Button>
        )}
        <Button size="sm" variant="solid" onClick={() => save()} disabled={!name.trim()}>
          Save
        </Button>
      </div>
    </div>
  )
}

function SpeakerLabel({ meeting, speakerId, name, className }: { meeting: Meeting; speakerId?: string; name: string; className?: string }) {
  if (!speakerId) return <span className={clsx('font-medium text-muted', className)}>{name}</span>
  return (
    <Dropdown
      trigger={({ toggle }) => (
        <button onClick={toggle} className={clsx('rounded font-medium hover:underline', className)} style={{ color: speakerColor(speakerId) }} title="Rename speaker">
          {name}
        </button>
      )}
      className="!p-0"
    >
      {(close) => <RenameForm meeting={meeting} speakerId={speakerId} current={name} close={close} />}
    </Dropdown>
  )
}

function Level({ value, label }: { value: number; label: string }) {
  const pct = Math.min(100, Math.sqrt(value) * 320)
  return (
    <span className="flex items-center gap-1.5" title={`${label} input level`}>
      {label}
      <span className="h-1.5 w-10 overflow-hidden rounded-full bg-hover">
        <span className="block h-full rounded-full bg-accent transition-[width] duration-100" style={{ width: `${pct}%` }} />
      </span>
    </span>
  )
}

export function TranscriptPanel({ meeting }: { meeting: Meeting }) {
  const recording = useApp((s) => s.recording)
  const systemAudio = useApp((s) => s.systemAudio)
  const levels = useApp((s) => s.levels)
  const identifying = useApp((s) => s.identifying)
  const view = useApp((s) => s.view)
  const userName = view?.settings.userName ?? ''
  const { setPanel, toast, identifySpeakers } = useApp.getState()
  const nameOf = useMemo(() => speakerNamer(meeting, userName), [meeting, userName])
  const turns = useMemo(() => mergeTurns(meeting.transcript, nameOf), [meeting.transcript, nameOf])
  const people = useMemo(() => remoteSpeakers(meeting, userName), [meeting, userName])
  const talk = useMemo(() => talkTime(meeting, userName), [meeting, userName])
  const jumpTo = useApp((s) => s.jumpTo)
  const [flash, setFlash] = useState<string | null>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const stick = useRef(true)
  const live = recording.meetingId === meeting.id && recording.status !== 'idle'

  useEffect(() => {
    const el = scroller.current
    if (el && stick.current && !jumpTo) el.scrollTop = el.scrollHeight
  }, [turns.length, jumpTo])

  // Coming from search: scroll to the moment and highlight it.
  useEffect(() => {
    if (!jumpTo || jumpTo.meetingId !== meeting.id) return
    const turn = turns.find((t) => t.ids.includes(jumpTo.segmentId))
    const el = turn && scroller.current?.querySelector<HTMLElement>(`[data-turn="${turn.ids[0]}"]`)
    if (!turn || !el) return
    stick.current = false
    el.scrollIntoView({ block: 'center' })
    setFlash(turn.ids[0])
    useApp.setState({ jumpTo: null })
    const t = setTimeout(() => setFlash(null), 2500)
    return () => clearTimeout(t)
  }, [jumpTo, turns, meeting.id])

  const copy = async () => {
    await window.api.files.copy(transcriptToText(meeting, userName))
    toast('success', 'Transcript copied')
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-12 flex-none items-center gap-0.5 border-b border-edge px-4">
        <div className="flex-1 text-[13.5px] font-semibold">Transcript</div>
        <IconButton label="Copy transcript" onClick={() => void copy()} disabled={!turns.length}>
          <Copy className="size-4" />
        </IconButton>
        <Dropdown
          align="right"
          trigger={({ toggle }) => (
            <IconButton label="Download transcript" onClick={toggle} disabled={!turns.length}>
              <Download className="size-4" />
            </IconButton>
          )}
        >
          {(close) =>
            (
              [
                ['txt', 'Plain text (.txt)'],
                ['md', 'Markdown (.md)'],
                ['srt', 'Subtitles (.srt)'],
                ['json', 'JSON (.json)']
              ] as const
            ).map(([fmt, label]) => (
              <MenuItem
                key={fmt}
                onClick={() => {
                  close()
                  void downloadTranscript(meeting, fmt, userName)
                }}
              >
                {label}
              </MenuItem>
            ))
          }
        </Dropdown>
        <CloseButton onClick={() => setPanel(null)} />
      </div>

      {people.length > 0 && (
        <div className="flex flex-none flex-wrap items-center gap-1.5 border-b border-edge px-4 py-2.5">
          <span className="mr-0.5 inline-flex items-center gap-1.5 rounded-full bg-hover py-0.5 pl-0.5 pr-2.5 text-[12px]">
            <Avatar name={userName || 'Me'} color="var(--accent)" size={18} />
            {userName || 'Me'}
          </span>
          {people.map((p) => (
            <span key={p.id} className="inline-flex items-center gap-1.5 rounded-full bg-hover py-0.5 pl-0.5 pr-2.5 text-[12px]">
              <Avatar name={p.named ? p.name : p.name.replace('Speaker ', '')} color={speakerColor(p.id)} size={18} />
              <SpeakerLabel meeting={meeting} speakerId={p.id} name={p.name} className="!text-ink" />
            </span>
          ))}
          {people.some((p) => !p.named) && aiReady(view) && !live && (
            <Button size="sm" variant="ghost" loading={identifying} onClick={() => void identifySpeakers()} title="Let the AI work out names from the conversation">
              <Sparkles className="size-3.5" /> Identify
            </Button>
          )}
        </div>
      )}

      {talk.length > 1 && !live && (
        <div className="flex-none border-b border-edge px-4 py-2.5" title="Share of speaking time">
          <div className="flex h-1.5 overflow-hidden rounded-full bg-hover">
            {talk.map((p) => (
              <span key={p.name} style={{ width: `${p.share * 100}%`, background: p.key === 'me' ? 'var(--accent)' : speakerColor(p.key) }} />
            ))}
          </div>
          <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11.5px] text-muted">
            {talk.map((p) => (
              <span key={p.name} className="inline-flex items-center gap-1">
                <span className="size-1.5 rounded-full" style={{ background: p.key === 'me' ? 'var(--accent)' : speakerColor(p.key) }} />
                {p.name} {Math.round(p.share * 100)}%<span className="text-faint">· {p.ms < 60_000 ? `${Math.round(p.ms / 1000)} s` : formatDuration(p.ms)}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {live && recording.status === 'recording' && !systemAudio && (
        <div className="mx-4 mt-3 flex gap-2 rounded-lg bg-amber-500/10 px-3 py-2 text-[12.5px] text-amber-700 dark:text-amber-300">
          <AlertTriangle className="mt-0.5 size-3.5 flex-none" />
          The call's audio is not being captured, so only your microphone is transcribed.
        </div>
      )}
      {live && recording.pendingSeconds > 90 && (
        <div className="mx-4 mt-3 flex gap-2 rounded-lg bg-amber-500/10 px-3 py-2 text-[12.5px] text-amber-700 dark:text-amber-300">
          <AlertTriangle className="mt-0.5 size-3.5 flex-none" />
          <span>
            Transcription is falling behind (your GPU is busy). Nothing is lost: it will catch up. For faster transcription, switch to{' '}
            <button className="font-medium underline" onClick={() => useApp.getState().openSettings('transcription')}>
              Large v3 Turbo
            </button>
            .
          </span>
        </div>
      )}

      <div
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
        }}
        className="flex-1 space-y-3 overflow-y-auto px-4 py-4"
      >
        {!turns.length && (
          <div className="px-4 py-16 text-center text-[13px] leading-relaxed text-muted">
            {live ? 'Listening… the transcript appears here in short batches as people speak.' : 'No transcript yet.'}
            <div className="mt-2 text-[12px] text-faint">Your microphone is you; everyone on the call is told apart by voice.</div>
          </div>
        )}
        {turns.map((t) => (
          <div
            key={t.ids[0]}
            data-turn={t.ids[0]}
            className={clsx('flex flex-col rounded-2xl transition-shadow duration-700', t.speaker === 'me' ? 'items-end' : 'items-start', flash === t.ids[0] && 'ring-2 ring-accent ring-offset-4 ring-offset-app')}
          >
            <div className="mb-1 flex items-center gap-1.5 px-1 text-[11.5px] text-faint">
              <SpeakerLabel meeting={meeting} speakerId={t.speakerId} name={t.name} />
              <span>{formatClock(t.start)}</span>
            </div>
            <div
              className={clsx(
                'max-w-[88%] select-text rounded-2xl px-3.5 py-2 text-[13.5px] leading-relaxed',
                t.speaker === 'me' ? 'rounded-br-md bg-bubble-me' : 'rounded-bl-md bg-bubble'
              )}
            >
              {t.text}
            </div>
          </div>
        ))}
      </div>

      {live && (
        <div className="flex flex-none items-center gap-3 border-t border-edge px-4 py-2.5 text-[12px] text-muted">
          {recording.status === 'finishing' ? (
            <>Finishing the last part of the transcript…</>
          ) : (
            <>
              <span className="pulse-dot size-2 rounded-full bg-accent" />
              <span className="flex-1">
                Listening{recording.pendingSeconds > 2 && <span className="text-faint"> · transcribing {recording.pendingSeconds}s</span>}
              </span>
              <Level value={levels.mic} label="You" />
              {systemAudio && <Level value={levels.sys} label="Call" />}
            </>
          )}
        </div>
      )}
    </div>
  )
}
