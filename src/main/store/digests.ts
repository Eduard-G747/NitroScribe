import { join } from 'node:path'
import type { Digest } from '@shared/types'
import { readJson, writeFileAtomic } from '../util/fsx'

/** Weekly reviews written by the AI, kept so they aren't regenerated every time. */
export class DigestStore {
  constructor(private dir: string) {}

  private get file() {
    return join(this.dir, 'digests.json')
  }

  async get(week: string): Promise<Digest | null> {
    return (await readJson<Record<string, Digest>>(this.file))?.[week] ?? null
  }

  async set(digest: Digest): Promise<void> {
    const all = (await readJson<Record<string, Digest>>(this.file)) ?? {}
    all[digest.week] = digest
    await writeFileAtomic(this.file, JSON.stringify(all))
  }
}
