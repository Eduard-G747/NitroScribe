import { EventEmitter } from 'node:events'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { defaultSettings, mergeSettings } from '@shared/defaults'
import { PROVIDERS } from '@shared/providers'
import type { LlmProviderId, Settings, SettingsPatch, SettingsView } from '@shared/types'
import { readJson, writeFileAtomic } from '../util/fsx'

export interface SecretCipher {
  encrypt(plain: string): string
  decrypt(encoded: string): string
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

export function deepMerge<T>(base: T, patch: unknown): T {
  if (!isPlainObject(base) || !isPlainObject(patch)) return (patch === undefined ? base : patch) as T
  const out: Record<string, unknown> = { ...base }
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue
    out[k] = isPlainObject(v) && isPlainObject(out[k]) ? deepMerge(out[k], v) : v
  }
  return out as T
}

export class SettingsStore extends EventEmitter {
  private settings: Settings = defaultSettings()
  private secrets: Partial<Record<LlmProviderId, string>> = {}

  constructor(
    private dir: string,
    private cipher: SecretCipher
  ) {
    super()
  }

  private get settingsFile() {
    return join(this.dir, 'settings.json')
  }

  private get secretsFile() {
    return join(this.dir, 'secrets.json')
  }

  async init(): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true })
    this.settings = mergeSettings(defaultSettings(), await readJson(this.settingsFile))
    this.secrets = (await readJson<Partial<Record<LlmProviderId, string>>>(this.secretsFile)) ?? {}
  }

  get(): Settings {
    return this.settings
  }

  view(): SettingsView {
    const keys = Object.fromEntries(PROVIDERS.map((p) => [p.id, !!this.secrets[p.id]])) as Record<LlmProviderId, boolean>
    return { settings: this.settings, keys, dataDir: this.dir }
  }

  async update(patch: SettingsPatch): Promise<SettingsView> {
    this.settings = deepMerge(this.settings, patch)
    await writeFileAtomic(this.settingsFile, JSON.stringify(this.settings, null, 2))
    const view = this.view()
    this.emit('changed', view)
    return view
  }

  getKey(provider: LlmProviderId): string | undefined {
    const enc = this.secrets[provider]
    if (!enc) return undefined
    try {
      return this.cipher.decrypt(enc)
    } catch {
      return undefined
    }
  }

  async setKey(provider: LlmProviderId, key: string): Promise<SettingsView> {
    const trimmed = key.trim()
    if (trimmed) this.secrets[provider] = this.cipher.encrypt(trimmed)
    else delete this.secrets[provider]
    await writeFileAtomic(this.secretsFile, JSON.stringify(this.secrets, null, 2))
    const view = this.view()
    this.emit('changed', view)
    return view
  }
}
