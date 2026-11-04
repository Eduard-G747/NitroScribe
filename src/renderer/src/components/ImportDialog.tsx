import clsx from 'clsx'
import { ArrowLeft, FileAudio, FileText, Sparkles, Upload } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { formatClock, formatDuration } from '@shared/format'
import { allTemplates } from '@shared/templates'
import type { ImportPreview } from '@shared/types'
import { toLocalInput } from '../lib/dates'
import { aiReady, useApp, type AudioPreview } from '../lib/store'
import { Avatar, Button, CloseButton, Field, Modal, Select, TextArea, TextInput, speakerColor } from './ui'

const cleanError = (err: unknown) => (err as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

const ACCEPT = '.txt,.vtt,.srt,.docx,.md,.json,.text,.mp3,.m4a,.aac,.wav,.ogg,.oga,.opus,.flac,.webm,.weba,.mp4,.m4v,.mov,.mkv,.3gp,.amr,.wma'

function ChooseStep() {
  const { importDroppedFile, openImport, toast } = useApp.getState()
  const decoding = useApp((s) => s.decoding)
  const [text, setText] = useState('')
  const [over, setOver] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const paste = async () => {
    try {
      openImport(await window.api.imports.parse(text, ''))
    } catch (err) {
      toast('error', cleanError(err))
    }
  }
  return (
    <div className="space-y-5">
      <div
        onDragOver={(e) => {
          e.preventDefault()
          setOver(true)
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          e.stopPropagation()
          setOver(false)
          const file = e.dataTransfer.files[0]
          if (file) void importDroppedFile(file)
        }}
        className={clsx('flex flex-col items-center rounded-2xl border-2 border-dashed px-6 py-8 text-center transition-colors', over ? 'border-accent bg-accent-soft' : 'border-edge')}
      >
        <Upload className="size-6 text-muted" />
        <div className="mt-3 text-[14px] font-medium">{decoding ? 'Reading the recording…' : 'Drop a recording or a transcript here'}</div>
        <div className="mt-1 max-w-[440px] text-[12.5px] leading-relaxed text-muted">
          Recordings (.mp3, .m4a, .wav, .ogg, .flac, or a video) are transcribed on this computer. Transcripts can be Zoom, Teams or Meet files
          (.vtt, .docx, .txt), subtitles (.srt), Markdown, or a NitroScribe export.
        </div>
        <input
          ref={input}
          type="file"
          accept={ACCEPT}
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0]
            e.target.value = ''
            if (file) void importDroppedFile(file)
          }}
        />
        <Button className="mt-4" onClick={() => input.current?.click()} loading={decoding}>
          Choose file…
        </Button>
      </div>
      <div>
        <div className="mb-1.5 text-[13px] font-medium">…or paste it</div>
        <TextArea rows={6} value={text} onChange={(e) => setText(e.target.value)} placeholder={'Sarah: Thanks for joining…\nMarcus: Happy to be here.'} className="font-mono text-[12.5px]" />
        <div className="mt-2 flex justify-end">
          <Button variant="solid" disabled={!text.trim()} onClick={() => void paste()}>
            Continue
          </Button>
        </div>
      </div>
    </div>
  )
}

function ReviewStep({ preview }: { preview: ImportPreview }) {
  const view = useApp((s) => s.view!)
  const { openImport, finishImport, toast } = useApp.getState()
  const settings = view.settings
  const ready = aiReady(view)
  const defaultMe = useMemo(() => {
    if (preview.suggestedMe) return preview.suggestedMe
    const first = settings.userName.trim().toLowerCase().split(/\s+/)[0]
    const names = preview.speakers.map((s) => s.name)
    return (
      names.find((n) => first && (n.toLowerCase() === settings.userName.trim().toLowerCase() || n.toLowerCase().split(/\s+/)[0] === first)) ??
      names.find((n) => /^(me|you|myself)$/i.test(n)) ??
      ''
    )
  }, [preview, settings.userName])
  const [title, setTitle] = useState(preview.title)
  const [when, setWhen] = useState(toLocalInput(preview.date ? new Date(preview.date) : new Date()))
  const [me, setMe] = useState(defaultMe)
  const [templateId, setTemplateId] = useState('summary')
  const [summarize, setSummarize] = useState(ready)
  const [busy, setBusy] = useState(false)
  useEffect(() => setMe(defaultMe), [defaultMe])

  const last = preview.lines[preview.lines.length - 1]
  const submit = async () => {
    setBusy(true)
    try {
      await finishImport(
        { title: title.trim(), startedAt: new Date(when).toISOString(), lines: preview.lines, me: me || undefined, fileName: preview.fileName, format: preview.format },
        { summarize, templateId }
      )
    } catch (err) {
      toast('error', cleanError(err))
      setBusy(false)
    }
  }
  const nameOf = (speaker?: string) => (!speaker ? 'Unknown' : speaker === me ? `${speaker} (you)` : speaker)

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 rounded-xl bg-hover px-3.5 py-3">
        <FileText className="size-4 flex-none text-muted" />
        <div className="min-w-0 flex-1 text-[12.5px]">
          <div className="truncate font-medium text-ink">{preview.fileName || 'Pasted text'}</div>
          <div className="text-muted">
            {preview.format} · {preview.lines.length} lines
            {preview.timed && last ? ` · ${formatDuration(last.end)}` : ''} · {preview.speakers.length ? `${preview.speakers.length} speakers` : 'no speaker names'}
          </div>
        </div>
      </div>

      <Field label="Title" hint={!title.trim() && ready ? 'Leave empty to let the AI name it.' : undefined}>
        <TextInput value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Untitled meeting" />
      </Field>
      <div className="grid grid-cols-2 gap-4">
        <Field label="When did it happen?" hint={preview.date ? 'Found in the file.' : 'Not in the file: set the date of the meeting.'}>
          <TextInput type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
        </Field>
        <Field label="Which speaker is you?">
          <Select value={me} onChange={(e) => setMe(e.target.value)} disabled={!preview.speakers.length}>
            <option value="">{preview.speakers.length ? "I'm not in this transcript" : 'No speaker names in the file'}</option>
            {preview.speakers.map((s) => (
              <option key={s.name} value={s.name}>
                {s.name} ({s.lines} lines)
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <div className="rounded-xl border border-edge">
        <div className="max-h-44 space-y-2 overflow-y-auto px-3.5 py-3 text-[12.5px] leading-relaxed">
          {preview.lines.slice(0, 8).map((l, i) => (
            <div key={i} className="flex gap-2">
              <span className="w-10 flex-none tabular-nums text-faint">{formatClock(l.start)}</span>
              {l.speaker && (
                <span className="flex flex-none items-start gap-1.5 font-medium" style={{ color: l.speaker === me ? 'var(--accent)' : speakerColor(l.speaker) }}>
                  <Avatar name={l.speaker} color={l.speaker === me ? 'var(--accent)' : speakerColor(l.speaker)} size={16} />
                  {nameOf(l.speaker)}
                </span>
              )}
              <span className="min-w-0 text-ink">{l.text.length > 180 ? `${l.text.slice(0, 180)}…` : l.text}</span>
            </div>
          ))}
          {preview.lines.length > 8 && <div className="pl-12 text-faint">…and {preview.lines.length - 8} more lines</div>}
        </div>
      </div>

      <div className="flex items-center gap-3 rounded-xl border border-edge px-3.5 py-3">
        <input id="summarize" type="checkbox" checked={summarize} disabled={!ready} onChange={(e) => setSummarize(e.target.checked)} className="accent-[var(--accent)]" />
        <label htmlFor="summarize" className={clsx('min-w-0 flex-1 text-[13px]', !ready && 'text-muted')}>
          <span className="flex items-center gap-1.5 font-medium">
            <Sparkles className="size-3.5 text-accent" /> Write AI notes and a summary
          </span>
          <span className="text-[12px] text-muted">{ready ? 'Uses your AI model right after importing.' : 'Connect an AI model in Settings to do this.'}</span>
        </label>
        <Select value={templateId} onChange={(e) => setTemplateId(e.target.value)} disabled={!summarize} className="!w-44">
          {allTemplates(settings.customTemplates).map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </Select>
      </div>

      <div className="flex items-center justify-between pt-1">
        <Button variant="ghost" onClick={() => openImport()}>
          <ArrowLeft className="size-3.5" /> Back
        </Button>
        <Button variant="primary" loading={busy} disabled={!when} onClick={() => void submit()}>
          Import{summarize ? ' and summarize' : ''}
        </Button>
      </div>
    </div>
  )
}

/** Review a decoded recording before it is transcribed locally. */
function AudioReviewStep({ preview }: { preview: AudioPreview }) {
  const view = useApp((s) => s.view!)
  const recording = useApp((s) => s.recording)
  const busyJob = useApp((s) => Object.keys(s.audioJobs).length > 0)
  const { openImport, startAudioImport, toast } = useApp.getState()
  const ready = aiReady(view)
  const [title, setTitle] = useState(preview.title)
  const [when, setWhen] = useState(toLocalInput(preview.date ? new Date(preview.date) : new Date()))
  const [templateId, setTemplateId] = useState('summary')
  const [summarize, setSummarize] = useState(ready)
  const [busy, setBusy] = useState(false)
  const blocked = recording.status !== 'idle' ? 'Stop the current recording first.' : busyJob ? 'Another recording is still being transcribed.' : ''
  const submit = async () => {
    setBusy(true)
    try {
      await startAudioImport(preview, { title: title.trim(), startedAt: new Date(when).toISOString(), summarize, templateId })
    } catch (err) {
      toast('error', cleanError(err))
      setBusy(false)
    }
  }
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 rounded-xl bg-hover px-3.5 py-3">
        <FileAudio className="size-4 flex-none text-muted" />
        <div className="min-w-0 flex-1 text-[12.5px]">
          <div className="truncate font-medium text-ink">{preview.fileName}</div>
          <div className="text-muted">Recording · {formatDuration(preview.durationMs)} · transcribed and split by speaker on this computer</div>
        </div>
      </div>
      <Field label="Title" hint={!title.trim() && ready ? 'Leave empty to let the AI name it.' : undefined}>
        <TextInput value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Untitled meeting" />
      </Field>
      <Field label="When was it recorded?" hint={preview.date ? 'Guessed from the file. Change it if needed.' : undefined}>
        <TextInput type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
      </Field>
      <div className="flex items-center gap-3 rounded-xl border border-edge px-3.5 py-3">
        <input id="summarize-audio" type="checkbox" checked={summarize} disabled={!ready} onChange={(e) => setSummarize(e.target.checked)} className="accent-[var(--accent)]" />
        <label htmlFor="summarize-audio" className={clsx('min-w-0 flex-1 text-[13px]', !ready && 'text-muted')}>
          <span className="flex items-center gap-1.5 font-medium">
            <Sparkles className="size-3.5 text-accent" /> Write AI notes and a summary when it's done
          </span>
          <span className="text-[12px] text-muted">{ready ? 'Uses your AI model after transcription.' : 'Connect an AI model in Settings to do this.'}</span>
        </label>
        <Select value={templateId} onChange={(e) => setTemplateId(e.target.value)} disabled={!summarize} className="!w-44">
          {allTemplates(view.settings.customTemplates).map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </Select>
      </div>
      <div className="text-[12px] leading-relaxed text-muted">
        Long recordings take a while (roughly a third of their length on a good GPU). You can keep using NitroScribe while it works.
      </div>
      <div className="flex items-center justify-between pt-1">
        <Button variant="ghost" onClick={() => openImport()}>
          <ArrowLeft className="size-3.5" /> Back
        </Button>
        <Button variant="primary" loading={busy} disabled={!when || !!blocked} title={blocked || undefined} onClick={() => void submit()}>
          Transcribe
        </Button>
      </div>
    </div>
  )
}

export function ImportDialog() {
  const importing = useApp((s) => s.importing)
  const closeImport = useApp((s) => s.closeImport)
  return (
    <Modal open={!!importing} onClose={closeImport} className="flex max-h-[92vh] w-[min(640px,94vw)] flex-col">
      <div className="flex flex-none items-center justify-between px-6 pb-2 pt-5">
        <h2 className="serif text-[24px]">{importing && importing !== 'choose' && 'pcm' in importing ? 'Transcribe a recording' : 'Import'}</h2>
        <CloseButton onClick={closeImport} />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6 pt-2">
        {importing === 'choose' ? <ChooseStep /> : importing && ('pcm' in importing ? <AudioReviewStep preview={importing} /> : <ReviewStep preview={importing} />)}
      </div>
    </Modal>
  )
}
