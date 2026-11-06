import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { NitroScribeApi } from '@shared/api'

async function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  try {
    return (await ipcRenderer.invoke(channel, ...args)) as T
  } catch (err) {
    throw new Error(String((err as Error).message).replace(/^Error invoking remote method '[^']+': (?:Error: )?/, ''))
  }
}

function on<T>(channel: string) {
  return (cb: (payload: T) => void) => {
    const handler = (_e: IpcRendererEvent, payload: T) => cb(payload)
    ipcRenderer.on(channel, handler)
    return () => {
      ipcRenderer.removeListener(channel, handler)
    }
  }
}

const api: NitroScribeApi = {
  meetings: {
    list: () => invoke('meetings:list'),
    get: (id) => invoke('meetings:get', id),
    create: (init) => invoke('meetings:create', init),
    update: (id, patch) => invoke('meetings:update', id, patch),
    remove: (id) => invoke('meetings:remove', id),
    search: (query) => invoke('meetings:search', query),
    onChanged: on('meetings:changed'),
    onDeleted: on('meetings:deleted')
  },
  recording: {
    start: (meetingId) => invoke('recording:start', meetingId),
    stop: (reason) => invoke('recording:stop', reason),
    state: () => invoke('recording:state'),
    pushAudio: (mic, sys) => ipcRenderer.send('recording:audio', mic, sys),
    onState: on('recording:state'),
    onSegments: on('recording:segments'),
    onFinished: on('recording:finished')
  },
  platform: process.platform,
  imports: {
    pick: () => invoke('import:pick'),
    parse: (data, fileName) => invoke('import:parse', data, fileName),
    create: (req) => invoke('import:create', req),
    describe: (fileName) => invoke('import:describe', fileName),
    audioStart: (req) => invoke('import:audioStart', req),
    audioPush: (meetingId, pcm) => invoke('import:audioPush', meetingId, pcm),
    audioFinish: (meetingId) => invoke('import:audioFinish', meetingId),
    audioCancel: (meetingId) => invoke('import:audioCancel', meetingId),
    onAudioProgress: on('import:audioProgress')
  },
  speakers: {
    rename: (meetingId, speakerId, name, remember) => invoke('speakers:rename', meetingId, speakerId, name, remember),
    identify: (meetingId) => invoke('speakers:identify', meetingId),
    voices: () => invoke('voices:list'),
    forgetVoice: (id) => invoke('voices:remove', id)
  },
  ai: {
    enhance: (req) => invoke('ai:enhance', req),
    actionItems: (meetingId) => invoke('ai:actionItems', meetingId),
    followUp: (meetingId) => invoke('ai:followUp', meetingId),
    digest: (week) => invoke('ai:digest', week),
    savedDigest: (week) => invoke('digest:get', week),
    chat: (req) => invoke('ai:chat', req),
    cancel: (requestId) => invoke('ai:cancel', requestId),
    models: (provider) => invoke('ai:models', provider),
    test: (provider) => invoke('ai:test', provider),
    onStream: on('ai:stream')
  },
  settings: {
    get: () => invoke('settings:get'),
    update: (patch) => invoke('settings:update', patch),
    setKey: (provider, key) => invoke('settings:setKey', provider, key),
    onChanged: on('settings:changed')
  },
  whisper: {
    status: () => invoke('whisper:status'),
    install: (model) => invoke('whisper:install', model),
    cancel: () => invoke('whisper:cancel'),
    deleteModel: (model) => invoke('whisper:deleteModel', model),
    onStatus: on('whisper:status')
  },
  calendar: {
    snapshot: () => invoke('calendar:snapshot'),
    refresh: () => invoke('calendar:refresh'),
    test: (url) => invoke('calendar:test', url),
    onEvents: on('calendar:events')
  },
  files: {
    save: (req) => invoke('files:save', req),
    exportAll: () => invoke('files:exportAll'),
    copy: (text) => invoke('files:copy', text)
  },
  app: {
    info: () => invoke('app:info'),
    openExternal: (url) => invoke('app:openExternal', url),
    updateInfo: () => invoke('app:updateInfo'),
    openUpdate: () => invoke('app:openUpdate'),
    onUpdate: on('app:update'),
    openFolder: (which) => invoke('app:openFolder', which),
    onCommand: on('app:command'),
    onToast: on('app:toast')
  }
}

contextBridge.exposeInMainWorld('api', api)
