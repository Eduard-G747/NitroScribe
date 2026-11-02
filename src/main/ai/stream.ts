export interface SseEvent {
  event?: string
  data: string
}

async function* decodeChunks(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const decoder = new TextDecoder()
  for await (const chunk of body as unknown as AsyncIterable<Uint8Array>) yield decoder.decode(chunk, { stream: true })
  const rest = decoder.decode()
  if (rest) yield rest
}

/** Parses a text/event-stream body into events. */
export async function* readSse(body: ReadableStream<Uint8Array>): AsyncGenerator<SseEvent> {
  let buffer = ''
  const parse = (block: string): SseEvent | null => {
    let event: string | undefined
    const data: string[] = []
    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith(':')) continue
      const idx = line.indexOf(':')
      const field = idx === -1 ? line : line.slice(0, idx)
      const value = idx === -1 ? '' : line.slice(idx + 1).replace(/^ /, '')
      if (field === 'event') event = value
      else if (field === 'data') data.push(value)
    }
    return data.length ? { event, data: data.join('\n') } : null
  }
  for await (const text of decodeChunks(body)) {
    buffer += text
    let match: RegExpExecArray | null
    while ((match = /\r?\n\r?\n/.exec(buffer))) {
      const block = buffer.slice(0, match.index)
      buffer = buffer.slice(match.index + match[0].length)
      const ev = parse(block)
      if (ev) yield ev
    }
  }
  const ev = parse(buffer)
  if (ev) yield ev
}

/** Parses a newline-delimited JSON body (Ollama's native streaming format). */
export async function* readNdjson<T = unknown>(body: ReadableStream<Uint8Array>): AsyncGenerator<T> {
  let buffer = ''
  for await (const text of decodeChunks(body)) {
    buffer += text
    let nl: number
    while ((nl = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, nl).trim()
      buffer = buffer.slice(nl + 1)
      if (line) yield JSON.parse(line) as T
    }
  }
  if (buffer.trim()) yield JSON.parse(buffer) as T
}
