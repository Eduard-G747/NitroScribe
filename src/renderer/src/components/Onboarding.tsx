import clsx from 'clsx'
import { Check, Cpu } from 'lucide-react'
import logo from '../assets/logo.png'
import { useState } from 'react'
import { WHISPER_BINARIES, whisperModel } from '@shared/whisperModels'
import { aiReady, useApp } from '../lib/store'
import { AiTab, formatBytes } from './SettingsModal'
import { Button, Modal, TextInput } from './ui'

const STEPS = ['Welcome', 'Transcription', 'AI notes'] as const

function TranscriptionStep() {
  const whisper = useApp((s) => s.whisper)
  const model = useApp((s) => s.view!.settings.transcription.model)
  const toast = useApp((s) => s.toast)
  const info = whisperModel(model)
  const ready = !!whisper?.binary && whisper.installedModels.includes(model)
  const total = (whisper?.binary ? 0 : WHISPER_BINARIES[whisper?.gpu ? 'cuda' : 'cpu'].size) + (whisper?.installedModels.includes(model) ? 0 : info.size)
  const dl = whisper?.download
  return (
    <div>
      <h2 className="serif text-[26px]">Private, on-device transcription</h2>
      <p className="mt-2 text-[13.5px] leading-relaxed text-muted">
        NitroScribe transcribes your calls with OpenAI's Whisper ({info.label.replace(/\s*\(.*\)$/, '')} model), running entirely on this PC. Your microphone is labelled “Me” and
        your computer's audio (the people on the call) “Them”. Nothing is uploaded and no audio is stored.
      </p>
      <div className="mt-5 rounded-xl border border-edge bg-card p-4 text-[13px]">
        <div className="flex items-center gap-2">
          <Cpu className="size-4 text-accent" />
          {whisper?.gpu ? (
            <span>
              Found <span className="font-medium">{whisper.gpu.name}</span> ({Math.round(whisper.gpu.vramMb / 1024)} GB): transcription will run on the GPU.
            </span>
          ) : (
            <span>No NVIDIA GPU found: transcription will run on the CPU (pick a smaller model in Settings if it can't keep up).</span>
          )}
        </div>
        <div className="mt-4">
          {ready ? (
            <div className="flex items-center gap-2 font-medium text-accent">
              <Check className="size-4" /> Ready to transcribe
            </div>
          ) : whisper?.installing ? (
            <div>
              <div className="mb-1.5 flex justify-between text-[12.5px]">
                <span className="font-medium">{dl?.label ?? 'Preparing…'}</span>
                <span className="text-muted">{dl?.total ? `${formatBytes(dl.received)} of ${formatBytes(dl.total)}` : ''}</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-hover">
                <div className={clsx('h-full rounded-full bg-accent transition-all', !dl?.total && 'shimmer w-full')} style={dl?.total ? { width: `${(100 * dl.received) / dl.total}%` } : undefined} />
              </div>
              <div className="mt-2 text-[12px] text-muted">You can continue setting up while this downloads.</div>
            </div>
          ) : (
            <Button variant="primary" onClick={() => void window.api.whisper.install(model).catch((e: Error) => toast('error', e.message))}>
              Download speech model ({formatBytes(total)})
            </Button>
          )}
          {whisper?.error && <div className="mt-2 text-[12.5px] text-danger">{whisper.error}</div>}
        </div>
      </div>
    </div>
  )
}

export function Onboarding() {
  const view = useApp((s) => s.view)
  const update = useApp((s) => s.updateSettings)
  const [step, setStep] = useState(0)
  const [name, setName] = useState(view?.settings.userName ?? '')
  if (!view || view.settings.general.onboarded) return null
  const finish = () => void update({ userName: name.trim(), general: { onboarded: true } })

  return (
    <Modal open onClose={() => undefined} className="flex h-[min(720px,92vh)] w-[min(760px,94vw)] flex-col">
      <div className="flex flex-none items-center gap-2 border-b border-edge px-7 py-4">
        {STEPS.map((label, i) => (
          <div key={label} className="flex items-center gap-2">
            <span className={clsx('flex size-6 items-center justify-center rounded-full text-[12px] font-semibold', i <= step ? 'bg-accent text-white dark:text-[#10331f]' : 'bg-hover text-muted')}>
              {i < step ? <Check className="size-3.5" /> : i + 1}
            </span>
            <span className={clsx('text-[13px]', i === step ? 'font-medium' : 'text-muted')}>{label}</span>
            {i < STEPS.length - 1 && <span className="mx-2 h-px w-8 bg-edge" />}
          </div>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-9 py-7">
        {step === 0 && (
          <div>
            <img src={logo} alt="" className="size-14 drop-shadow-md" />
            <h2 className="mt-5 serif text-[32px]">Welcome to NitroScribe</h2>
            <p className="mt-2 max-w-[560px] text-[14px] leading-relaxed text-muted">
              Your private AI notepad for meetings. Hit <span className="font-medium text-ink">New note</span> when a call starts, jot down whatever matters, and NitroScribe turns
              your notes and the transcript (with everyone labelled by name) into great meeting notes. Everything lives on this PC, with unlimited history.
            </p>
            <div className="mt-7 max-w-sm">
              <div className="mb-1.5 text-[13.5px] font-medium">What should we call you?</div>
              <TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" autoFocus />
            </div>
          </div>
        )}
        {step === 1 && <TranscriptionStep />}
        {step === 2 && (
          <div>
            <h2 className="serif text-[26px]">Connect an AI model</h2>
            <p className="mt-2 text-[13.5px] leading-relaxed text-muted">
              Used to write your notes and answer questions. Paste a key from any provider, or pick Ollama to keep everything on this computer. You can skip this and do it later.
            </p>
            <div className="mt-2">
              <AiTab />
            </div>
          </div>
        )}
      </div>
      <div className="flex flex-none items-center justify-between border-t border-edge px-7 py-4">
        <Button variant="ghost" onClick={() => (step === 0 ? finish() : setStep(step - 1))}>
          {step === 0 ? 'Skip setup' : 'Back'}
        </Button>
        {step < STEPS.length - 1 ? (
          <Button variant="solid" onClick={() => setStep(step + 1)}>
            Continue
          </Button>
        ) : (
          <Button variant="primary" onClick={finish}>
            {aiReady(view) ? 'Start using NitroScribe' : 'Skip for now'}
          </Button>
        )}
      </div>
    </Modal>
  )
}
