import clsx from 'clsx'
import { ArrowUp, Check, ChevronDown, Loader2, Mic, Play, ScrollText, Sparkles, Square } from 'lucide-react'
import { useState } from 'react'
import { formatClock } from '@shared/format'
import { allTemplates } from '@shared/templates'
import type { Meeting } from '@shared/types'
import { elapsedMs, useTicker } from '../lib/hooks'
import { useApp } from '../lib/store'
import { Bars, Dropdown, MenuItem } from './ui'

function RecordControl({ meeting }: { meeting: Meeting }) {
  const recording = useApp((s) => s.recording)
  const levels = useApp((s) => s.levels)
  const panel = useApp((s) => s.panel)
  const job = useApp((s) => s.audioJobs[meeting.id])
  const { startRecording, stopRecording, setPanel, openMeeting, openSettings, cancelAudioImport } = useApp.getState()
  const mine = recording.meetingId === meeting.id
  const live = mine && recording.status === 'recording'
  const now = useTicker(live, 250)
  const toggleTranscript = () => setPanel(panel === 'transcript' ? null : 'transcript')

  if (mine && recording.status === 'finishing') {
    return (
      <button onClick={toggleTranscript} className="flex h-9 items-center gap-2 rounded-xl px-3 text-[13px] text-muted hover:bg-hover">
        <Loader2 className="size-4 animate-spin text-accent" />
        Finishing transcript…
      </button>
    )
  }
  if (live) {
    const engineNote =
      recording.engine === 'starting'
        ? 'Loading speech model…'
        : recording.engine === 'error'
          ? 'Speech engine error'
          : recording.pendingSeconds > 2
            ? 'Transcribing…'
            : null
    return (
      <div className="flex items-center gap-1">
        <button
          onClick={toggleTranscript}
          title="Show transcript"
          className={clsx('flex h-9 items-center gap-2.5 rounded-xl px-3 text-accent transition-colors hover:bg-accent-soft', panel === 'transcript' && 'bg-accent-soft')}
        >
          <Bars level={Math.max(levels.mic, levels.sys)} active />
          <span className="font-medium tabular-nums text-ink">{formatClock(elapsedMs(recording, now))}</span>
          {engineNote && (
            <span
              className={clsx('text-[12px]', recording.engine === 'error' ? 'text-danger' : 'text-muted')}
              onClick={recording.engine === 'error' ? () => openSettings('transcription') : undefined}
            >
              {engineNote}
            </span>
          )}
        </button>
        <button
          onClick={() => void stopRecording()}
          title="Stop transcribing"
          className="flex size-9 items-center justify-center rounded-xl text-muted hover:bg-hover hover:text-danger"
        >
          <Square className="size-3.5 fill-current" />
        </button>
      </div>
    )
  }
  if (recording.status !== 'idle' && !mine) {
    return (
      <button
        onClick={() => recording.meetingId && void openMeeting(recording.meetingId)}
        className="flex h-9 items-center gap-2 rounded-xl px-3 text-[13px] text-muted hover:bg-hover"
        title="Another meeting is being recorded"
      >
        <span className="pulse-dot size-2 rounded-full bg-red-500" />
        Recording another meeting
      </button>
    )
  }
  const hasTranscript = meeting.transcript.length > 0
  // An imported transcript is a finished record of a past meeting, so there's nothing to resume.
  const imported = meeting.source?.kind === 'import'
  if (job) {
    return (
      <div className="flex items-center gap-1">
        <button onClick={toggleTranscript} className="flex h-9 items-center gap-2 rounded-xl px-3 text-[13px] text-muted hover:bg-hover" title="Show the transcript as it comes in">
          <Loader2 className="size-4 animate-spin text-accent" />
          <span className="font-medium text-ink">Transcribing {Math.round(job.progress * 100)}%</span>
        </button>
        <button
          onClick={() => confirm('Stop transcribing this recording? What is done so far is kept.') && cancelAudioImport(meeting.id)}
          title="Stop transcribing"
          className="flex size-9 items-center justify-center rounded-xl text-muted hover:bg-hover hover:text-danger"
        >
          <Square className="size-3.5 fill-current" />
        </button>
      </div>
    )
  }
  return (
    <div className="flex items-center gap-1">
      {imported ? (
        <button
          onClick={toggleTranscript}
          className={clsx('flex h-9 items-center gap-2 rounded-xl px-3 text-[13px] font-medium text-muted hover:bg-hover hover:text-ink', panel === 'transcript' && 'bg-hover text-ink')}
        >
          <ScrollText className="size-4" /> Transcript
        </button>
      ) : (
        <button
          onClick={() => void startRecording(meeting.id)}
          className="flex h-9 items-center gap-2 rounded-xl px-3 text-[13px] font-medium text-accent hover:bg-accent-soft"
        >
          {hasTranscript ? <Play className="size-4 fill-current" /> : <Mic className="size-4" />}
          {hasTranscript ? 'Resume' : 'Start transcribing'}
        </button>
      )}
      {hasTranscript && !imported && (
        <button
          onClick={toggleTranscript}
          title="Transcript"
          className={clsx('flex size-9 items-center justify-center rounded-xl text-muted hover:bg-hover hover:text-ink', panel === 'transcript' && 'bg-hover text-ink')}
        >
          <ScrollText className="size-4" />
        </button>
      )}
    </div>
  )
}

function GenerateButton({ meeting }: { meeting: Meeting }) {
  const enhancing = useApp((s) => s.enhancing)
  const view = useApp((s) => s.view)
  const { enhance, cancelEnhance } = useApp.getState()
  const templates = allTemplates(view?.settings.customTemplates ?? [])
  const activeTemplate = meeting.templateId ?? view?.settings.defaultTemplateId ?? 'auto'
  const busy = enhancing?.meetingId === meeting.id
  const canRun = meeting.transcript.length > 0 || meeting.notesMarkdown.trim().length > 0

  if (busy) {
    return (
      <button onClick={cancelEnhance} className="flex h-9 items-center gap-2 rounded-xl bg-hover px-3 text-[13px] font-medium text-ink hover:bg-active">
        <Square className="size-3 fill-current" /> Stop
      </button>
    )
  }
  const primary = !meeting.enhancedMarkdown
  return (
    <div className={clsx('flex h-9 items-center overflow-hidden rounded-xl', primary ? 'bg-accent text-white dark:text-[#10331f]' : 'bg-hover text-ink', !canRun && 'opacity-50')}>
      <button
        disabled={!canRun || !!enhancing}
        onClick={() => void enhance({ templateId: activeTemplate })}
        className={clsx('flex h-full items-center gap-1.5 pl-3 pr-2 text-[13px] font-medium', primary ? 'hover:brightness-110' : 'hover:bg-active')}
        title={canRun ? undefined : 'Record or write notes first'}
      >
        <Sparkles className="size-4" />
        {primary ? 'Generate notes' : 'Regenerate'}
      </button>
      <Dropdown
        side="top"
        align="right"
        className="w-72"
        trigger={({ toggle }) => (
          <button
            disabled={!canRun || !!enhancing}
            onClick={toggle}
            className={clsx('flex h-9 items-center border-l px-1.5', primary ? 'border-black/10 hover:brightness-110' : 'border-edge hover:bg-active')}
            title="Choose a template"
          >
            <ChevronDown className="size-4" />
          </button>
        )}
      >
        {(close) => (
          <div className="max-h-80 overflow-y-auto">
            <div className="px-2.5 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-wide text-faint">Template</div>
            {templates.map((t) => (
              <MenuItem
                key={t.id}
                icon={t.id === activeTemplate ? <Check className="size-3.5 text-accent" /> : null}
                hint={t.description}
                onClick={() => {
                  close()
                  void enhance({ templateId: t.id })
                }}
              >
                {t.name}
              </MenuItem>
            ))}
          </div>
        )}
      </Dropdown>
    </div>
  )
}

export function BottomBar({ meeting }: { meeting: Meeting }) {
  const [question, setQuestion] = useState('')
  const ask = useApp((s) => s.ask)
  const submit = () => {
    if (!question.trim()) return
    ask(question, 'meeting')
    setQuestion('')
  }
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-4 z-20 flex justify-center px-8">
      <div className="pointer-events-auto flex w-full max-w-[720px] items-center gap-1.5 rounded-2xl border border-edge bg-card p-1.5 shadow-[0_10px_30px_rgba(0,0,0,0.12)]">
        <RecordControl meeting={meeting} />
        <div className="mx-0.5 h-6 w-px bg-edge" />
        <div className="flex min-w-0 flex-1 items-center">
          <input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
            placeholder="Ask anything"
            className="h-9 min-w-0 flex-1 bg-transparent px-2 text-[13.5px] outline-none placeholder:text-faint"
          />
          {question.trim() && (
            <button onClick={submit} className="mr-1 flex size-7 items-center justify-center rounded-lg bg-ink text-app hover:opacity-90" title="Ask">
              <ArrowUp className="size-4" />
            </button>
          )}
        </div>
        <GenerateButton meeting={meeting} />
      </div>
    </div>
  )
}
