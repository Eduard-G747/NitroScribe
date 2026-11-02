import { appendFile, mkdirSync, statSync, rmSync } from 'node:fs'
import { join } from 'node:path'

let file: string | null = null

/** Appends timestamped lines to logs/nitroscribe.log (rotated at 5 MB). */
export function initLog(dir: string): void {
  mkdirSync(dir, { recursive: true })
  file = join(dir, 'nitroscribe.log')
  try {
    if (statSync(file).size > 5_000_000) rmSync(file)
  } catch {
    /* no log yet */
  }
}

export function log(...parts: unknown[]): void {
  const line = `${new Date().toISOString()} ${parts.map((p) => (p instanceof Error ? p.stack ?? p.message : typeof p === 'string' ? p : JSON.stringify(p))).join(' ')}\n`
  if (!file) return
  appendFile(file, line, () => undefined)
}
