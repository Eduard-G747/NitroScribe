import { inflateRawSync } from 'node:zlib'

const MAX_XML_BYTES = 64 * 1024 * 1024

/** Reads one file out of a ZIP archive (enough for .docx; no ZIP64). */
export function readZipEntry(buf: Buffer, name: string): Buffer | null {
  let eocd = -1
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) return null
  const count = buf.readUInt16LE(eocd + 10)
  let p = buf.readUInt32LE(eocd + 16)
  for (let n = 0; n < count && p + 46 <= buf.length; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) return null
    const method = buf.readUInt16LE(p + 10)
    const size = buf.readUInt32LE(p + 20)
    const nameLen = buf.readUInt16LE(p + 28)
    const extraLen = buf.readUInt16LE(p + 30)
    const commentLen = buf.readUInt16LE(p + 32)
    const local = buf.readUInt32LE(p + 42)
    if (buf.toString('utf8', p + 46, p + 46 + nameLen) === name) {
      if (local + 30 > buf.length || buf.readUInt32LE(local) !== 0x04034b50) return null
      const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28)
      const data = buf.subarray(start, start + size)
      if (method === 0) return Buffer.from(data)
      if (method === 8) return inflateRawSync(data, { maxOutputLength: MAX_XML_BYTES })
      return null
    }
    p += 46 + nameLen + extraLen + commentLen
  }
  return null
}

const decode = (s: string) =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&')

/** Plain text of a Word document, paragraphs separated by blank lines (Teams transcripts download as .docx). */
export function docxToText(buf: Buffer): string {
  const xml = readZipEntry(buf, 'word/document.xml')?.toString('utf8')
  if (!xml) throw new Error('This Word file could not be read. Try saving it as .txt first.')
  return xml
    .split(/<\/w:p>/)
    .map((p) =>
      decode(
        p
          .replace(/<w:tab\b[^>]*\/>/g, '\t')
          .replace(/<w:(?:br|cr)\b[^>]*\/>/g, '\n')
          .replace(/<[^>]+>/g, '')
      ).trim()
    )
    .filter(Boolean)
    .join('\n\n')
}
