import clsx from 'clsx'
import { ArrowUp, Copy, RotateCcw, Sparkles, Square } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { ChatMessage } from '@shared/types'
import { markdownToHtml } from '../lib/markdown'
import { aiReady, onAiStream, useApp } from '../lib/store'
import { Button, CloseButton, IconButton } from './ui'

const MEETING_PROMPTS = [
  'Write a follow-up email',
  'What are my action items?',
  'Summarize this in 3 bullets',
  'What did they push back on?',
  'What should I ask next time?'
]

const GLOBAL_PROMPTS = [
  'What did I commit to this week?',
  'Summarize my meetings from last week',
  'What open questions do I still have?',
  'Which topics came up most often recently?'
]

export function ChatPanel({ scope, onClose }: { scope: 'meeting' | 'global'; onClose: () => void }) {
  const current = useApp((s) => s.current)
  const globalChat = useApp((s) => s.globalChat)
  const view = useApp((s) => s.view)
  const pendingAsk = useApp((s) => s.pendingAsk)
  const { patchCurrent, setGlobalMessages, consumeAsk, openSettings, toast } = useApp.getState()
  const meetingId = scope === 'meeting' ? (current?.id ?? null) : null
  const messages: ChatMessage[] = scope === 'meeting' ? (current?.chat ?? []) : globalChat
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState<{ requestId: string; text: string } | null>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const ready = aiReady(view)

  useEffect(() => {
    const el = scroller.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages.length, streaming?.text])

  const save = (id: string | null, chat: ChatMessage[]) => {
    if (scope === 'global') setGlobalMessages(chat)
    else if (id && useApp.getState().current?.id === id) patchCurrent({ chat })
    else if (id) void window.api.meetings.update(id, { chat })
  }

  const send = async (text: string) => {
    const q = text.trim()
    if (!q || streaming) return
    if (!ready) {
      toast('info', 'Connect an AI model to chat with your meetings.')
      openSettings('ai')
      return
    }
    setInput('')
    const history: ChatMessage[] = [...messages, { id: crypto.randomUUID(), role: 'user', content: q, createdAt: new Date().toISOString() }]
    save(meetingId, history)
    let requestId: string
    try {
      requestId = await window.api.ai.chat({ meetingId, messages: history.map(({ role, content }) => ({ role, content })) })
    } catch (err) {
      toast('error', (err as Error).message)
      return
    }
    setStreaming({ requestId, text: '' })
    onAiStream(requestId, (e) => {
      if (e.delta) setStreaming((s) => (s && s.requestId === requestId ? { ...s, text: s.text + e.delta } : s))
      if (!e.done) return
      setStreaming(null)
      const content = e.error ? `${e.text ? `${e.text}\n\n` : ''}*${e.error === 'Stopped' ? 'Stopped.' : `Error: ${e.error}`}*` : (e.text ?? '')
      save(meetingId, [...history, { id: crypto.randomUUID(), role: 'assistant', content, createdAt: new Date().toISOString(), error: !!e.error && e.error !== 'Stopped' }])
    })
  }

  useEffect(() => {
    if (pendingAsk && pendingAsk.scope === scope) {
      consumeAsk()
      void send(pendingAsk.question)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingAsk])

  const prompts = scope === 'meeting' ? MEETING_PROMPTS : GLOBAL_PROMPTS

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-12 flex-none items-center gap-1 border-b border-edge px-4">
        <Sparkles className="size-4 text-accent" />
        <div className="ml-1 min-w-0 flex-1 truncate text-[13.5px] font-semibold">
          {scope === 'meeting' ? 'Ask about this meeting' : 'Ask about all your meetings'}
        </div>
        {messages.length > 0 && (
          <IconButton label="Clear chat" onClick={() => save(meetingId, [])} disabled={!!streaming}>
            <RotateCcw className="size-4" />
          </IconButton>
        )}
        <CloseButton onClick={onClose} />
      </div>

      <div ref={scroller} className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
        {!messages.length && !streaming && (
          <div className="pt-6">
            <div className="mb-3 text-[13px] text-muted">
              {scope === 'meeting' ? 'Ask anything, or try one of these:' : 'NitroScribe searches your meeting history to answer. Try:'}
            </div>
            <div className="flex flex-col items-start gap-2">
              {prompts.map((p) => (
                <button key={p} onClick={() => void send(p)} className="rounded-full border border-edge bg-card px-3 py-1.5 text-left text-[13px] hover:bg-hover">
                  {p}
                </button>
              ))}
            </div>
            {!ready && (
              <div className="mt-6 rounded-xl border border-dashed border-edge p-4 text-[13px] text-muted">
                Chat needs an AI model.{' '}
                <button className="font-medium text-accent underline" onClick={() => openSettings('ai')}>
                  Connect one in Settings
                </button>
                .
              </div>
            )}
          </div>
        )}
        {messages.map((m) => (
          <Message key={m.id} message={m} />
        ))}
        {streaming && (
          <div className="group">
            {streaming.text ? (
              <div className="md select-text" dangerouslySetInnerHTML={{ __html: markdownToHtml(streaming.text) }} />
            ) : (
              <div className="flex gap-1 py-2">
                <span className="pulse-dot size-1.5 rounded-full bg-faint" />
                <span className="pulse-dot size-1.5 rounded-full bg-faint [animation-delay:0.2s]" />
                <span className="pulse-dot size-1.5 rounded-full bg-faint [animation-delay:0.4s]" />
              </div>
            )}
          </div>
        )}
      </div>

      <div className="flex-none border-t border-edge p-3">
        <div className="flex items-end gap-2 rounded-xl border border-edge bg-card p-1.5 focus-within:border-accent/50 focus-within:ring-3 focus-within:ring-accent/10">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                void send(input)
              }
            }}
            rows={Math.min(5, Math.max(1, input.split('\n').length))}
            placeholder={scope === 'meeting' ? 'Ask about this meeting…' : 'Ask about your meetings…'}
            className="max-h-32 min-h-8 flex-1 resize-none bg-transparent px-2 py-1.5 text-[13.5px] outline-none placeholder:text-faint"
          />
          {streaming ? (
            <Button size="sm" variant="secondary" onClick={() => void window.api.ai.cancel(streaming.requestId)}>
              <Square className="size-3 fill-current" />
            </Button>
          ) : (
            <button
              disabled={!input.trim()}
              onClick={() => void send(input)}
              className="flex size-8 items-center justify-center rounded-lg bg-ink text-app transition-opacity hover:opacity-90 disabled:opacity-30"
            >
              <ArrowUp className="size-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function Message({ message }: { message: ChatMessage }) {
  const toast = useApp((s) => s.toast)
  if (message.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] select-text whitespace-pre-wrap rounded-2xl rounded-br-md bg-bubble px-3.5 py-2 text-[13.5px]">{message.content}</div>
      </div>
    )
  }
  return (
    <div className="group">
      <div className={clsx('md select-text', message.error && 'text-danger')} dangerouslySetInnerHTML={{ __html: markdownToHtml(message.content) }} />
      <div className="mt-1 opacity-0 transition-opacity group-hover:opacity-100">
        <IconButton
          label="Copy"
          className="size-7"
          onClick={() => {
            void window.api.files.copy(message.content)
            toast('success', 'Copied')
          }}
        >
          <Copy className="size-3.5" />
        </IconButton>
      </div>
    </div>
  )
}
