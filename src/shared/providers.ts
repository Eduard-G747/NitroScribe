import type { LlmProviderId } from './types'

export type ProviderKind = 'openai' | 'anthropic' | 'ollama'

export interface ProviderPreset {
  id: LlmProviderId
  label: string
  kind: ProviderKind
  baseUrl: string
  needsKey: boolean
  keyUrl?: string
  defaultModel: string
  local?: boolean
}

export const PROVIDERS: ProviderPreset[] = [
  { id: 'openai', label: 'OpenAI', kind: 'openai', baseUrl: 'https://api.openai.com/v1', needsKey: true, keyUrl: 'https://platform.openai.com/api-keys', defaultModel: 'gpt-5-mini' },
  { id: 'anthropic', label: 'Anthropic (Claude)', kind: 'anthropic', baseUrl: 'https://api.anthropic.com', needsKey: true, keyUrl: 'https://console.anthropic.com/settings/keys', defaultModel: 'claude-sonnet-4-5' },
  { id: 'gemini', label: 'Google Gemini', kind: 'openai', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', needsKey: true, keyUrl: 'https://aistudio.google.com/apikey', defaultModel: 'gemini-2.5-flash' },
  { id: 'openrouter', label: 'OpenRouter (any model)', kind: 'openai', baseUrl: 'https://openrouter.ai/api/v1', needsKey: true, keyUrl: 'https://openrouter.ai/keys', defaultModel: 'google/gemini-2.5-flash' },
  { id: 'groq', label: 'Groq', kind: 'openai', baseUrl: 'https://api.groq.com/openai/v1', needsKey: true, keyUrl: 'https://console.groq.com/keys', defaultModel: 'openai/gpt-oss-120b' },
  { id: 'xai', label: 'xAI (Grok)', kind: 'openai', baseUrl: 'https://api.x.ai/v1', needsKey: true, keyUrl: 'https://console.x.ai', defaultModel: 'grok-4' },
  { id: 'deepseek', label: 'DeepSeek', kind: 'openai', baseUrl: 'https://api.deepseek.com/v1', needsKey: true, keyUrl: 'https://platform.deepseek.com/api_keys', defaultModel: 'deepseek-chat' },
  { id: 'mistral', label: 'Mistral', kind: 'openai', baseUrl: 'https://api.mistral.ai/v1', needsKey: true, keyUrl: 'https://console.mistral.ai/api-keys', defaultModel: 'mistral-medium-latest' },
  { id: 'ollama', label: 'Ollama (local)', kind: 'ollama', baseUrl: 'http://127.0.0.1:11434', needsKey: false, defaultModel: '', local: true },
  { id: 'lmstudio', label: 'LM Studio (local)', kind: 'openai', baseUrl: 'http://127.0.0.1:1234/v1', needsKey: false, defaultModel: '', local: true },
  { id: 'custom', label: 'Custom (OpenAI-compatible)', kind: 'openai', baseUrl: '', needsKey: false, defaultModel: '' }
]

export function providerPreset(id: LlmProviderId): ProviderPreset {
  return PROVIDERS.find((p) => p.id === id) ?? PROVIDERS[0]
}
