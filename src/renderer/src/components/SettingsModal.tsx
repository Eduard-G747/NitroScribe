import clsx from 'clsx'
import {
  Bot,
  Calendar,
  CheckCircle2,
  Copy,
  Cpu,
  Download,
  ExternalLink,
  FileText,
  FolderOpen,
  LayoutTemplate,
  Lock,
  Mic,
  Monitor,
  Moon,
  Plus,
  RefreshCw,
  Settings2,
  ShieldCheck,
  Sun,
  Trash2,
  XCircle
} from 'lucide-react'
import { useEffect, useState } from 'react'
import type { VoiceSummary } from '@shared/api'
import { NOTES_LANGUAGES, TRANSCRIPTION_LANGUAGES } from '@shared/languages'
import { hostOf, isLocalUrl } from '@shared/net'
import { PROVIDERS, providerPreset } from '@shared/providers'
import { BUILT_IN_TEMPLATES, allTemplates } from '@shared/templates'
import type { CalendarSource, LlmProviderId, Template } from '@shared/types'
import { WHISPER_BINARIES, WHISPER_MODELS } from '@shared/whisperModels'
import { useApp, type SettingsTab } from '../lib/store'
import { Avatar, Button, CloseButton, Field, Modal, Segmented, Select, TextArea, TextInput, Toggle } from './ui'

const TABS: { id: SettingsTab; label: string; icon: typeof Cpu }[] = [
  { id: 'general', label: 'General', icon: Settings2 },
  { id: 'transcription', label: 'Transcription', icon: Cpu },
  { id: 'ai', label: 'AI model', icon: Bot },
  { id: 'templates', label: 'Templates', icon: LayoutTemplate },
  { id: 'calendar', label: 'Calendar', icon: Calendar },
  { id: 'data', label: 'Privacy & data', icon: ShieldCheck }
]

export const formatBytes = (n: number) => (n >= 1e9 ? `${(n / 1e9).toFixed(2)} GB` : `${Math.round(n / 1e6)} MB`)

function Section({ title, children, description }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="mb-8">
      <h3 className="text-[15px] font-semibold">{title}</h3>
      {description && <p className="mt-1 text-[13px] leading-relaxed text-muted">{description}</p>}
      <div className="mt-3 divide-y divide-edge">{children}</div>
    </section>
  )
}

function Result({ result }: { result: { ok: boolean; message: string } | null }) {
  if (!result) return null
  return (
    <div className={clsx('mt-2 flex items-start gap-2 rounded-lg px-3 py-2 text-[12.5px]', result.ok ? 'bg-accent-soft text-accent' : 'bg-danger/10 text-danger')}>
      {result.ok ? <CheckCircle2 className="mt-0.5 size-3.5 flex-none" /> : <XCircle className="mt-0.5 size-3.5 flex-none" />}
      <span className="break-words">{result.message}</span>
    </div>
  )
}

function GeneralTab() {
  const s = useApp((st) => st.view!.settings)
  const update = useApp((st) => st.updateSettings)
  const [name, setName] = useState(s.userName)
  return (
    <>
      <Section title="You">
        <Field label="Your name" hint="Used to label your side of the transcript and in AI notes.">
          <TextInput value={name} onChange={(e) => setName(e.target.value)} onBlur={() => void update({ userName: name.trim() })} placeholder="e.g. Eduardo" />
        </Field>
      </Section>
      <Section title="Appearance">
        <Field inline label="Theme" hint="Follow your system, or always use light or dark.">
          <Segmented
            value={s.general.theme}
            onChange={(theme) => void update({ general: { theme } })}
            options={[
              { value: 'system', label: <><Monitor className="size-3.5" /> System</> },
              { value: 'light', label: <><Sun className="size-3.5" /> Light</> },
              { value: 'dark', label: <><Moon className="size-3.5" /> Dark</> }
            ]}
          />
        </Field>
      </Section>
      <Section title="App">
        <Field inline label="Keep running in the tray when closed" hint="Lets calendar reminders work and keeps recordings going if you close the window.">
          <Toggle checked={s.general.closeToTray} onChange={(v) => void update({ general: { closeToTray: v } })} />
        </Field>
        <Field inline label="Launch at login" hint="Starts quietly in the tray (menu bar on Mac). Applies to the installed app.">
          <Toggle checked={s.general.launchAtLogin} onChange={(v) => void update({ general: { launchAtLogin: v } })} />
        </Field>
        <Field inline label="Remind me when a calendar meeting starts" hint="Shows a notification you can click to start taking notes.">
          <Toggle checked={s.notifyMeetings} onChange={(v) => void update({ notifyMeetings: v })} />
        </Field>
      </Section>
    </>
  )
}

function TranscriptionTab() {
  const s = useApp((st) => st.view!.settings)
  const whisper = useApp((st) => st.whisper)
  const recording = useApp((st) => st.recording)
  const { updateSettings: update, toast } = useApp.getState()
  const t = s.transcription
  const [mics, setMics] = useState<MediaDeviceInfo[]>([])
  const [vocab, setVocab] = useState(t.vocabulary)

  useEffect(() => {
    void (async () => {
      let devices = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput')
      if (devices.length && !devices[0].label) {
        try {
          const s = await navigator.mediaDevices.getUserMedia({ audio: true })
          s.getTracks().forEach((tr) => tr.stop())
          devices = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput')
        } catch {
          /* labels stay hidden */
        }
      }
      setMics(devices.filter((d) => d.deviceId !== 'default' && d.deviceId !== 'communications'))
    })()
  }, [])

  const install = (model = t.model) => window.api.whisper.install(model).catch((err: Error) => toast('error', err.message))
  const binarySize = whisper?.binary ? 0 : WHISPER_BINARIES[whisper?.gpu ? 'cuda' : 'cpu'].size
  const dl = whisper?.download
  const serverLabel =
    whisper?.server === 'ready'
      ? `Running on ${whisper.device === 'gpu' ? 'GPU' : 'CPU'}`
      : whisper?.server === 'starting'
        ? 'Starting…'
        : whisper?.server === 'error'
          ? 'Error'
          : 'Idle (starts when you record)'

  return (
    <>
      <Section title="Local speech recognition" description="NitroScribe runs OpenAI's Whisper on this PC with whisper.cpp. Audio never leaves your computer and nothing is recorded to disk.">
        <div className="grid grid-cols-3 gap-3 py-3 text-[12.5px]">
          <div className="rounded-xl border border-edge bg-card p-3">
            <div className="text-faint">Engine</div>
            <div className="mt-0.5 font-medium">{whisper?.binary ? ({ cuda: 'Installed (NVIDIA CUDA)', metal: 'Installed (Apple GPU)', cpu: 'Installed (CPU)' } as const)[whisper.binary] : 'Not installed'}</div>
          </div>
          <div className="rounded-xl border border-edge bg-card p-3">
            <div className="text-faint">Graphics card</div>
            <div className="mt-0.5 truncate font-medium" title={whisper?.gpu?.name}>
              {whisper?.gpu ? `${whisper.gpu.name.replace(/^NVIDIA\s+/, '')} · ${Math.round(whisper.gpu.vramMb / 1024)} GB` : 'No NVIDIA GPU found'}
            </div>
          </div>
          <div className="rounded-xl border border-edge bg-card p-3">
            <div className="text-faint">Status</div>
            <div className={clsx('mt-0.5 font-medium', whisper?.server === 'error' && 'text-danger')}>{serverLabel}</div>
          </div>
        </div>
        {whisper?.error && <div className="rounded-lg bg-danger/10 px-3 py-2 text-[12.5px] text-danger">{whisper.error}</div>}
        {whisper?.installing && (
          <div className="py-3">
            <div className="mb-1.5 flex justify-between text-[12.5px]">
              <span className="font-medium">{dl?.label ?? 'Preparing download…'}</span>
              <span className="text-muted">{dl && dl.total ? `${formatBytes(dl.received)} of ${formatBytes(dl.total)}` : ''}</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-hover">
              <div className={clsx('h-full rounded-full bg-accent transition-all', !dl?.total && 'shimmer w-full')} style={dl?.total ? { width: `${(100 * dl.received) / dl.total}%` } : undefined} />
            </div>
            <Button size="sm" variant="ghost" className="mt-2" onClick={() => void window.api.whisper.cancel()}>
              Cancel download
            </Button>
          </div>
        )}
      </Section>

      <Section title="Model" description="Large v3 is the most accurate Whisper model and fits in 4 GB of VRAM. Switch to Turbo if your GPU struggles to keep up.">
        {WHISPER_MODELS.map((m) => {
          const installed = whisper?.installedModels.includes(m.id)
          const selected = t.model === m.id
          return (
            <div key={m.id} className="flex items-center gap-3 py-3">
              <input
                type="radio"
                checked={selected}
                onChange={() => void update({ transcription: { model: m.id } })}
                disabled={recording.status !== 'idle'}
                className="accent-[var(--accent)]"
              />
              <div className="min-w-0 flex-1">
                <div className="text-[13.5px] font-medium">
                  {m.label} <span className="font-normal text-faint">· {formatBytes(m.size)}</span>
                </div>
                <div className="text-[12.5px] text-muted">{m.description}</div>
              </div>
              {installed ? (
                <span className="flex items-center gap-2">
                  <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[11.5px] font-medium text-accent">Installed</span>
                  {!selected && (
                    <Button size="sm" variant="ghost" onClick={() => void window.api.whisper.deleteModel(m.id)} title="Delete model">
                      <Trash2 className="size-3.5" />
                    </Button>
                  )}
                </span>
              ) : (
                <Button size="sm" disabled={whisper?.installing} onClick={() => void install(m.id)}>
                  Download {formatBytes(m.size + (selected ? binarySize : 0))}
                </Button>
              )}
            </div>
          )
        })}
        {!whisper?.installing && whisper && (!whisper.binary || !whisper.installedModels.includes(t.model)) && (
          <div className="py-3">
            <Button variant="primary" onClick={() => void install()}>
              Set up local transcription ({formatBytes(binarySize + (whisper.installedModels.includes(t.model) ? 0 : WHISPER_MODELS.find((m) => m.id === t.model)!.size))})
            </Button>
          </div>
        )}
      </Section>

      <Section title="Audio">
        <Field label="Spoken language" hint="Auto-detect works for 99 languages and handles multilingual calls. Picking a language is slightly faster and more accurate.">
          <Select value={t.language} onChange={(e) => void update({ transcription: { language: e.target.value } })}>
            {TRANSCRIPTION_LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>
                {l.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Microphone">
          <Select value={t.micDeviceId} onChange={(e) => void update({ transcription: { micDeviceId: e.target.value } })}>
            <option value="">System default</option>
            {mics.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label || 'Microphone'}
              </option>
            ))}
          </Select>
        </Field>
        <Field inline label="Transcribe the other side of the call" hint="Captures your computer's audio output (Zoom, Teams, Meet in the browser…): everyone else on the call.">
          <Toggle checked={t.captureSystemAudio} onChange={(v) => void update({ transcription: { captureSystemAudio: v } })} />
        </Field>
        <Field inline label="Noise suppression on the microphone">
          <Toggle checked={t.noiseSuppression} onChange={(v) => void update({ transcription: { noiseSuppression: v } })} />
        </Field>
        <Field inline label="Use the GPU" hint="Much faster than CPU. Turn off only if the GPU causes problems.">
          <Toggle checked={t.useGpu} onChange={(v) => void update({ transcription: { useGpu: v } })} />
        </Field>
        <Field label="Custom vocabulary" hint="Names, companies, products and jargon that Whisper should spell correctly, separated by commas.">
          <TextArea rows={2} value={vocab} onChange={(e) => setVocab(e.target.value)} onBlur={() => void update({ transcription: { vocabulary: vocab } })} placeholder="e.g. NitroScribe, Kubernetes, Ana Souza, OKRs" />
        </Field>
      </Section>
      <SpeakersSection />
    </>
  )
}

function SpeakersSection() {
  const s = useApp((st) => st.view!.settings)
  const whisper = useApp((st) => st.whisper)
  const { updateSettings: update, toast } = useApp.getState()
  const [voices, setVoices] = useState<VoiceSummary[]>([])
  useEffect(() => void window.api.speakers.voices().then(setVoices), [])
  return (
    <>
      <Section
        title="Speakers"
        description="NitroScribe tells the people on a call apart by their voices, so the transcript shows who said what. Names come from the conversation (with an AI model), from your calendar, or when you click a speaker in the transcript and type a name."
      >
        <Field inline label="Tell speakers apart" hint={whisper?.speakerModel ? 'Uses a small voice-recognition model on this PC.' : 'The voice model (28 MB) downloads with the speech engine.'}>
          <Toggle checked={s.transcription.separateSpeakers} onChange={(v) => void update({ transcription: { separateSpeakers: v } })} />
        </Field>
        <Field inline label="Let the AI work out names" hint="After a meeting, the AI reads the transcript to match voices to names (e.g. “Thanks, Sarah”). Needs an AI model.">
          <Toggle checked={s.ai.autoNameSpeakers} onChange={(v) => void update({ ai: { autoNameSpeakers: v } })} />
        </Field>
        <Field inline label="Remember voices of people you name" hint="Recognizes them automatically in later meetings. Voiceprints never leave this computer.">
          <Toggle checked={s.transcription.rememberVoices} onChange={(v) => void update({ transcription: { rememberVoices: v } })} />
        </Field>
        {!whisper?.speakerModel && whisper?.binary && (
          <div className="py-3">
            <Button onClick={() => void window.api.whisper.install(s.transcription.model).catch((e: Error) => toast('error', e.message))} disabled={whisper.installing}>
              Download voice model (28 MB)
            </Button>
          </div>
        )}
      </Section>
      {voices.length > 0 && (
        <Section title="Remembered voices">
          {voices.map((v) => (
            <div key={v.id} className="flex items-center gap-3 py-2.5">
              <Avatar name={v.name} size={24} />
              <div className="min-w-0 flex-1">
                <div className="text-[13.5px] font-medium">{v.name}</div>
                <div className="text-[12px] text-faint">
                  Learned from {v.samples} meeting{v.samples === 1 ? '' : 's'}
                </div>
              </div>
              <Button
                size="sm"
                variant="ghost"
                title="Forget this voice"
                onClick={async () => {
                  await window.api.speakers.forgetVoice(v.id)
                  setVoices(voices.filter((x) => x.id !== v.id))
                }}
              >
                <Trash2 className="size-3.5" />
              </Button>
            </div>
          ))}
        </Section>
      )}
      <Button size="sm" variant="ghost" onClick={() => void window.api.app.openFolder('logs')}>
        <FolderOpen className="size-3.5" /> Open logs folder
      </Button>
    </>
  )
}

export function AiTab() {
  const view = useApp((st) => st.view!)
  const { updateSettings: update, toast } = useApp.getState()
  const s = view.settings
  const provider = s.ai.provider
  const preset = providerPreset(provider)
  const cfg = s.ai.providers[provider]
  const [key, setKey] = useState('')
  const [baseUrl, setBaseUrl] = useState(cfg.baseUrl)
  const [model, setModel] = useState(cfg.model)
  const [models, setModels] = useState<string[]>([])
  const [loadingModels, setLoadingModels] = useState(false)
  const [testing, setTesting] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null)
  const hasKey = view.keys[provider]
  const localOnly = s.privacy.localOnly

  useEffect(() => {
    setBaseUrl(cfg.baseUrl)
    setModel(cfg.model)
    setModels([])
    setResult(null)
    setKey('')
  }, [provider]) // eslint-disable-line react-hooks/exhaustive-deps

  const setProviderCfg = (patch: Partial<typeof cfg>) => update({ ai: { providers: { [provider]: patch } } })
  const fetchModels = async () => {
    setLoadingModels(true)
    try {
      const list = await window.api.ai.models(provider)
      setModels(list)
      if (!list.length) toast('info', 'No models were returned.')
    } catch (err) {
      toast('error', `Could not list models: ${(err as Error).message}`)
    } finally {
      setLoadingModels(false)
    }
  }
  const test = async () => {
    setTesting(true)
    setResult(null)
    await setProviderCfg({ baseUrl: baseUrl.trim(), model: model.trim() })
    setResult(await window.api.ai.test(provider))
    setTesting(false)
  }

  return (
    <>
      <Section
        title="AI model"
        description="Bring your own model for AI notes, speaker names and chat. Only the text of a meeting (notes + transcript) is used, and only when you generate notes or ask a question."
      >
        {localOnly && (
          <div className="my-2 flex items-start gap-2.5 rounded-xl bg-accent-soft px-3.5 py-3 text-[12.5px] leading-relaxed">
            <Lock className="mt-0.5 size-3.5 flex-none text-accent" />
            <span className="text-ink">
              <span className="font-medium">Local-only mode is on.</span> Meeting data stays on this PC: use Ollama or LM Studio (or any server on your home network).{' '}
              <button className="font-medium text-accent underline" onClick={() => useApp.getState().openSettings('data')}>
                Privacy settings
              </button>
            </span>
          </div>
        )}
        <Field label="Provider">
          <Select value={provider} onChange={(e) => void update({ ai: { provider: e.target.value as LlmProviderId } })}>
            <optgroup label="On this computer">
              {PROVIDERS.filter((p) => p.local).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </optgroup>
            <optgroup label={localOnly ? 'Cloud (blocked by Local-only mode)' : 'Cloud: meeting text is sent to the provider'}>
              {PROVIDERS.filter((p) => !p.local && p.id !== 'custom').map((p) => (
                <option key={p.id} value={p.id} disabled={localOnly}>
                  {p.label}
                </option>
              ))}
            </optgroup>
            <optgroup label="Other">
              <option value="custom">Custom (OpenAI-compatible server)</option>
            </optgroup>
          </Select>
        </Field>
        {(preset.needsKey || provider === 'custom') && (
          <Field
            label="API key"
            hint={
              <>
                Stored encrypted on this computer (Windows DPAPI or the macOS Keychain).{' '}
                {preset.keyUrl && (
                  <button className="inline-flex items-center gap-0.5 font-medium text-accent underline" onClick={() => void window.api.app.openExternal(preset.keyUrl!)}>
                    Get a key <ExternalLink className="size-3" />
                  </button>
                )}
              </>
            }
          >
            <div className="flex gap-2">
              <TextInput type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder={hasKey ? '•••••••••••••••• (saved)' : 'Paste your API key'} autoComplete="off" />
              <Button
                disabled={!key.trim()}
                onClick={async () => {
                  await window.api.settings.setKey(provider, key)
                  setKey('')
                  toast('success', 'API key saved')
                }}
              >
                Save
              </Button>
              {hasKey && (
                <Button variant="ghost" onClick={() => void window.api.settings.setKey(provider, '')} title="Remove key">
                  <Trash2 className="size-3.5" />
                </Button>
              )}
            </div>
          </Field>
        )}
        <Field label="Model" hint={preset.local ? 'Pick one of the models installed locally.' : 'Use “Load models” to see what your key can access.'}>
          <div className="flex gap-2">
            <TextInput list="model-options" value={model} onChange={(e) => setModel(e.target.value)} onBlur={() => void setProviderCfg({ model: model.trim() })} placeholder="Model name" />
            <datalist id="model-options">
              {models.map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
            <Button onClick={() => void fetchModels()} loading={loadingModels}>
              <RefreshCw className="size-3.5" /> Load models
            </Button>
          </div>
          {models.length > 0 && (
            <div className="mt-2 flex max-h-28 flex-wrap gap-1.5 overflow-y-auto">
              {models.map((m) => (
                <button
                  key={m}
                  onClick={() => {
                    setModel(m)
                    void setProviderCfg({ model: m })
                  }}
                  className={clsx('rounded-full border px-2 py-0.5 text-[12px]', m === model ? 'border-accent bg-accent-soft text-accent' : 'border-edge bg-card hover:bg-hover')}
                >
                  {m}
                </button>
              ))}
            </div>
          )}
        </Field>
        <Field label="API base URL" hint={provider === 'custom' ? 'Any OpenAI-compatible endpoint, e.g. https://api.together.xyz/v1' : 'Change only if you use a proxy or a non-default port.'}>
          <TextInput value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} onBlur={() => void setProviderCfg({ baseUrl: baseUrl.trim() })} placeholder="https://…" />
        </Field>
        <div className="py-3">
          <Button variant="solid" onClick={() => void test()} loading={testing}>
            Test connection
          </Button>
          <Result result={result} />
        </div>
      </Section>
      <Section title="Notes">
        <Field inline label="Generate AI notes automatically when a meeting ends">
          <Toggle checked={s.ai.autoEnhance} onChange={(v) => void update({ ai: { autoEnhance: v } })} />
        </Field>
        <Field inline label="Find action items after writing notes" hint="Owners and deadlines go to the Action items page, ready for your calendar.">
          <Toggle checked={s.ai.autoActionItems} onChange={(v) => void update({ ai: { autoActionItems: v } })} />
        </Field>
        <Field label="Default template">
          <Select value={s.defaultTemplateId} onChange={(e) => void update({ defaultTemplateId: e.target.value })}>
            {allTemplates(s.customTemplates).map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Language of AI notes">
          <Select value={s.ai.notesLanguage} onChange={(e) => void update({ ai: { notesLanguage: e.target.value } })}>
            {NOTES_LANGUAGES.map((l) => (
              <option key={l} value={l}>
                {l === 'auto' ? 'Same as the meeting' : l}
              </option>
            ))}
          </Select>
        </Field>
      </Section>
    </>
  )
}

function TemplatesTab() {
  const s = useApp((st) => st.view!.settings)
  const update = useApp((st) => st.updateSettings)
  const [drafts, setDrafts] = useState<Template[]>(s.customTemplates)
  const save = (list: Template[]) => {
    setDrafts(list)
    void update({ customTemplates: list })
  }
  const add = (base?: Template) =>
    save([
      ...drafts,
      {
        id: `custom-${crypto.randomUUID().slice(0, 8)}`,
        name: base ? `${base.name} (custom)` : 'My template',
        description: base?.description ?? '',
        instructions: base?.instructions ?? 'Use these sections: `### Summary`, `### Details`, `### Action items`.'
      }
    ])
  const edit = (id: string, patch: Partial<Template>) => setDrafts(drafts.map((t) => (t.id === id ? { ...t, ...patch } : t)))

  return (
    <>
      <Section title="Your templates" description="Templates tell the AI how to structure your notes. Write instructions in plain language, e.g. which headings to use.">
        {drafts.map((t) => (
          <div key={t.id} className="space-y-2 py-4">
            <div className="flex gap-2">
              <TextInput value={t.name} onChange={(e) => edit(t.id, { name: e.target.value })} onBlur={() => save(drafts)} placeholder="Name" />
              <Button variant="ghost" onClick={() => save(drafts.filter((d) => d.id !== t.id))} title="Delete template">
                <Trash2 className="size-3.5" />
              </Button>
            </div>
            <TextInput value={t.description} onChange={(e) => edit(t.id, { description: e.target.value })} onBlur={() => save(drafts)} placeholder="Short description" />
            <TextArea rows={4} value={t.instructions} onChange={(e) => edit(t.id, { instructions: e.target.value })} onBlur={() => save(drafts)} placeholder="Instructions for the AI" />
          </div>
        ))}
        <div className="py-3">
          <Button onClick={() => add()}>
            <Plus className="size-3.5" /> New template
          </Button>
        </div>
      </Section>
      <Section title="Built-in templates">
        {BUILT_IN_TEMPLATES.map((t) => (
          <div key={t.id} className="flex items-start gap-3 py-3">
            <div className="min-w-0 flex-1">
              <div className="text-[13.5px] font-medium">{t.name}</div>
              <div className="text-[12.5px] text-muted">{t.description}</div>
            </div>
            <Button size="sm" variant="ghost" onClick={() => add(t)}>
              <Copy className="size-3.5" /> Customize
            </Button>
          </div>
        ))}
      </Section>
    </>
  )
}

function CalendarTab() {
  const s = useApp((st) => st.view!.settings)
  const calendar = useApp((st) => st.calendar)
  const update = useApp((st) => st.updateSettings)
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [testing, setTesting] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [errors, setErrors] = useState<string[]>(calendar.errors)

  const save = async (calendars: CalendarSource[]) => {
    await update({ calendars })
    const snap = await window.api.calendar.refresh()
    setErrors(snap.errors)
  }
  const test = async () => {
    setTesting(true)
    setResult(await window.api.calendar.test(url))
    setTesting(false)
  }
  const mask = (u: string) => u.replace(/(private-|secret|[?&]\w+=)[^/?&]{6,}/gi, '$1••••••')

  return (
    <>
      <Section
        title="Calendars"
        description="Paste the private iCal (.ics) address of each calendar. NitroScribe reads it every 10 minutes to show upcoming meetings, pre-fill titles and attendees, and remind you when a meeting starts."
      >
        {s.calendars.map((c) => (
          <div key={c.id} className="flex items-center gap-3 py-3">
            <Toggle checked={c.enabled} onChange={(v) => void save(s.calendars.map((x) => (x.id === c.id ? { ...x, enabled: v } : x)))} />
            <div className="min-w-0 flex-1">
              <div className="text-[13.5px] font-medium">{c.name}</div>
              <div className="truncate text-[12px] text-faint">{mask(c.url)}</div>
            </div>
            <Button size="sm" variant="ghost" onClick={() => void save(s.calendars.filter((x) => x.id !== c.id))} title="Remove">
              <Trash2 className="size-3.5" />
            </Button>
          </div>
        ))}
        {errors.length > 0 && <div className="py-2 text-[12.5px] text-danger">{errors.join(' · ')}</div>}
        <div className="space-y-2 py-4">
          <div className="text-[13.5px] font-medium">Add a calendar</div>
          <TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder="Name (e.g. Work)" />
          <TextInput value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://calendar.google.com/calendar/ical/…/basic.ics" />
          <div className="flex gap-2">
            <Button disabled={!url.trim()} loading={testing} onClick={() => void test()}>
              Test link
            </Button>
            <Button
              variant="primary"
              disabled={!url.trim()}
              onClick={() => {
                void save([...s.calendars, { id: crypto.randomUUID(), name: name.trim() || 'Calendar', url: url.trim(), enabled: true }])
                setName('')
                setUrl('')
                setResult(null)
              }}
            >
              Add calendar
            </Button>
          </div>
          <Result result={result} />
        </div>
        <div className="py-3">
          <Button
            size="sm"
            variant="ghost"
            loading={refreshing}
            onClick={async () => {
              setRefreshing(true)
              setErrors((await window.api.calendar.refresh()).errors)
              setRefreshing(false)
            }}
          >
            <RefreshCw className="size-3.5" /> Refresh now
          </Button>
        </div>
      </Section>
      <Section title="Where to find the link">
        <div className="space-y-2 py-3 text-[13px] leading-relaxed text-muted">
          <p>
            <span className="font-medium text-ink">Google Calendar:</span> calendar.google.com → Settings (gear) → click your calendar under “Settings for my calendars” → “Integrate
            calendar” → copy <span className="italic">Secret address in iCal format</span>.
          </p>
          <p>
            <span className="font-medium text-ink">Outlook / Microsoft 365:</span> outlook.com or Outlook on the web → Settings → Calendar → Shared calendars → “Publish a calendar” →
            choose “Can view all details” → Publish → copy the <span className="italic">ICS</span> link.
          </p>
          <p>Treat these links like passwords: anyone with the link can read the calendar.</p>
        </div>
      </Section>
    </>
  )
}

function PrivacyRow({ ok, icon: Icon, title, text }: { ok: boolean; icon: typeof Cpu; title: string; text: string }) {
  return (
    <li className="flex gap-3">
      <span className={clsx('mt-0.5 flex size-6 flex-none items-center justify-center rounded-md', ok ? 'bg-accent-soft text-accent' : 'bg-amber-500/15 text-amber-600 dark:text-amber-300')}>
        <Icon className="size-3.5" />
      </span>
      <span>
        <span className="font-medium text-ink">{title}</span>
        <span className="block text-[12.5px] text-muted">{text}</span>
      </span>
    </li>
  )
}

function DataTab() {
  const view = useApp((st) => st.view!)
  const info = useApp((st) => st.info)
  const meetings = useApp((st) => st.meetings)
  const toast = useApp((st) => st.toast)
  const update = useApp((st) => st.updateSettings)
  const s = view.settings
  const ai = s.ai.providers[s.ai.provider]
  const aiLabel = providerPreset(s.ai.provider).label
  const aiLocal = isLocalUrl(ai.baseUrl)
  const calendarHosts = [...new Set(s.calendars.filter((c) => c.enabled).map((c) => hostOf(c.url.replace(/^webcals?:/i, 'https:'))))]
  const setLocalOnly = (on: boolean) => {
    if (
      !on &&
      !confirm(
        'Turn off Local-only mode?\n\nWith a cloud AI provider, the text of your meetings (your notes and transcripts) is sent to that provider whenever you generate notes, identify speakers or chat. Audio never leaves your PC either way.'
      )
    )
      return
    void update({ privacy: { localOnly: on } })
  }
  return (
    <>
      <Section title="Privacy" description="NitroScribe has no accounts, servers, analytics or telemetry. What you record stays on this PC.">
        <Field
          inline
          label="Local-only mode"
          hint="Meeting data can only go to AI models running on this PC or your home network (Ollama, LM Studio). Cloud AI providers are blocked."
        >
          <Toggle checked={s.privacy.localOnly} onChange={setLocalOnly} />
        </Field>
        <div className="py-3">
          <div className="mb-3 text-[13.5px] font-medium">What touches the network</div>
          <ul className="space-y-3 text-[13px] leading-relaxed">
            <PrivacyRow ok icon={Mic} title="Audio" text="Transcribed on this PC by Whisper. Never saved to disk and never sent anywhere." />
            <PrivacyRow ok icon={FileText} title="Notes, transcripts, chats and voiceprints" text="Stored only in your data folder, as plain files." />
            <PrivacyRow
              ok={aiLocal}
              icon={Bot}
              title="AI model"
              text={
                aiLocal
                  ? `${aiLabel} at ${hostOf(ai.baseUrl)}, on this PC or your network.`
                  : s.privacy.localOnly
                    ? `${aiLabel} is a cloud service, so Local-only mode blocks it. Pick Ollama or LM Studio.`
                    : `Meeting text is sent to ${aiLabel} (${hostOf(ai.baseUrl)}) when you generate notes, identify speakers or chat.`
              }
            />
            <PrivacyRow
              ok
              icon={Calendar}
              title="Calendar"
              text={calendarHosts.length ? `Your iCal feeds are downloaded from ${calendarHosts.join(', ')}. Nothing is uploaded.` : 'No calendars connected.'}
            />
            <PrivacyRow ok icon={Download} title="Speech models" text="Downloaded once from GitHub and Hugging Face during setup, and verified against known SHA-256 fingerprints." />
            <PrivacyRow
              ok
              icon={RefreshCw}
              title="Update reminders"
              text={s.updates.check ? 'Once a day, asks GitHub whether a newer version is out. Nothing about you or your meetings is sent.' : 'Off.'}
            />
            <PrivacyRow ok icon={ShieldCheck} title="The app window" text="Blocked from connecting to the internet. No ads, analytics or crash reports." />
          </ul>
        </div>
        <Field inline label="Tell me when a new version is out" hint="Shows a reminder with a download link. Nothing installs by itself.">
          <Toggle checked={s.updates.check} onChange={(v) => void update({ updates: { check: v } })} />
        </Field>
      </Section>
      <Section title="Your data" description="Each meeting is a JSON file in the data folder, so your history is unlimited and easy to back up.">
        <div className="flex items-center gap-3 py-3">
          <div className="min-w-0 flex-1">
            <div className="text-[13.5px] font-medium">Data folder</div>
            <div className="truncate text-[12px] text-muted">{view.dataDir}</div>
          </div>
          <Button onClick={() => void window.api.app.openFolder('data')}>
            <FolderOpen className="size-3.5" /> Open
          </Button>
        </div>
        <div className="flex items-center gap-3 py-3">
          <div className="min-w-0 flex-1">
            <div className="text-[13.5px] font-medium">Export all meetings</div>
            <div className="text-[12px] text-muted">
              {meetings.length} meeting{meetings.length === 1 ? '' : 's'} as Markdown files (AI notes, your notes and transcript).
            </div>
          </div>
          <Button
            onClick={async () => {
              const n = await window.api.files.exportAll()
              if (n !== null) toast('success', `Exported ${n} meeting${n === 1 ? '' : 's'}`)
            }}
          >
            Export…
          </Button>
        </div>
      </Section>
      <div className="text-[12px] text-faint">NitroScribe {info?.version} · API keys are encrypted with your computer account.</div>
    </>
  )
}

export function SettingsModal() {
  const open = useApp((s) => s.settingsOpen)
  const tab = useApp((s) => s.settingsTab)
  const view = useApp((s) => s.view)
  const { closeSettings, openSettings } = useApp.getState()
  return (
    <Modal open={open && !!view} onClose={closeSettings} className="flex h-[min(760px,92vh)] w-[min(980px,94vw)]">
      <nav className="w-56 flex-none border-r border-edge bg-side p-3">
        <div className="px-2.5 pb-3 pt-1 serif text-[20px]">Settings</div>
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => openSettings(id)}
            className={clsx('flex h-8 w-full items-center gap-2.5 rounded-lg px-2.5 text-[13.5px]', tab === id ? 'bg-active font-medium text-ink' : 'text-muted hover:bg-hover hover:text-ink')}
          >
            <Icon className="size-4" /> {label}
          </button>
        ))}
      </nav>
      <div className="relative min-w-0 flex-1 overflow-y-auto px-9 py-7">
        <CloseButton onClick={closeSettings} className="absolute right-4 top-4" />
        {view && (
          <>
            {tab === 'general' && <GeneralTab />}
            {tab === 'transcription' && <TranscriptionTab />}
            {tab === 'ai' && <AiTab />}
            {tab === 'templates' && <TemplatesTab />}
            {tab === 'calendar' && <CalendarTab />}
            {tab === 'data' && <DataTab />}
          </>
        )}
      </div>
    </Modal>
  )
}
