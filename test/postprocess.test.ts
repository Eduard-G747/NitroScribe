import { describe, expect, it } from 'vitest'
import { buildPrompt, cleanTranscriptText, isEcho, isHallucination } from '../src/main/transcription/postprocess'

describe('cleanTranscriptText', () => {
  it('removes non-speech annotations', () => {
    expect(cleanTranscriptText('[BLANK_AUDIO]')).toBe('')
    expect(cleanTranscriptText(' (upbeat music) Hello  there ♪')).toBe('Hello there')
    expect(cleanTranscriptText('[Music] *laughs* okay')).toBe('okay')
  })

  it('collapses decoding loops', () => {
    expect(cleanTranscriptText('I see. I see. I see. I see. I see.')).toBe('I see. I see.')
    expect(cleanTranscriptText('no no no no no no way')).toBe('no way')
    expect(cleanTranscriptText('that that is fine')).toBe('that that is fine')
  })

  it('drops punctuation-only output', () => {
    expect(cleanTranscriptText(' ... ')).toBe('')
  })
})

describe('isHallucination', () => {
  it('flags classic Whisper hallucinations on short or unsure audio', () => {
    expect(isHallucination('Thank you.', { durationMs: 900, probability: 0.9 })).toBe(true)
    expect(isHallucination('Thanks for watching!', { durationMs: 5000, probability: 0.3 })).toBe(true)
    expect(isHallucination('Gracias.', { durationMs: 1200, probability: 0.8 })).toBe(true)
    expect(isHallucination("Merci d'avoir regardé", { durationMs: 1500, probability: 0.9 })).toBe(true)
    expect(isHallucination('Subtitles by the Amara.org community', { durationMs: 8000, probability: 0.99 })).toBe(true)
  })

  it('keeps real speech', () => {
    expect(isHallucination('Thank you.', { durationMs: 3200, probability: 0.92 })).toBe(false)
    expect(isHallucination('Thank you for the update on the budget.', { durationMs: 1500, probability: 0.4 })).toBe(false)
  })
})

describe('isEcho', () => {
  const them = { text: 'I reviewed the draft yesterday and the enterprise tier needs work', start: 10_000, end: 15_000 }
  it('detects a mic segment repeating the remote side', () => {
    expect(isEcho({ text: 'reviewed the draft yesterday, and the Enterprise tier', start: 10_300, end: 14_000 }, them)).toBe(true)
  })
  it('ignores different speech or distant times', () => {
    expect(isEcho({ text: 'Sounds good, let us ship it on Friday', start: 10_300, end: 12_000 }, them)).toBe(false)
    expect(isEcho({ text: 'reviewed the draft yesterday', start: 40_000, end: 42_000 }, them)).toBe(false)
  })
  it('treats short backchannels carefully', () => {
    expect(isEcho({ text: 'Yeah.', start: 11_000, end: 11_400 }, them)).toBe(false)
    expect(isEcho({ text: 'Okay', start: 11_000, end: 11_400 }, { text: 'Okay.', start: 10_900, end: 11_300 })).toBe(true)
  })
})

describe('buildPrompt', () => {
  it('combines vocabulary and recent context within limits', () => {
    const p = buildPrompt('NitroScribe, Kubernetes\nAna Souza', 'x'.repeat(1000))
    expect(p.startsWith('NitroScribe, Kubernetes, Ana Souza.')).toBe(true)
    expect(p.length).toBeLessThanOrEqual(450)
    expect(buildPrompt('', '  hello world ')).toBe('hello world')
  })
})
