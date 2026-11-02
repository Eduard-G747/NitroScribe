import { providerPreset } from '@shared/providers'
import type { LlmProviderId } from '@shared/types'
import { readNdjson, readSse } from './stream'

export interface LlmMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface LlmRequest {
  provider: LlmProviderId
  baseUrl: string
  model: string
  apiKey?: string
  system: string
  messages: LlmMessage[]
  maxTokens?: number
  signal?: AbortSignal
  onDelta?: (text: string) => void
}

const trimSlash = (url: string) => url.trim().replace(/\/+$/, '')

async function errorFrom(res: Response): Promise<Error> {
  let detail = ''
  try {
    const text = await res.text()
    try {
      const j = JSON.parse(text)
      detail = j?.error?.message ?? (typeof j?.error === 'string' ? j.error : '') ?? j?.message ?? text
      if (!detail) detail = text
    } catch {
      detail = text
    }
  } catch {
    /* ignore */
  }
  const hint = res.status === 401 || res.status === 403 ? ' (check your API key)' : res.status === 404 ? ' (check the model name and base URL)' : ''
  return new Error(`${res.status} ${res.statusText}${hint}${detail ? `: ${String(detail).slice(0, 300)}` : ''}`)
}

/** Hides <think>…</think> reasoning blocks that some models emit inline. */
function thinkFilter(onDelta?: (t: string) => void) {
  let inThink = false
  let pending = ''
  let out = ''
  const emit = (t: string) => {
    if (!t) return
    out += t
    onDelta?.(t)
  }
  return {
    push(chunk: string) {
      pending += chunk
      for (;;) {
        if (inThink) {
          const end = pending.indexOf('</think>')
          if (end === -1) {
            pending = pending.slice(-8)
            return
          }
          pending = pending.slice(end + 8).replace(/^\s+/, '')
          inThink = false
        } else {
          const start = pending.indexOf('<think>')
          if (start === -1) {
            // Hold back a possible partial "<think" tag at the end.
            const safe = pending.length - 7
            if (safe > 0) {
              emit(pending.slice(0, safe))
              pending = pending.slice(safe)
            }
            return
          }
          emit(pending.slice(0, start))
          pending = pending.slice(start + 7)
          inThink = true
        }
      }
    },
    end(): string {
      if (!inThink) emit(pending)
      pending = ''
      return out
    }
  }
}

export async function streamChat(req: LlmRequest): Promise<string> {
  const preset = providerPreset(req.provider)
  if (!req.baseUrl?.trim()) throw new Error('No API base URL is configured for this provider (Settings → AI).')
  if (!req.model?.trim()) throw new Error('No model is selected (Settings → AI).')
  if (preset.needsKey && !req.apiKey) throw new Error(`Add your ${preset.label} API key in Settings → AI.`)
  const filter = thinkFilter(req.onDelta)
  const push = (t: string) => filter.push(t)
  if (preset.kind === 'anthropic') await streamAnthropic(req, push)
  else if (preset.kind === 'ollama') await streamOllama(req, push)
  else await streamOpenAi(req, push)
  return filter.end()
}

async function streamOpenAi(req: LlmRequest, push: (t: string) => void) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (req.apiKey) headers.Authorization = `Bearer ${req.apiKey}`
  if (req.provider === 'openrouter') headers['X-Title'] = 'NitroScribe'
  // No max_tokens: newer OpenAI models reject it, and every provider has a sensible default.
  const body = { model: req.model.trim(), stream: true, messages: [{ role: 'system', content: req.system }, ...req.messages] }
  const res = await fetch(`${trimSlash(req.baseUrl)}/chat/completions`, { method: 'POST', headers, body: JSON.stringify(body), signal: req.signal })
  if (!res.ok || !res.body) throw await errorFrom(res)
  for await (const ev of readSse(res.body)) {
    if (ev.data === '[DONE]') break
    let json: { error?: { message?: string } | string; choices?: { delta?: { content?: unknown } }[] }
    try {
      json = JSON.parse(ev.data)
    } catch {
      continue
    }
    if (json.error) throw new Error(typeof json.error === 'string' ? json.error : (json.error.message ?? 'Provider error'))
    const delta = json.choices?.[0]?.delta?.content
    if (typeof delta === 'string' && delta) push(delta)
  }
}

async function streamAnthropic(req: LlmRequest, push: (t: string) => void) {
  const res = await fetch(`${trimSlash(req.baseUrl)}/v1/messages`, {
    method: 'POST',
    signal: req.signal,
    headers: { 'Content-Type': 'application/json', 'x-api-key': req.apiKey ?? '', 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: req.model.trim(),
      max_tokens: req.maxTokens ?? 8192,
      system: req.system,
      messages: req.messages,
      stream: true
    })
  })
  if (!res.ok || !res.body) throw await errorFrom(res)
  for await (const ev of readSse(res.body)) {
    let json: { type?: string; delta?: { type?: string; text?: string }; error?: { message?: string } }
    try {
      json = JSON.parse(ev.data)
    } catch {
      continue
    }
    if (json.type === 'content_block_delta' && json.delta?.type === 'text_delta' && json.delta.text) push(json.delta.text)
    else if (json.type === 'error') throw new Error(json.error?.message ?? 'Anthropic error')
    else if (json.type === 'message_stop') break
  }
}

async function streamOllama(req: LlmRequest, push: (t: string) => void) {
  const chars = req.system.length + req.messages.reduce((n, m) => n + m.content.length, 0)
  // Ollama reloads the model whenever num_ctx changes, so sizes snap to a few fixed steps.
  const needed = Math.ceil(chars / 3) + 4096
  const numCtx = [8192, 16384, 32768, 65536, 131072].find((n) => n >= needed) ?? 131072
  const options: Record<string, number> = { num_ctx: numCtx }
  if (req.maxTokens) options.num_predict = req.maxTokens
  const res = await fetch(`${trimSlash(req.baseUrl)}/api/chat`, {
    method: 'POST',
    signal: req.signal,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: req.model.trim(), stream: true, messages: [{ role: 'system', content: req.system }, ...req.messages], options })
  })
  if (!res.ok || !res.body) throw await errorFrom(res)
  for await (const chunk of readNdjson<{ message?: { content?: string }; error?: string; done?: boolean }>(res.body)) {
    if (chunk.error) {
      const crashed = /forcibly closed|unexpectedly stopped|out of memory|cuda error|runner process/i.test(chunk.error)
      throw new Error(
        crashed ? 'The local model stopped unexpectedly, usually because the GPU ran out of memory. Try again, or pick a smaller model in Settings → AI model.' : chunk.error
      )
    }
    if (chunk.message?.content) push(chunk.message.content)
    if (chunk.done) break
  }
}

const NON_CHAT = /embed|whisper|tts|dall-e|moderation|davinci|babbage|transcribe|realtime|audio|image|search|computer-use|rerank|guard/i

export async function listModels(provider: LlmProviderId, baseUrl: string, apiKey?: string): Promise<string[]> {
  const kind = providerPreset(provider).kind
  const base = trimSlash(baseUrl)
  if (!base) throw new Error('Set the base URL first.')
  const signal = AbortSignal.timeout(15_000)
  let res: Response
  if (kind === 'anthropic') {
    res = await fetch(`${base}/v1/models?limit=100`, { signal, headers: { 'x-api-key': apiKey ?? '', 'anthropic-version': '2023-06-01' } })
  } else if (kind === 'ollama') {
    res = await fetch(`${base}/api/tags`, { signal })
  } else {
    res = await fetch(`${base}/models`, { signal, headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {} })
  }
  if (!res.ok) throw await errorFrom(res)
  const json = (await res.json()) as { data?: { id?: string; name?: string }[]; models?: { id?: string; name?: string }[] }
  const ids = (json.data ?? json.models ?? []).map((m) => m.id ?? m.name ?? '').map((id) => id.replace(/^models\//, ''))
  return [...new Set(ids.filter((id) => id && !NON_CHAT.test(id)))].sort((a, b) => a.localeCompare(b))
}
