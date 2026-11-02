import { describe, expect, it } from 'vitest'
import { readNdjson, readSse } from '../src/main/ai/stream'

function body(chunks: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder()
  return new ReadableStream({
    start(c) {
      chunks.forEach((s) => c.enqueue(enc.encode(s)))
      c.close()
    }
  })
}

describe('readSse', () => {
  it('parses events split across arbitrary chunk boundaries', async () => {
    const events = []
    for await (const e of readSse(body(['event: a\nda', 'ta: {"x":1}\n', '\n: comment\n\ndata: li', 'ne1\ndata: line2\r\n\r\ndata: [DONE]']))) events.push(e)
    expect(events).toEqual([{ event: 'a', data: '{"x":1}' }, { event: undefined, data: 'line1\nline2' }, { event: undefined, data: '[DONE]' }])
  })

  it('handles multi-byte characters split between chunks', async () => {
    const bytes = new TextEncoder().encode('data: olá 👋\n\n')
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(bytes.slice(0, 9))
        c.enqueue(bytes.slice(9))
        c.close()
      }
    })
    const events = []
    for await (const e of readSse(stream)) events.push(e.data)
    expect(events).toEqual(['olá 👋'])
  })
})

describe('readNdjson', () => {
  it('parses newline-delimited JSON', async () => {
    const out = []
    for await (const o of readNdjson(body(['{"a":1}\n{"a"', ':2}\n', '{"a":3}']))) out.push(o)
    expect(out).toEqual([{ a: 1 }, { a: 2 }, { a: 3 }])
  })
})
