export type Speaker = 'me' | 'them'

export interface TranscriptSegment {
  id: string
  /** Audio channel: the microphone ("me") or the computer's audio ("them"). */
  speaker: Speaker
  /** Which remote person said it (see Meeting.speakers); absent when speaker separation is unavailable. */
  speakerId?: string
  text: string
  /** Milliseconds since the meeting's first recording started. */
  start: number
  end: number
  language?: string
}

export type SpeakerNameSource = 'manual' | 'ai' | 'voice'

export interface MeetingSpeaker {
  id: string
  name?: string
  nameSource?: SpeakerNameSource
  /** Link to a remembered voice in the voice library. */
  voiceId?: string
  /** Normalized voice embedding (centroid) used to keep speakers consistent across recordings. */
  embedding?: number[]
}

export interface Voice {
  id: string
  name: string
  embedding: number[]
  samples: number
  updatedAt: string
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  createdAt: string
  error?: boolean
}

export interface CalendarEvent {
  uid: string
  title: string
  start: string
  end: string
  allDay: boolean
  attendees: string[]
  location?: string
  meetingUrl?: string
  description?: string
  calendarName?: string
}

export interface Meeting {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  /** ISO time of the first recording start; transcript timestamps are relative to it. */
  startedAt?: string
  durationMs: number
  notesHtml: string
  notesMarkdown: string
  enhancedHtml?: string
  enhancedMarkdown?: string
  enhancedAt?: string
  templateId?: string
  transcript: TranscriptSegment[]
  speakers?: Record<string, MeetingSpeaker>
  chat: ChatMessage[]
  attendees: string[]
  calendarEvent?: CalendarEvent
  /** Set when the meeting was created from an imported transcript file. */
  source?: MeetingSource
}

export interface MeetingSource {
  kind: 'import'
  fileName?: string
  format: string
  importedAt: string
}

/** One line of an imported transcript. Times are ms from the start (estimated when the file had none). */
export interface ImportedLine {
  speaker?: string
  text: string
  start: number
  end: number
}

export interface ImportPreview {
  fileName: string
  format: string
  title: string
  /** Date found in the file or its name (ISO), if any. */
  date?: string
  /** Whether the file had real timestamps. */
  timed: boolean
  lines: ImportedLine[]
  speakers: { name: string; lines: number }[]
  /** Speaker the file marks as the user (NitroScribe exports). */
  suggestedMe?: string
}

export interface ImportRequest {
  title: string
  startedAt: string
  lines: ImportedLine[]
  /** The speaker name that is the user (their lines become "me"). */
  me?: string
  fileName: string
  format: string
}

export type MeetingPatch = Partial<
  Pick<
    Meeting,
    | 'title'
    | 'notesHtml'
    | 'notesMarkdown'
    | 'enhancedHtml'
    | 'enhancedMarkdown'
    | 'enhancedAt'
    | 'templateId'
    | 'chat'
    | 'attendees'
    | 'calendarEvent'
    | 'speakers'
  >
>

export interface MeetingSummary {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  startedAt?: string
  durationMs: number
  hasEnhanced: boolean
  segmentCount: number
  attendees: string[]
  /** Named speakers and calendar attendees. */
  participants: string[]
  preview: string
}

export interface SearchResult {
  id: string
  title: string
  createdAt: string
  snippet: string
  score: number
}

export interface Template {
  id: string
  name: string
  description: string
  instructions: string
  builtIn?: boolean
}

export type LlmProviderId =
  | 'openai'
  | 'anthropic'
  | 'gemini'
  | 'openrouter'
  | 'groq'
  | 'xai'
  | 'deepseek'
  | 'mistral'
  | 'ollama'
  | 'lmstudio'
  | 'custom'

export interface LlmProviderConfig {
  baseUrl: string
  model: string
}

export type WhisperModelId = 'large-v3-q5_0' | 'large-v3-turbo-q5_0' | 'large-v3-turbo-q8_0' | 'medium-q5_0' | 'small-q5_1'

export interface CalendarSource {
  id: string
  name: string
  url: string
  enabled: boolean
}

export interface Settings {
  userName: string
  ai: {
    provider: LlmProviderId
    providers: Record<LlmProviderId, LlmProviderConfig>
    autoEnhance: boolean
    /** Let the AI work out remote speakers' names from the conversation. */
    autoNameSpeakers: boolean
    notesLanguage: string
  }
  transcription: {
    model: WhisperModelId
    language: string
    micDeviceId: string
    captureSystemAudio: boolean
    vocabulary: string
    useGpu: boolean
    gpuDevice: number
    noiseSuppression: boolean
    /** Tell remote participants apart by voice. */
    separateSpeakers: boolean
    /** Remember the voices of people you name, to recognize them in later meetings. */
    rememberVoices: boolean
  }
  customTemplates: Template[]
  defaultTemplateId: string
  calendars: CalendarSource[]
  notifyMeetings: boolean
  general: {
    launchAtLogin: boolean
    closeToTray: boolean
    onboarded: boolean
    theme: ThemePreference
  }
  privacy: {
    /** Meeting data may only be sent to AI servers on this PC or the local network. */
    localOnly: boolean
  }
}

export type ThemePreference = 'system' | 'light' | 'dark'

export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? (T[K] extends unknown[] ? T[K] : DeepPartial<T[K]>) : T[K]
}

export type SettingsPatch = DeepPartial<Settings>

export interface SettingsView {
  settings: Settings
  keys: Record<LlmProviderId, boolean>
  dataDir: string
}

export type RecordingStatus = 'idle' | 'recording' | 'finishing'

export interface RecordingState {
  status: RecordingStatus
  meetingId: string | null
  /** Wall-clock ms when the current recording session started. */
  sessionStartedAt: number | null
  /** Recorded duration of the meeting before the current session. */
  priorDurationMs: number
  pendingSeconds: number
  engine: 'idle' | 'starting' | 'ready' | 'error' | 'not-installed'
  error?: string
}

export interface SegmentsEvent {
  meetingId: string
  added: TranscriptSegment[]
  removed: string[]
  /** segment id → new speakerId, after speakers are re-clustered at the end of a recording. */
  relabeled?: Record<string, string>
  speakers?: Record<string, MeetingSpeaker>
}

export interface DownloadProgress {
  label: string
  received: number
  total: number
}

export interface WhisperStatus {
  binary: 'cuda' | 'cpu' | null
  installedModels: WhisperModelId[]
  /** Voice model used to tell speakers apart. */
  speakerModel: boolean
  gpu: { name: string; vramMb: number } | null
  server: 'stopped' | 'starting' | 'ready' | 'error'
  serverModel: WhisperModelId | null
  /** Which device the running server actually uses. */
  device: 'gpu' | 'cpu' | null
  error?: string
  installing: boolean
  download: DownloadProgress | null
}

export interface AiStreamEvent {
  requestId: string
  delta?: string
  done?: boolean
  error?: string
  text?: string
}

export interface ChatRequest {
  meetingId: string | null
  messages: Pick<ChatMessage, 'role' | 'content'>[]
}

export interface EnhanceRequest {
  meetingId: string
  templateId: string
}

export type AppCommand =
  | { type: 'new-meeting'; record: boolean }
  | { type: 'open-meeting'; id: string }
  | { type: 'start-from-event'; event: CalendarEvent }
  | { type: 'stop-recording' }
  | { type: 'open-settings' }

export interface SaveFileRequest {
  defaultName: string
  content: string
  filters: { name: string; extensions: string[] }[]
}
