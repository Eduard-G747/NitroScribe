import { EventEmitter } from 'node:events'
import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { createWriteStream, existsSync, promises as fs, type WriteStream } from 'node:fs'
import { createServer } from 'node:net'
import { cpus } from 'node:os'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import type { WhisperModelId, WhisperStatus } from '@shared/types'
import { SPEAKER_MODEL, WHISPER_BINARIES, WHISPER_MODELS, WHISPER_RELEASE, whisperModel } from '@shared/whisperModels'

const MAC = process.platform === 'darwin'
import { readJson } from '../util/fsx'
import { log } from '../util/log'
import { downloadVerified } from './download'

const execFileAsync = promisify(execFile)
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export interface WhisperWord {
  word: string
  start: number
  end: number
  probability: number
}

export interface WhisperSegment {
  id: number
  text: string
  start: number
  end: number
  words?: WhisperWord[]
  avg_logprob?: number
  no_speech_prob?: number
}

export interface WhisperResult {
  language?: string
  duration?: number
  text: string
  segments: WhisperSegment[]
}

export interface ServerConfig {
  model: WhisperModelId
  useGpu: boolean
  gpuDevice: number
}

export interface TranscribeParams {
  language: string
  prompt: string
}

export async function detectGpu(): Promise<{ name: string; vramMb: number } | null> {
  const candidates = ['nvidia-smi', join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'nvidia-smi.exe')]
  for (const cmd of candidates) {
    try {
      const { stdout } = await execFileAsync(cmd, ['--query-gpu=name,memory.total', '--format=csv,noheader,nounits'], {
        timeout: 8000,
        windowsHide: true
      })
      const [name, mem] = stdout.trim().split('\n')[0].split(',').map((s) => s.trim())
      if (name) return { name, vramMb: Number(mem) || 0 }
    } catch {
      /* try next */
    }
  }
  return null
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer()
    srv.once('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address()
      srv.close(() => (addr && typeof addr === 'object' ? resolve(addr.port) : reject(new Error('No free port'))))
    })
  })
}

async function findFile(dir: string, name: string): Promise<string | null> {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name)
    if (entry.isFile() && entry.name.toLowerCase() === name.toLowerCase()) return p
    if (entry.isDirectory()) {
      const found = await findFile(p, name)
      if (found) return found
    }
  }
  return null
}

export class WhisperManager extends EventEmitter {
  private status: WhisperStatus = {
    binary: null,
    installedModels: [],
    speakerModel: false,
    gpu: null,
    server: 'stopped',
    serverModel: null,
    device: null,
    installing: false,
    download: null
  }
  private proc: ChildProcess | null = null
  private url: string | null = null
  private config: ServerConfig | null = null
  private starting: Promise<string> | null = null
  private installing: Promise<void> | null = null
  private abort: AbortController | null = null
  private idleTimer: NodeJS.Timeout | null = null
  private log: WriteStream | null = null

  constructor(
    private dir: string,
    private logDir: string
  ) {
    super()
  }

  /** Windows downloads the engine into the data folder; the Mac app ships a Metal build in its resources. */
  get binDir() {
    if (!MAC) return join(this.dir, 'bin')
    if (process.env.NITROSCRIBE_WHISPER_BIN) return process.env.NITROSCRIBE_WHISPER_BIN
    const bundled = process.resourcesPath ? join(process.resourcesPath, 'whisper') : ''
    return bundled && existsSync(bundled) ? bundled : join(process.cwd(), 'whisper-bin', 'mac')
  }

  get modelsDir() {
    return join(this.dir, 'models')
  }

  private get serverExe() {
    return join(this.binDir, MAC ? 'whisper-server' : 'whisper-server.exe')
  }

  modelPath(id: WhisperModelId) {
    return join(this.modelsDir, whisperModel(id).file)
  }

  get speakerModelPath() {
    return join(this.modelsDir, SPEAKER_MODEL.file)
  }

  async init(): Promise<void> {
    await fs.mkdir(this.modelsDir, { recursive: true })
    await fs.mkdir(this.logDir, { recursive: true })
    await this.refresh()
    this.status.gpu = MAC ? (process.arch === 'arm64' ? { name: 'Apple GPU (Metal)', vramMb: 0 } : null) : await detectGpu()
    this.emitStatus()
  }

  async refresh(): Promise<WhisperStatus> {
    if (MAC) {
      this.status.binary = existsSync(this.serverExe) ? 'metal' : null
    } else {
      const variant = await readJson<{ variant: 'cuda' | 'cpu' }>(join(this.binDir, 'variant.json'))
      this.status.binary = variant && existsSync(this.serverExe) ? variant.variant : null
    }
    this.status.installedModels = WHISPER_MODELS.filter((m) => existsSync(this.modelPath(m.id))).map((m) => m.id)
    this.status.speakerModel = existsSync(this.speakerModelPath)
    this.emitStatus()
    return this.getStatus()
  }

  getStatus(): WhisperStatus {
    return { ...this.status }
  }

  isReady(model: WhisperModelId): boolean {
    return !!this.status.binary && this.status.installedModels.includes(model)
  }

  get isInstalling(): boolean {
    return !!this.installing
  }

  private emitStatus() {
    this.emit('status', this.getStatus())
  }

  install(model: WhisperModelId): Promise<void> {
    if (this.installing) return this.installing
    const abort = (this.abort = new AbortController())
    this.status.installing = true
    this.status.error = undefined
    this.emitStatus()
    this.installing = this.doInstall(model, abort.signal)
      .catch((err: Error) => {
        this.status.error = abort.signal.aborted ? 'Download cancelled' : err.message
        throw err
      })
      .finally(async () => {
        this.installing = null
        this.abort = null
        this.status.installing = false
        this.status.download = null
        await this.refresh()
      })
    return this.installing
  }

  cancelInstall(): void {
    this.abort?.abort()
  }

  private async doInstall(model: WhisperModelId, signal: AbortSignal) {
    const progress = (label: string) => (received: number, total: number) => {
      this.status.download = { label, received, total }
      this.emitStatus()
    }
    if (MAC && !this.status.binary) throw new Error('This build of NitroScribe is missing its speech engine. Download the app again.')
    if (!this.status.binary) {
      const variant = this.status.gpu ? 'cuda' : 'cpu'
      const remote = WHISPER_BINARIES[variant]
      const zip = join(this.dir, remote.file)
      await downloadVerified(remote, zip, { signal, onProgress: progress(variant === 'cuda' ? 'Speech engine (NVIDIA GPU build)' : 'Speech engine') })
      this.status.download = { label: 'Unpacking speech engine', received: 0, total: 0 }
      this.emitStatus()
      await this.extractBinaries(zip, variant)
      await fs.rm(zip, { force: true })
      await this.refresh()
    }
    if (!existsSync(this.modelPath(model))) {
      const info = whisperModel(model)
      await downloadVerified(info, this.modelPath(model), { signal, onProgress: progress(`Whisper ${info.label}`) })
    }
    if (!existsSync(this.speakerModelPath)) {
      await downloadVerified(SPEAKER_MODEL, this.speakerModelPath, { signal, onProgress: progress('Voice recognition model') })
    }
  }

  private async extractBinaries(zip: string, variant: 'cuda' | 'cpu') {
    const tmp = join(this.dir, 'bin-tmp')
    await fs.rm(tmp, { recursive: true, force: true })
    await fs.mkdir(tmp, { recursive: true })
    const tar = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe')
    await execFileAsync(tar, ['-xf', zip, '-C', tmp], { windowsHide: true, maxBuffer: 1 << 24 })
    const exe = await findFile(tmp, 'whisper-server.exe')
    if (!exe) throw new Error('whisper-server.exe was not found in the downloaded archive')
    this.stopServer()
    await fs.rm(this.binDir, { recursive: true, force: true })
    await fs.rename(dirname(exe), this.binDir)
    await fs.rm(tmp, { recursive: true, force: true })
    await fs.writeFile(join(this.binDir, 'variant.json'), JSON.stringify({ variant, release: WHISPER_RELEASE }))
  }

  async deleteModel(id: WhisperModelId): Promise<void> {
    if (this.config?.model === id) this.stopServer()
    await fs.rm(this.modelPath(id), { force: true })
    await this.refresh()
  }

  /** Starts (or reuses) the local whisper-server and resolves with its base URL. */
  ensureServer(config: ServerConfig): Promise<string> {
    this.cancelIdleStop()
    const same =
      !!this.config &&
      this.config.model === config.model &&
      this.config.useGpu === config.useGpu &&
      this.config.gpuDevice === config.gpuDevice
    if (same && this.url && this.proc) return Promise.resolve(this.url)
    if (same && this.starting) return this.starting
    this.stopServer()
    this.config = config
    const starting = this.startServer(config).finally(() => {
      if (this.starting === starting) this.starting = null
    })
    this.starting = starting
    return starting
  }

  private async startServer(config: ServerConfig): Promise<string> {
    if (this.installing) await this.installing.catch(() => undefined)
    if (!this.isReady(config.model)) throw new Error('Local transcription is not set up yet. Open Settings → Transcription to download the model.')
    const port = await freePort()
    const threads = Math.max(2, Math.min(4, cpus().length))
    const args = ['-m', this.modelPath(config.model), '--host', '127.0.0.1', '--port', String(port), '-t', String(threads)]
    // No --vad: whisper.cpp's Silero VAD gets slower with every request in this build (seconds → minutes),
    // and we already send only speech regions (see transcription/windows.ts).
    args.push('-l', 'auto', '-nlp', '-sns')
    // CUDA (Windows) picks the GPU with -dev; Metal (Mac) uses the GPU by default; otherwise run on the CPU.
    const gpu = config.useGpu && (this.status.binary === 'cuda' || this.status.binary === 'metal')
    if (!gpu) args.push('-ng')
    else if (this.status.binary === 'cuda') args.push('-dev', String(config.gpuDevice))
    // A stale CUDA_VISIBLE_DEVICES (e.g. "1" on a single-GPU laptop) hides the GPU entirely; we select the device with -dev instead.
    const env = { ...process.env }
    delete env.CUDA_VISIBLE_DEVICES

    this.status.server = 'starting'
    this.status.serverModel = config.model
    this.status.device = null
    this.status.error = undefined
    this.emitStatus()

    await this.openLog()
    const proc = spawn(this.serverExe, args, { cwd: this.binDir, env, windowsHide: true })
    this.proc = proc
    const tail: string[] = []
    let device: 'gpu' | 'cpu' | null = null
    const onData = (buf: Buffer) => {
      const text = buf.toString()
      this.log?.write(text)
      for (const line of text.split(/\r?\n/)) {
        if (!line.trim()) continue
        if (/using (CUDA\d*|Metal|MTL\d*) backend/i.test(line)) device = 'gpu'
        else if (/no GPU found/i.test(line)) device = 'cpu'
        tail.push(line)
        if (tail.length > 40) tail.shift()
      }
    }
    proc.stdout?.on('data', onData)
    proc.stderr?.on('data', onData)
    let exitCode: number | null | undefined
    proc.on('exit', (code) => {
      exitCode = code
      if (this.proc !== proc) return
      this.proc = null
      this.url = null
      this.status.server = 'error'
      this.status.device = null
      this.status.error = `Speech engine stopped unexpectedly (code ${code})`
      this.emitStatus()
      log(`whisper-server exited unexpectedly (code ${code}): ${tail.slice(-3).join(' | ')}`)
    })
    proc.on('error', (err) => {
      exitCode = -1
      tail.push(err.message)
    })

    const url = `http://127.0.0.1:${port}`
    const spawnedAt = Date.now()
    const deadline = spawnedAt + 240_000
    while (Date.now() < deadline) {
      if (exitCode !== undefined) throw new Error(`Speech engine failed to start: ${tail.slice(-4).join(' | ') || `exit code ${exitCode}`}`)
      try {
        const res = await fetch(`${url}/`, { signal: AbortSignal.timeout(2000) })
        if (res.ok) {
          if (this.proc !== proc) throw new Error('Speech engine was restarted')
          this.url = url
          this.status.server = 'ready'
          this.status.device = device ?? (args.includes('-ng') ? 'cpu' : 'gpu')
          this.emitStatus()
          log(`whisper-server ready on ${this.status.device} with ${config.model} after ${Date.now() - spawnedAt} ms`)
          return url
        }
      } catch (err) {
        if ((err as Error).message === 'Speech engine was restarted') throw err
      }
      await sleep(400)
    }
    this.stopServer()
    throw new Error('Speech engine did not start within 4 minutes')
  }

  private async openLog() {
    if (this.log) return
    const file = join(this.logDir, 'whisper-server.log')
    const stat = await fs.stat(file).catch(() => null)
    if (stat && stat.size > 5_000_000) await fs.rm(file, { force: true })
    this.log = createWriteStream(file, { flags: 'a' })
    this.log.write(`\n=== ${new Date().toISOString()} ===\n`)
  }

  stopServer(): void {
    const proc = this.proc
    this.proc = null
    this.url = null
    this.config = this.starting ? this.config : null
    if (proc && proc.exitCode === null) proc.kill()
    if (this.status.server !== 'stopped') {
      this.status.server = 'stopped'
      this.status.device = null
      this.emitStatus()
    }
  }

  scheduleIdleStop(ms = 10 * 60_000): void {
    this.cancelIdleStop()
    this.idleTimer = setTimeout(() => this.stopServer(), ms)
  }

  cancelIdleStop(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer)
    this.idleTimer = null
  }

  async transcribe(wav: Buffer, params: TranscribeParams, config: ServerConfig): Promise<WhisperResult> {
    const url = await this.ensureServer(config)
    const fd = new FormData()
    fd.append('file', new Blob([new Uint8Array(wav)], { type: 'audio/wav' }), 'audio.wav')
    fd.append('response_format', 'verbose_json')
    fd.append('temperature', '0.0')
    fd.append('temperature_inc', '0.2')
    fd.append('language', params.language || 'auto')
    fd.append('no_language_probabilities', 'true')
    fd.append('token_timestamps', 'true')
    if (params.prompt) fd.append('prompt', params.prompt)
    const res = await fetch(`${url}/inference`, { method: 'POST', body: fd, signal: AbortSignal.timeout(300_000) })
    if (!res.ok) throw new Error(`Speech engine error ${res.status}: ${(await res.text()).slice(0, 200)}`)
    const json = (await res.json()) as WhisperResult & { error?: string }
    if (json.error) throw new Error(json.error)
    return { ...json, segments: json.segments ?? [] }
  }

  dispose(): void {
    this.cancelInstall()
    this.cancelIdleStop()
    this.stopServer()
    this.log?.end()
    this.log = null
  }
}
