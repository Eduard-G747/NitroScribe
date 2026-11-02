import type { WhisperModelId } from './types'

export interface RemoteFile {
  file: string
  url: string
  size: number
  sha256: string
}

export interface WhisperModelInfo extends RemoteFile {
  id: WhisperModelId
  label: string
  description: string
}

const hf = (file: string) => `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${file}`

export const WHISPER_MODELS: WhisperModelInfo[] = [
  {
    id: 'large-v3-q5_0',
    label: 'Large v3 (most accurate)',
    description: 'Best accuracy, 99 languages. Uses about 1.4 GB of VRAM.',
    file: 'ggml-large-v3-q5_0.bin',
    url: hf('ggml-large-v3-q5_0.bin'),
    size: 1081140203,
    sha256: 'd75795ecff3f83b5faa89d1900604ad8c780abd5739fae406de19f23ecd98ad1'
  },
  {
    id: 'large-v3-turbo-q8_0',
    label: 'Large v3 Turbo',
    description: 'Almost as accurate and faster. Good if the GPU is busy.',
    file: 'ggml-large-v3-turbo-q8_0.bin',
    url: hf('ggml-large-v3-turbo-q8_0.bin'),
    size: 874188075,
    sha256: '317eb69c11673c9de1e1f0d459b253999804ec71ac4c23c17ecf5fbe24e259a1'
  },
  {
    id: 'large-v3-turbo-q5_0',
    label: 'Large v3 Turbo (compact)',
    description: 'Fast and light on memory.',
    file: 'ggml-large-v3-turbo-q5_0.bin',
    url: hf('ggml-large-v3-turbo-q5_0.bin'),
    size: 574041195,
    sha256: '394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2'
  },
  {
    id: 'medium-q5_0',
    label: 'Medium',
    description: 'For laptops without an NVIDIA GPU.',
    file: 'ggml-medium-q5_0.bin',
    url: hf('ggml-medium-q5_0.bin'),
    size: 539212467,
    sha256: '19fea4b380c3a618ec4723c3eef2eb785ffba0d0538cf43f8f235e7b3b34220f'
  },
  {
    id: 'small-q5_1',
    label: 'Small',
    description: 'Fastest on CPU, lower accuracy.',
    file: 'ggml-small-q5_1.bin',
    url: hf('ggml-small-q5_1.bin'),
    size: 190085487,
    sha256: 'ae85e4a935d7a567bd102fe55afc16bb595bdb618e11b2fc7591bc08120411bb'
  }
]

export const WHISPER_RELEASE = 'b5454'

const gh = (file: string) => `https://github.com/ggml-org/whisper.cpp/releases/download/${WHISPER_RELEASE}/${file}`

export const WHISPER_BINARIES: Record<'cuda' | 'cpu', RemoteFile> = {
  cuda: {
    file: 'whisper-bin-win-cuda-12.4.0-x64.zip',
    url: gh('whisper-bin-win-cuda-12.4.0-x64.zip'),
    size: 684913404,
    sha256: 'afef0b881c500958921c3f5523b50e59ee2ec9b6f5cbd25b324c51ed308a957a'
  },
  cpu: {
    file: 'whisper-bin-x64.zip',
    url: gh('whisper-bin-x64.zip'),
    size: 8928640,
    sha256: '6ba69e3482d7826214f90a6a9c84ca07782aec1e1d0c6a7c30c994fd5d816ccb'
  }
}

/** 3D-Speaker CAM++ voice embedding model (Chinese + English training data), run with sherpa-onnx. */
export const SPEAKER_MODEL: RemoteFile = {
  file: '3dspeaker_speech_campplus_sv_zh_en_16k-common_advanced.onnx',
  url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/3dspeaker_speech_campplus_sv_zh_en_16k-common_advanced.onnx',
  size: 28281164,
  sha256: 'aa3cfc16963a10586a9393f5035d6d6b57e98d358b347f80c2a30bf4f00ceba2'
}

export function whisperModel(id: WhisperModelId): WhisperModelInfo {
  return WHISPER_MODELS.find((m) => m.id === id) ?? WHISPER_MODELS[0]
}
