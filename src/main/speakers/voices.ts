import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import type { Voice } from '@shared/types'
import { readJson, writeFileAtomic } from '../util/fsx'
import { normalize } from './cluster'

/** Voices of people the user has named, so they can be recognized in later meetings. Stored locally only. */
export class VoiceLibrary {
  private voices: Voice[] = []

  constructor(private dir: string) {}

  private get file() {
    return join(this.dir, 'voices.json')
  }

  async init(): Promise<void> {
    this.voices = (await readJson<Voice[]>(this.file)) ?? []
  }

  list(): Voice[] {
    return this.voices
  }

  /** Adds a voice or blends the new sample into an existing one. */
  async remember(name: string, embedding: number[], voiceId?: string): Promise<Voice> {
    const existing = this.voices.find((v) => v.id === voiceId) ?? this.voices.find((v) => v.name.toLowerCase() === name.toLowerCase())
    const now = new Date().toISOString()
    let voice: Voice
    if (existing) {
      const w = Math.min(existing.samples, 9)
      const blended = normalize(existing.embedding.map((x, i) => x * w + (embedding[i] ?? 0)))
      voice = Object.assign(existing, { name, embedding: Array.from(blended, (x) => Math.round(x * 1e5) / 1e5), samples: existing.samples + 1, updatedAt: now })
    } else {
      voice = { id: randomUUID(), name, embedding, samples: 1, updatedAt: now }
      this.voices.push(voice)
    }
    await this.save()
    return voice
  }

  async remove(id: string): Promise<void> {
    this.voices = this.voices.filter((v) => v.id !== id)
    await this.save()
  }

  private save() {
    return writeFileAtomic(this.file, JSON.stringify(this.voices))
  }
}
