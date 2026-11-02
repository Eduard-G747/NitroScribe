import { EventEmitter } from 'node:events'
import { randomUUID } from 'node:crypto'
import { isUntitled } from '@shared/format'
import { hostOf, isLocalUrl } from '@shared/net'
import { findTemplate } from '@shared/templates'
import type { AiStreamEvent, ChatRequest, EnhanceRequest, LlmProviderId } from '@shared/types'
import type { MeetingStore } from '../store/meetings'
import type { SettingsStore } from '../store/settings'
import { log } from '../util/log'
import { listModels, streamChat, type LlmMessage } from './llm'
import { cleanMarkdown, cleanTitle, enhancePrompt, globalChatSystem, meetingChatSystem, parseJsonObject, speakerIdPrompt, titlePrompt } from './prompts'
import { buildMeetingRecords } from './retrieval'

export class AiService extends EventEmitter {
  private controllers = new Map<string, AbortController>()

  constructor(
    private meetings: MeetingStore,
    private settings: SettingsStore
  ) {
    super()
  }

  /** Provider config for a request. In Local-only mode, refuses anything that is not on this PC or the local network. */
  private llm(provider?: LlmProviderId) {
    const s = this.settings.get()
    const id = provider ?? s.ai.provider
    const cfg = s.ai.providers[id]
    if (s.privacy.localOnly && !isLocalUrl(cfg.baseUrl)) {
      throw new Error(
        `Local-only mode is on, so NitroScribe won't send meeting data to ${hostOf(cfg.baseUrl)}. Use a model on this PC (Ollama or LM Studio), or turn off Local-only mode in Settings → Privacy.`
      )
    }
    return { provider: id, baseUrl: cfg.baseUrl, model: cfg.model, apiKey: this.settings.getKey(id) }
  }

  private send(ev: AiStreamEvent) {
    this.emit('stream', ev)
  }

  private run(work: (signal: AbortSignal, onDelta: (t: string) => void) => Promise<string>, onDone?: (text: string) => Promise<void>): string {
    const requestId = randomUUID()
    const ctrl = new AbortController()
    this.controllers.set(requestId, ctrl)
    let partial = ''
    work(ctrl.signal, (delta) => {
      partial += delta
      this.send({ requestId, delta })
    })
      .then(async (text) => {
        await onDone?.(text)
        this.send({ requestId, done: true, text })
      })
      .catch((err: Error) => {
        if (!ctrl.signal.aborted) log(`AI request failed (${this.settings.get().ai.provider}): ${err.message}`)
        this.send({ requestId, done: true, error: ctrl.signal.aborted ? 'Stopped' : err.message, text: partial })
      })
      .finally(() => this.controllers.delete(requestId))
    return requestId
  }

  cancel(requestId: string): void {
    this.controllers.get(requestId)?.abort()
  }

  /**
   * Lets the model put names on "Speaker N" labels from what was said (introductions, people addressing
   * each other). Never overrides names the user typed or voices NitroScribe recognized.
   */
  async identifySpeakers(meetingId: string, signal?: AbortSignal): Promise<number> {
    const meeting = await this.meetings.get(meetingId)
    if (!meeting) throw new Error('Meeting not found')
    const settings = this.settings.get()
    const prompt = speakerIdPrompt(meeting, settings)
    if (!prompt) return 0
    const reply = await streamChat({ ...this.llm(), system: prompt.system, messages: [{ role: 'user', content: prompt.user }], signal })
    const parsed = parseJsonObject(reply)
    if (!parsed) return 0
    const fresh = await this.meetings.get(meetingId)
    if (!fresh) return 0
    const speakers = { ...(fresh.speakers ?? {}) }
    const me = settings.userName.trim().toLowerCase()
    const used = new Set(Object.values(speakers).filter((s) => s.nameSource === 'manual' || s.nameSource === 'voice').map((s) => s.name?.toLowerCase()))
    let named = 0
    for (const [label, value] of Object.entries(parsed)) {
      const id = prompt.labels.get(label)
      const name = typeof value === 'string' ? value.trim().slice(0, 60) : ''
      if (!id || !name || name.toLowerCase() === me || used.has(name.toLowerCase())) continue
      const existing = speakers[id]
      if (existing?.nameSource === 'manual' || existing?.nameSource === 'voice') continue
      speakers[id] = { ...existing, id, name, nameSource: 'ai' }
      used.add(name.toLowerCase())
      named++
    }
    if (named) {
      await this.meetings.update(meetingId, { speakers })
      this.emit('speakersNamed', meetingId, speakers)
    }
    log(`speaker identification: ${named} of ${prompt.labels.size} speakers named`)
    return named
  }

  enhance(req: EnhanceRequest): string {
    log(`generating notes for ${req.meetingId} with ${this.settings.get().ai.provider} (template ${req.templateId})`)
    return this.run(
      async (signal, onDelta) => {
        let meeting = await this.meetings.get(req.meetingId)
        if (!meeting) throw new Error('Meeting not found')
        if (!meeting.transcript.length && !meeting.notesMarkdown.trim()) {
          throw new Error('Nothing to work with yet. Record the meeting or write some notes first.')
        }
        const settings = this.settings.get()
        if (settings.ai.autoNameSpeakers && meeting.transcript.some((s) => s.speakerId && !meeting!.speakers?.[s.speakerId]?.name)) {
          await this.identifySpeakers(req.meetingId, signal).catch((err: Error) => log(`speaker identification failed: ${err.message}`))
          meeting = (await this.meetings.get(req.meetingId)) ?? meeting
        }
        const { system, user } = enhancePrompt(meeting, findTemplate(req.templateId, settings.customTemplates), settings)
        return cleanMarkdown(await streamChat({ ...this.llm(), system, messages: [{ role: 'user', content: user }], signal, onDelta }))
      },
      async (markdown) => {
        await this.meetings.update(req.meetingId, {
          enhancedMarkdown: markdown,
          enhancedHtml: '',
          enhancedAt: new Date().toISOString(),
          templateId: req.templateId
        })
        void this.autoTitle(req.meetingId)
      }
    )
  }

  private async autoTitle(meetingId: string) {
    try {
      const meeting = await this.meetings.get(meetingId)
      if (!meeting || !isUntitled(meeting.title)) return
      const { system, user } = titlePrompt(meeting, this.settings.get())
      const title = cleanTitle(
        await streamChat({ ...this.llm(), system, messages: [{ role: 'user', content: user }], maxTokens: 400, signal: AbortSignal.timeout(90_000) })
      )
      const fresh = await this.meetings.get(meetingId)
      if (title && fresh && isUntitled(fresh.title)) await this.meetings.update(meetingId, { title })
    } catch (err) {
      log(`title generation skipped: ${(err as Error).message}`)
    }
  }

  chat(req: ChatRequest): string {
    return this.run(async (signal, onDelta) => {
      const settings = this.settings.get()
      const messages: LlmMessage[] = req.messages.filter((m) => m.content.trim())
      let system: string
      if (req.meetingId) {
        const meeting = await this.meetings.get(req.meetingId)
        if (!meeting) throw new Error('Meeting not found')
        system = meetingChatSystem(meeting, settings)
      } else {
        const question = [...messages].reverse().find((m) => m.role === 'user')?.content ?? ''
        system = globalChatSystem(await buildMeetingRecords(this.meetings, question, settings.userName), settings)
      }
      return streamChat({ ...this.llm(), system, messages, signal, onDelta })
    })
  }

  async models(provider: LlmProviderId): Promise<string[]> {
    const { baseUrl, apiKey } = this.llm(provider)
    return listModels(provider, baseUrl, apiKey)
  }

  async test(provider: LlmProviderId): Promise<{ ok: boolean; message: string }> {
    try {
      const reply = await streamChat({
        ...this.llm(provider),
        system: 'You are a connection test.',
        messages: [{ role: 'user', content: 'Reply with exactly: OK' }],
        maxTokens: 400,
        signal: AbortSignal.timeout(60_000)
      })
      return { ok: true, message: reply.trim() ? `Connected. The model replied: "${reply.trim().slice(0, 60)}"` : 'Connected.' }
    } catch (err) {
      return { ok: false, message: (err as Error).message }
    }
  }
}
