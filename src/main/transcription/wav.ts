export const SAMPLE_RATE = 16000

/** Encodes mono 16-bit PCM samples as a WAV file. */
export function encodeWav(samples: Int16Array, sampleRate = SAMPLE_RATE): Buffer {
  const dataBytes = samples.length * 2
  const buf = Buffer.alloc(44 + dataBytes)
  buf.write('RIFF', 0)
  buf.writeUInt32LE(36 + dataBytes, 4)
  buf.write('WAVE', 8)
  buf.write('fmt ', 12)
  buf.writeUInt32LE(16, 16)
  buf.writeUInt16LE(1, 20)
  buf.writeUInt16LE(1, 22)
  buf.writeUInt32LE(sampleRate, 24)
  buf.writeUInt32LE(sampleRate * 2, 28)
  buf.writeUInt16LE(2, 32)
  buf.writeUInt16LE(16, 34)
  buf.write('data', 36)
  buf.writeUInt32LE(dataBytes, 40)
  Buffer.from(samples.buffer, samples.byteOffset, dataBytes).copy(buf, 44)
  return buf
}

/** Decodes a 16-bit PCM WAV (mono or stereo) into per-channel Int16 arrays. Used by tests and tools. */
export function decodeWav(buf: Buffer): { sampleRate: number; channels: Int16Array[] } {
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') throw new Error('Not a WAV file')
  let offset = 12
  let fmt: { channels: number; sampleRate: number; bits: number } | null = null
  while (offset + 8 <= buf.length) {
    const id = buf.toString('ascii', offset, offset + 4)
    const size = buf.readUInt32LE(offset + 4)
    const body = offset + 8
    if (id === 'fmt ') {
      fmt = { channels: buf.readUInt16LE(body + 2), sampleRate: buf.readUInt32LE(body + 4), bits: buf.readUInt16LE(body + 14) }
    } else if (id === 'data' && fmt) {
      if (fmt.bits !== 16) throw new Error('Only 16-bit WAV is supported')
      const frames = Math.floor(Math.min(size, buf.length - body) / (2 * fmt.channels))
      const channels = Array.from({ length: fmt.channels }, () => new Int16Array(frames))
      for (let i = 0; i < frames; i++) {
        for (let c = 0; c < fmt.channels; c++) channels[c][i] = buf.readInt16LE(body + (i * fmt.channels + c) * 2)
      }
      return { sampleRate: fmt.sampleRate, channels }
    }
    offset = body + size + (size % 2)
  }
  throw new Error('WAV data chunk not found')
}
