import type {
  AiStreamEvent,
  AppCommand,
  CalendarEvent,
  ChatRequest,
  EnhanceRequest,
  LlmProviderId,
  ImportPreview,
  ImportRequest,
  Meeting,
  MeetingPatch,
  MeetingSpeaker,
  MeetingSummary,
  RecordingState,
  SaveFileRequest,
  SearchResult,
  SegmentsEvent,
  SettingsPatch,
  SettingsView,
  WhisperModelId,
  WhisperStatus
} from './types'

type Unsubscribe = () => void

export interface CalendarSnapshot {
  events: CalendarEvent[]
  errors: string[]
}

export interface AppInfo {
  version: string
  platform: string
  dataDir: string
  logsDir: string
}

export interface Toast {
  kind: 'error' | 'info'
  message: string
}

export interface VoiceSummary {
  id: string
  name: string
  samples: number
  updatedAt: string
}

export interface NitroScribeApi {
  meetings: {
    list(): Promise<MeetingSummary[]>
    get(id: string): Promise<Meeting | null>
    create(init?: Partial<Meeting>): Promise<Meeting>
    update(id: string, patch: MeetingPatch): Promise<void>
    remove(id: string): Promise<void>
    search(query: string): Promise<SearchResult[]>
    onChanged(cb: (summary: MeetingSummary) => void): Unsubscribe
    onDeleted(cb: (id: string) => void): Unsubscribe
  }
  recording: {
    start(meetingId: string): Promise<RecordingState>
    stop(reason?: string): Promise<void>
    state(): Promise<RecordingState>
    pushAudio(mic: Int16Array, sys: Int16Array | null): void
    onState(cb: (state: RecordingState) => void): Unsubscribe
    onSegments(cb: (event: SegmentsEvent) => void): Unsubscribe
    onFinished(cb: (meetingId: string) => void): Unsubscribe
  }
  /** 'win32', 'darwin', … */
  platform: string
  imports: {
    /** Opens a file picker; null when cancelled. */
    pick(): Promise<ImportPreview | null>
    /** Parses dropped file bytes or pasted text. */
    parse(data: Uint8Array | string, fileName: string): Promise<ImportPreview>
    create(req: ImportRequest): Promise<Meeting>
  }
  speakers: {
    rename(meetingId: string, speakerId: string, name: string, remember: boolean): Promise<Record<string, MeetingSpeaker>>
    identify(meetingId: string): Promise<number>
    voices(): Promise<VoiceSummary[]>
    forgetVoice(id: string): Promise<void>
  }
  ai: {
    enhance(req: EnhanceRequest): Promise<string>
    chat(req: ChatRequest): Promise<string>
    cancel(requestId: string): Promise<void>
    models(provider: LlmProviderId): Promise<string[]>
    test(provider: LlmProviderId): Promise<{ ok: boolean; message: string }>
    onStream(cb: (event: AiStreamEvent) => void): Unsubscribe
  }
  settings: {
    get(): Promise<SettingsView>
    update(patch: SettingsPatch): Promise<SettingsView>
    setKey(provider: LlmProviderId, key: string): Promise<SettingsView>
    onChanged(cb: (view: SettingsView) => void): Unsubscribe
  }
  whisper: {
    status(): Promise<WhisperStatus>
    install(model: WhisperModelId): Promise<void>
    cancel(): Promise<void>
    deleteModel(model: WhisperModelId): Promise<void>
    onStatus(cb: (status: WhisperStatus) => void): Unsubscribe
  }
  calendar: {
    snapshot(): Promise<CalendarSnapshot>
    refresh(): Promise<CalendarSnapshot>
    test(url: string): Promise<{ ok: boolean; message: string }>
    onEvents(cb: (events: CalendarEvent[]) => void): Unsubscribe
  }
  files: {
    save(req: SaveFileRequest): Promise<string | null>
    exportAll(): Promise<number | null>
    copy(text: string): Promise<void>
  }
  app: {
    info(): Promise<AppInfo>
    openExternal(url: string): Promise<void>
    openFolder(which: 'data' | 'logs'): Promise<void>
    onCommand(cb: (command: AppCommand) => void): Unsubscribe
    onToast(cb: (toast: Toast) => void): Unsubscribe
  }
}
