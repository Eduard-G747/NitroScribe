/** Audio and video files that can be transcribed (decoded by Chromium's built-in decoders). */
export const MEDIA_FILE = /\.(mp3|m4a|aac|wav|ogg|oga|opus|flac|webm|weba|mp4|m4v|mov|mkv|3gp|amr|wma)$/i

const MAX_BYTES = 2 * 1024 * 1024 * 1024

/**
 * Decodes an audio (or video) file to 16 kHz mono 16-bit PCM, the format Whisper uses.
 * Decoding at 16 kHz makes the browser resample for us.
 */
export async function decodeRecording(file: File): Promise<{ pcm: Int16Array; durationMs: number }> {
  if (file.size > MAX_BYTES) throw new Error('This file is too big (2 GB max). Try exporting just the audio.')
  let buffer: AudioBuffer
  try {
    buffer = await new OfflineAudioContext(1, 1, 16000).decodeAudioData(await file.arrayBuffer())
  } catch {
    throw new Error("This file's audio couldn't be read. Try converting it to MP3, M4A or WAV.")
  }
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i))
  const pcm = new Int16Array(buffer.length)
  for (let i = 0; i < pcm.length; i++) {
    let s = 0
    for (const c of channels) s += c[i]
    pcm[i] = Math.max(-32768, Math.min(32767, Math.round((s / channels.length) * 32767)))
  }
  if (!pcm.length) throw new Error('This recording is empty.')
  return { pcm, durationMs: Math.round((pcm.length / 16000) * 1000) }
}
