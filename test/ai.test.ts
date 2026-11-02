import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createServer, type IncomingMessage, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { listModels, streamChat } from '../src/main/ai/llm'
import { cleanMarkdown, cleanTitle, enhancePrompt, parseJsonObject, speakerIdPrompt, transcriptForPrompt } from '../src/main/ai/prompts'
import { excerptTranscript, timeRange } from '../src/main/ai/retrieval'
import { defaultSettings } from '@shared/defaults'
import { BUILT_IN_TEMPLATES } from '@shared/templates'
import type { Meeting } from '@shared/types'

let server: Server
let base = ''
const requests: { url: string; headers: IncomingMessage['headers']; body: Record<string, unknown> }[] = []

beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = ''
    req.on('data', (c) => (raw += c))
    req.on('end', () => {
      requests.push({ url: req.url!, headers: req.headers, body: raw ? JSON.parse(raw) : {} })
      if (req.url === '/v1/chat/completions') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' })
        for (const t of ['<think>secret', ' reasoning</think>Hel', 'lo', ' world']) res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: t } }] })}\n\n`)
        res.end('data: [DONE]\n\n')
      } else if (req.url === '/bad/chat/completions') {
        res.writeHead(401, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: { message: 'Incorrect API key provided' } }))
      } else if (req.url === '/v1/messages') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' })
        res.write('event: message_start\ndata: {"type":"message_start"}\n\n')
        res.write('event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Bon"}}\n\n')
        res.write('event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"jour"}}\n\n')
        res.end('event: message_stop\ndata: {"type":"message_stop"}\n\n')
      } else if (req.url === '/api/chat') {
        res.writeHead(200, { 'Content-Type': 'application/x-ndjson' })
        res.write('{"message":{"content":"Ol"},"done":false}\n')
        res.end('{"message":{"content":"á"},"done":true}\n')
      } else if (req.url === '/v1/models') {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ data: [{ id: 'gpt-x' }, { id: 'text-embedding-3' }, { id: 'models/gemini-y' }] }))
      } else {
        res.writeHead(404)
        res.end()
      }
    })
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
afterAll(() => server.close())

describe('streamChat', () => {
  it('streams OpenAI-compatible responses and hides <think> blocks', async () => {
    const deltas: string[] = []
    const text = await streamChat({ provider: 'openai', baseUrl: `${base}/v1/`, model: 'gpt-x', apiKey: 'k', system: 'S', messages: [{ role: 'user', content: 'Q' }], onDelta: (d) => deltas.push(d) })
    expect(text).toBe('Hello world')
    expect(deltas.join('')).toBe('Hello world')
    const req = requests.find((r) => r.url === '/v1/chat/completions')!
    expect(req.headers.authorization).toBe('Bearer k')
    expect(req.body).toMatchObject({ model: 'gpt-x', stream: true, messages: [{ role: 'system', content: 'S' }, { role: 'user', content: 'Q' }] })
    expect(req.body).not.toHaveProperty('max_tokens')
  })

  it('streams Anthropic and Ollama formats', async () => {
    expect(await streamChat({ provider: 'anthropic', baseUrl: base, model: 'claude', apiKey: 'a', system: 'S', messages: [{ role: 'user', content: 'Q' }] })).toBe('Bonjour')
    const anthropic = requests.find((r) => r.url === '/v1/messages')!
    expect(anthropic.headers['x-api-key']).toBe('a')
    expect(anthropic.body).toMatchObject({ system: 'S', max_tokens: 8192 })
    expect(await streamChat({ provider: 'ollama', baseUrl: base, model: 'llama', system: 'S', messages: [{ role: 'user', content: 'Q' }] })).toBe('Olá')
    expect((requests.find((r) => r.url === '/api/chat')!.body.options as { num_ctx: number }).num_ctx).toBeGreaterThanOrEqual(8192)
  })

  it('reports helpful errors', async () => {
    await expect(streamChat({ provider: 'custom', baseUrl: `${base}/bad`, model: 'm', system: '', messages: [] })).rejects.toThrow(/401.*check your API key.*Incorrect API key/)
    await expect(streamChat({ provider: 'openai', baseUrl: base, model: 'm', system: '', messages: [] })).rejects.toThrow(/API key/)
    await expect(streamChat({ provider: 'ollama', baseUrl: base, model: '', system: '', messages: [] })).rejects.toThrow(/No model/)
  })

  it('lists chat models only', async () => {
    expect(await listModels('openai', `${base}/v1`, 'k')).toEqual(['gemini-y', 'gpt-x'])
  })
})

describe('prompts', () => {
  const meeting: Meeting = {
    id: 'm',
    title: '',
    createdAt: '2026-10-30T15:00:00Z',
    updatedAt: '2026-10-30T15:00:00Z',
    durationMs: 120_000,
    notesHtml: '',
    notesMarkdown: '- budget?',
    transcript: [
      { id: '1', speaker: 'me', text: 'What is the budget?', start: 0, end: 2000 },
      { id: '2', speaker: 'them', text: 'About forty thousand.', start: 2500, end: 4000 },
      { id: '3', speaker: 'them', text: 'For the whole quarter.', start: 4200, end: 6000 }
    ],
    chat: [],
    attendees: ['Ana']
  }

  it('builds the enhance prompt with notes, template and merged transcript', () => {
    const { system, user } = enhancePrompt(meeting, BUILT_IN_TEMPLATES[0], { ...defaultSettings(), userName: 'Eduardo' })
    expect(system).toContain('"Eduardo (me)" is the user')
    expect(user).toContain('<my_notes>\n- budget?\n</my_notes>')
    expect(user).toContain('[0:00] Eduardo (me): What is the budget?')
    expect(user).toContain('[0:02] Them: About forty thousand. For the whole quarter.')
    expect(user).toContain('Attendees: Ana')
  })

  it('truncates very long transcripts in the middle', () => {
    const long = { transcript: Array.from({ length: 2000 }, (_, i) => ({ id: `${i}`, speaker: (i % 2 ? 'me' : 'them') as 'me' | 'them', text: 'word '.repeat(50), start: i * 10_000, end: i * 10_000 + 5000 })) }
    const t = transcriptForPrompt(long, 50_000)
    expect(t.length).toBeLessThan(51_000)
    expect(t).toContain('omitted for length')
  })

  it('asks the model to name voice-separated speakers and parses its JSON', () => {
    const m: Meeting = {
      ...meeting,
      transcript: [
        { id: 'a', speaker: 'me', text: 'Hi Sarah, hi Tom.', start: 0, end: 1000 },
        { id: 'b', speaker: 'them', speakerId: 's1', text: 'Hey! Sarah here.', start: 1500, end: 2500 },
        { id: 'c', speaker: 'them', speakerId: 's2', text: 'Tom here.', start: 3000, end: 4000 },
        { id: 'd', speaker: 'them', speakerId: 's3', text: 'And me.', start: 4500, end: 5000 }
      ],
      speakers: { s3: { id: 's3', name: 'Ana', nameSource: 'manual' } }
    }
    const p = speakerIdPrompt(m, { ...defaultSettings(), userName: 'Eduardo' })!
    expect([...p.labels.entries()]).toEqual([
      ['Speaker 1', 's1'],
      ['Speaker 2', 's2']
    ])
    expect(p.user).toContain('[0:01] Speaker 1: Hey! Sarah here.')
    expect(p.user).toContain('[0:04] Ana: And me.')
    expect(parseJsonObject('Sure:\n```json\n{"Speaker 1": "Sarah", "Speaker 2": null}\n```')).toEqual({ 'Speaker 1': 'Sarah', 'Speaker 2': null })
    expect(parseJsonObject('no json')).toBeNull()
  })

  it('cleans model output', () => {
    expect(cleanMarkdown('```markdown\n# Title\n### A\n- b\n```')).toBe('### A\n- b')
    expect(cleanTitle('Title: "Q3 Budget Review."\nextra')).toBe('Q3 Budget Review')
  })
})

describe('retrieval', () => {
  it('understands relative dates in several languages', () => {
    const now = new Date(2026, 9, 29, 12) // Thursday
    expect(timeRange('what did we decide last week?', now)).toEqual({ from: new Date(2026, 9, 19).getTime(), to: new Date(2026, 9, 26).getTime() })
    expect(timeRange('¿qué pasó hoy?', now)).toEqual({ from: new Date(2026, 9, 29).getTime(), to: new Date(2026, 9, 30).getTime() })
    expect(timeRange('o que foi dito ontem', now)?.from).toBe(new Date(2026, 9, 28).getTime())
    expect(timeRange('pricing decisions', now)).toBeNull()
  })

  it('excerpts relevant transcript turns', () => {
    const m = {
      transcript: Array.from({ length: 60 }, (_, i) => ({ id: `${i}`, speaker: (i % 2 ? 'me' : 'them') as 'me' | 'them', text: i === 40 ? 'the pricing change ships monday' : `filler sentence number ${i} `.repeat(4), start: i * 10_000, end: i * 10_000 + 5000 }))
    } as Meeting
    const ex = excerptTranscript(m, ['pricing'], 600)
    expect(ex).toContain('pricing change ships monday')
    expect(ex.length).toBeLessThanOrEqual(700)
  })
})
