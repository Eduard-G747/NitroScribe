import { promises as fs, renameSync, writeFileSync, rmSync } from 'node:fs'
import { randomBytes } from 'node:crypto'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Writes via a temp file + rename so a crash never leaves a half-written file. Retries transient Windows locks. */
export async function writeFileAtomic(path: string, data: string): Promise<void> {
  const tmp = `${path}.${randomBytes(4).toString('hex')}.tmp`
  await fs.writeFile(tmp, data, 'utf8')
  for (let attempt = 0; ; attempt++) {
    try {
      await fs.rename(tmp, path)
      return
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      if (attempt >= 8 || !['EPERM', 'EBUSY', 'EACCES'].includes(code ?? '')) {
        await fs.rm(tmp, { force: true })
        throw err
      }
      await sleep(25 * (attempt + 1))
    }
  }
}

export function writeFileAtomicSync(path: string, data: string): void {
  const tmp = `${path}.${randomBytes(4).toString('hex')}.tmp`
  writeFileSync(tmp, data, 'utf8')
  try {
    renameSync(tmp, path)
  } catch (err) {
    rmSync(tmp, { force: true })
    throw err
  }
}

export async function readJson<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(path, 'utf8')) as T
  } catch {
    return null
  }
}
