import { PROVIDERS } from './providers'
import type { LlmProviderConfig, LlmProviderId, Settings } from './types'

export function defaultSettings(): Settings {
  const providers = Object.fromEntries(
    PROVIDERS.map((p) => [p.id, { baseUrl: p.baseUrl, model: p.defaultModel }])
  ) as Record<LlmProviderId, LlmProviderConfig>
  return {
    userName: '',
    ai: { provider: 'ollama', providers, autoEnhance: true, autoNameSpeakers: true, autoActionItems: true, notesLanguage: 'auto' },
    transcription: {
      model: 'large-v3-q5_0',
      language: 'auto',
      micDeviceId: '',
      captureSystemAudio: true,
      vocabulary: '',
      useGpu: true,
      gpuDevice: 0,
      noiseSuppression: true,
      separateSpeakers: true,
      rememberVoices: true
    },
    customTemplates: [],
    defaultTemplateId: 'auto',
    calendars: [],
    notifyMeetings: true,
    general: { launchAtLogin: false, closeToTray: true, onboarded: false, theme: 'system' },
    privacy: { localOnly: true },
    updates: { check: true, dismissed: '' },
    digest: { notify: true, seenWeek: '' }
  }
}

/** Deep-merges stored settings over defaults so new fields get sensible values after upgrades. */
export function mergeSettings(base: Settings, stored: unknown): Settings {
  if (!stored || typeof stored !== 'object') return base
  const s = stored as Partial<Settings>
  const providers = { ...base.ai.providers }
  for (const [id, cfg] of Object.entries(s.ai?.providers ?? {})) {
    if (id in providers) providers[id as LlmProviderId] = { ...providers[id as LlmProviderId], ...cfg }
  }
  return {
    ...base,
    ...s,
    ai: { ...base.ai, ...s.ai, providers },
    transcription: { ...base.transcription, ...s.transcription },
    general: { ...base.general, ...s.general },
    privacy: { ...base.privacy, ...s.privacy },
    updates: { ...base.updates, ...s.updates },
    digest: { ...base.digest, ...s.digest },
    customTemplates: s.customTemplates ?? base.customTemplates,
    calendars: s.calendars ?? base.calendars
  }
}
