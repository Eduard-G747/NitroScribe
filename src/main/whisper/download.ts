import { createHash } from 'node:crypto'
import { createWriteStream, promises as fs } from 'node:fs'
import { once } from 'node:events'
import type { RemoteFile } from '@shared/whisperModels'

export interface DownloadOptions {
  signal?: AbortSignal
  onProgress?: (received: number, total: number) => void
}

/** Streams a file to disk, verifying its size and SHA-256 before moving it into place. */
export async function downloadVerified(remote: RemoteFile, dest: string, opts: DownloadOptions = {}): Promise<void> {
  const part = `${dest}.part`
  const res = await fetch(remote.url, { signal: opts.signal, redirect: 'follow' })
  if (!res.ok || !res.body) throw new Error(`Download of ${remote.file} failed: HTTP ${res.status}`)
  const total = Number(res.headers.get('content-length')) || remote.size
  const hash = createHash('sha256')
  const out = createWriteStream(part)
  let received = 0
  let lastReport = 0
  try {
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      hash.update(chunk)
      received += chunk.length
      if (!out.write(chunk)) await once(out, 'drain')
      const now = Date.now()
      if (now - lastReport > 250) {
        lastReport = now
        opts.onProgress?.(received, total)
      }
    }
    await new Promise<void>((resolve, reject) => out.end((err?: Error | null) => (err ? reject(err) : resolve())))
  } catch (err) {
    out.destroy()
    await fs.rm(part, { force: true })
    throw err
  }
  opts.onProgress?.(received, total)
  const digest = hash.digest('hex')
  if (received !== remote.size || digest !== remote.sha256) {
    await fs.rm(part, { force: true })
    throw new Error(`Downloaded ${remote.file} failed verification (size ${received}, sha256 ${digest.slice(0, 12)}…)`)
  }
  await fs.rm(dest, { force: true })
  await fs.rename(part, dest)
}
