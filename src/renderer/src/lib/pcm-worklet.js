// AudioWorklet: receives [mic, system] as two discrete channels at 16 kHz and posts 100 ms Int16 frames.
class PcmCapture extends AudioWorkletProcessor {
  constructor() {
    super()
    this.size = 1600
    this.mic = new Float32Array(this.size)
    this.sys = new Float32Array(this.size)
    this.n = 0
    this.port.onmessage = (e) => {
      if (e.data === 'flush') {
        if (this.n > 0) this.flush()
        this.port.postMessage({ flushed: true })
      }
    }
  }

  process(inputs) {
    const input = inputs[0]
    if (!input || input.length === 0) return true
    const a = input[0]
    const b = input[1]
    for (let i = 0; i < a.length; i++) {
      this.mic[this.n] = a[i]
      this.sys[this.n] = b ? b[i] : 0
      if (++this.n === this.size) this.flush()
    }
    return true
  }

  flush() {
    const n = this.n
    const mic = new Int16Array(n)
    const sys = new Int16Array(n)
    let em = 0
    let es = 0
    for (let i = 0; i < n; i++) {
      const m = Math.max(-1, Math.min(1, this.mic[i]))
      const s = Math.max(-1, Math.min(1, this.sys[i]))
      mic[i] = m < 0 ? m * 0x8000 : m * 0x7fff
      sys[i] = s < 0 ? s * 0x8000 : s * 0x7fff
      em += m * m
      es += s * s
    }
    this.port.postMessage({ mic, sys, micLevel: Math.sqrt(em / n), sysLevel: Math.sqrt(es / n) }, [mic.buffer, sys.buffer])
    this.n = 0
  }
}

registerProcessor('pcm-capture', PcmCapture)
