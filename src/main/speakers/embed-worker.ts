import { parentPort, workerData } from 'node:worker_threads'
import { computeEmbedding, loadExtractor } from './embedder'

const extractor = loadExtractor((workerData as { modelPath: string }).modelPath)

parentPort?.on('message', ({ id, samples }: { id: number; samples: Float32Array }) => {
  try {
    const embedding = computeEmbedding(extractor, samples)
    parentPort?.postMessage({ id, embedding }, [embedding.buffer as ArrayBuffer])
  } catch (err) {
    parentPort?.postMessage({ id, error: (err as Error).message })
  }
})
