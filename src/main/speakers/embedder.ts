import type { Worker } from 'node:worker_threads'

/** Computes voice embeddings for 16 kHz mono audio. */
export interface Embedder {
  embed(samples: Float32Array): Promise<Float32Array>
  dispose(): void
}

interface SherpaExtractor {
  createStream(): { acceptWaveform(o: { sampleRate: number; samples: Float32Array }): void; inputFinished(): void }
  compute(stream: unknown, enableExternalBuffer?: boolean): Float32Array
}

export function loadExtractor(modelPath: string): SherpaExtractor {
  // Loaded lazily: the native addon is only needed once speaker separation is used.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const sherpa = require('sherpa-onnx-node') as { SpeakerEmbeddingExtractor: new (c: object) => SherpaExtractor }
  return new sherpa.SpeakerEmbeddingExtractor({ model: modelPath, numThreads: 2, debug: false })
}

export function computeEmbedding(extractor: SherpaExtractor, samples: Float32Array): Float32Array {
  const stream = extractor.createStream()
  stream.acceptWaveform({ sampleRate: 16000, samples })
  stream.inputFinished()
  return Float32Array.from(extractor.compute(stream, false))
}

/** Runs the model on the calling thread (used by tests and as a fallback). */
export function createInlineEmbedder(modelPath: string): Embedder {
  const extractor = loadExtractor(modelPath)
  return {
    embed: async (samples) => computeEmbedding(extractor, samples),
    dispose: () => undefined
  }
}

/** Runs the model on a worker thread so the main process never stalls. */
export function createWorkerEmbedder(spawn: (options: { workerData: unknown }) => Worker, modelPath: string): Embedder {
  const worker = spawn({ workerData: { modelPath } })
  const pending = new Map<number, { resolve: (v: Float32Array) => void; reject: (e: Error) => void }>()
  let nextId = 1
  let failed: Error | null = null
  worker.on('message', (msg: { id: number; embedding?: Float32Array; error?: string }) => {
    const p = pending.get(msg.id)
    if (!p) return
    pending.delete(msg.id)
    if (msg.embedding) p.resolve(msg.embedding)
    else p.reject(new Error(msg.error ?? 'Embedding failed'))
  })
  const failAll = (err: Error) => {
    failed = err
    for (const p of pending.values()) p.reject(err)
    pending.clear()
  }
  worker.on('error', failAll)
  worker.on('exit', (code) => code !== 0 && failAll(new Error(`Speaker worker exited (${code})`)))
  worker.unref()
  return {
    embed(samples) {
      if (failed) return Promise.reject(failed)
      const id = nextId++
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject })
        worker.postMessage({ id, samples }, [samples.buffer as ArrayBuffer])
      })
    },
    dispose() {
      void worker.terminate()
    }
  }
}
