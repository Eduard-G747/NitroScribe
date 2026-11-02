import workletSource from './pcm-worklet.js?raw'

export interface RecorderOptions {
  micDeviceId?: string
  captureSystem: boolean
  noiseSuppression: boolean
}

export interface Levels {
  mic: number
  sys: number
}

/**
 * Captures the microphone ("me") and the computer's audio output via WASAPI loopback ("them"),
 * resamples both to 16 kHz and streams synchronized Int16 frames to the main process.
 */
export class Recorder {
  private ctx: AudioContext | null = null
  private streams: MediaStream[] = []
  private node: AudioWorkletNode | null = null
  systemAudio = false
  onLevels?: (levels: Levels) => void
  onTrackEnded?: (message: string) => void

  async start(opts: RecorderOptions): Promise<void> {
    const mic = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: opts.micDeviceId ? { exact: opts.micDeviceId } : undefined,
        echoCancellation: true,
        noiseSuppression: opts.noiseSuppression,
        autoGainControl: true,
        channelCount: 1
      }
    })
    this.streams.push(mic)

    let sys: MediaStream | null = null
    if (opts.captureSystem) {
      try {
        sys = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })
        for (const t of sys.getVideoTracks()) {
          t.stop()
          sys.removeTrack(t)
        }
        if (sys.getAudioTracks().length) this.streams.push(sys)
        else sys = null
      } catch (err) {
        console.warn('System audio capture unavailable', err)
        sys = null
      }
    }
    this.systemAudio = !!sys

    const ctx = new AudioContext({ sampleRate: 16000, latencyHint: 'playback' })
    this.ctx = ctx
    const url = URL.createObjectURL(new Blob([workletSource], { type: 'application/javascript' }))
    try {
      await ctx.audioWorklet.addModule(url)
    } finally {
      URL.revokeObjectURL(url)
    }
    const merger = ctx.createChannelMerger(2)
    ctx.createMediaStreamSource(mic).connect(merger, 0, 0)
    if (sys) ctx.createMediaStreamSource(sys).connect(merger, 0, 1)
    const node = new AudioWorkletNode(ctx, 'pcm-capture', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
      channelCount: 2,
      channelCountMode: 'explicit',
      channelInterpretation: 'discrete'
    })
    this.node = node
    node.port.onmessage = (e: MessageEvent) => {
      const d = e.data as { mic?: Int16Array; sys?: Int16Array; micLevel?: number; sysLevel?: number }
      if (!d.mic) return
      window.api.recording.pushAudio(d.mic, this.systemAudio ? (d.sys ?? null) : null)
      this.onLevels?.({ mic: d.micLevel ?? 0, sys: d.sysLevel ?? 0 })
    }
    merger.connect(node)
    const sink = ctx.createGain()
    sink.gain.value = 0
    node.connect(sink).connect(ctx.destination)
    if (ctx.state === 'suspended') await ctx.resume()

    mic.getAudioTracks()[0]?.addEventListener('ended', () => this.onTrackEnded?.('The microphone was disconnected.'))
    sys?.getAudioTracks()[0]?.addEventListener('ended', () => {
      this.systemAudio = false
      this.onTrackEnded?.('Computer audio capture stopped.')
    })
  }

  /** Flushes the last partial frame, then releases all devices. */
  async stop(): Promise<void> {
    const node = this.node
    if (node) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 300)
        node.port.addEventListener('message', (e: MessageEvent) => {
          if ((e.data as { flushed?: boolean }).flushed) {
            clearTimeout(timer)
            resolve()
          }
        })
        node.port.postMessage('flush')
      })
      node.port.onmessage = null
      node.disconnect()
    }
    for (const s of this.streams) for (const t of s.getTracks()) t.stop()
    this.streams = []
    this.node = null
    await this.ctx?.close().catch(() => undefined)
    this.ctx = null
  }
}
