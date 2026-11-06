import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { defaultSettings, mergeSettings } from '@shared/defaults'
import { MeetingStore, makeSnippet } from '../src/main/store/meetings'
import { SettingsStore, deepMerge } from '../src/main/store/settings'

const dirs: string[] = []
const tempDir = () => {
  const d = mkdtempSync(join(tmpdir(), 'nitroscribe-test-'))
  dirs.push(d)
  return d
}
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })))

describe('MeetingStore', () => {
  it('creates, updates, persists and reloads meetings', async () => {
    const dir = tempDir()
    const store = new MeetingStore(dir)
    await store.init()
    const m = await store.create({ title: 'Kickoff' })
    await store.update(m.id, { notesMarkdown: 'Discuss **pricing** tiers', notesHtml: '<p>Discuss</p>' })
    await store.applySegments(m.id, [{ id: 's2', speaker: 'them', text: 'Second', start: 2000, end: 3000 }, { id: 's1', speaker: 'me', text: 'First', start: 0, end: 1000 }], [])
    await store.applySegments(m.id, [], ['s2'])
    await store.addDuration(m.id, 61_000)
    await store.flush()

    const raw = JSON.parse(readFileSync(join(dir, `${m.id}.json`), 'utf8'))
    expect(raw.transcript.map((s: { id: string }) => s.id)).toEqual(['s1'])
    expect(raw.durationMs).toBe(61_000)

    const reloaded = new MeetingStore(dir)
    await reloaded.init()
    expect(reloaded.list()).toHaveLength(1)
    expect(reloaded.list()[0]).toMatchObject({ title: 'Kickoff', segmentCount: 1, durationMs: 61_000 })
    expect((await reloaded.get(m.id))?.notesMarkdown).toContain('pricing')
  })

  it('searches with title boost and snippets', async () => {
    const store = new MeetingStore(tempDir())
    await store.init()
    const a = await store.create({ title: 'Pricing review' })
    const b = await store.create({ title: 'Standup' })
    await store.applySegments(b.id, [{ id: 'x', speaker: 'them', text: 'We should revisit pricing for the enterprise plan soon', start: 0, end: 1 }], [])
    const results = await store.search('pricing')
    expect(results.map((r) => r.id)).toEqual([a.id, b.id])
    expect(results[1].snippet).toContain('pricing')
    expect(results[1].moments).toEqual([{ segmentId: 'x', start: 0, speaker: expect.any(String), text: 'We should revisit pricing for the enterprise plan soon' }])
    expect(results[0].moments).toEqual([])
    expect(await store.search('enterprise pricing')).toHaveLength(1)
    expect(await store.search('zzz')).toHaveLength(0)
    await store.flush()
  })

  it('deletes through the trash callback', async () => {
    const dir = tempDir()
    const trashed: string[] = []
    const store = new MeetingStore(dir, async (p) => {
      trashed.push(p)
      rmSync(p, { force: true })
    })
    await store.init()
    const m = await store.create({})
    await store.flush()
    await store.delete(m.id)
    expect(trashed).toHaveLength(1)
    expect(readdirSync(dir).filter((f) => f.endsWith('.json'))).toHaveLength(0)
    expect(store.list()).toHaveLength(0)
  })

  it('makes snippets around the first match', () => {
    expect(makeSnippet('a '.repeat(100) + 'needle here', ['needle'], 10)).toBe('…a a a a a needle her…')
  })
})

describe('settings', () => {
  it('deep merges patches without touching other fields', () => {
    const base = defaultSettings()
    const next = deepMerge(base, { ai: { providers: { anthropic: { model: 'x' } } }, calendars: [] })
    expect(next.ai.providers.anthropic.model).toBe('x')
    expect(next.ai.providers.anthropic.baseUrl).toBe(base.ai.providers.anthropic.baseUrl)
    expect(next.ai.provider).toBe(base.ai.provider)
  })

  it('fills new defaults into old settings files', () => {
    const merged = mergeSettings(defaultSettings(), { userName: 'Ana', transcription: { language: 'pt' } })
    expect(merged.userName).toBe('Ana')
    expect(merged.transcription.language).toBe('pt')
    expect(merged.transcription.model).toBe('large-v3-q5_0')
  })

  it('stores API keys encrypted and never exposes them in the view', async () => {
    const dir = tempDir()
    const cipher = { encrypt: (s: string) => `x:${[...s].reverse().join('')}`, decrypt: (s: string) => [...s.slice(2)].reverse().join('') }
    const store = new SettingsStore(dir, cipher)
    await store.init()
    const view = await store.setKey('openai', ' sk-test ')
    expect(view.keys.openai).toBe(true)
    expect(JSON.stringify(view)).not.toContain('sk-test')
    expect(readFileSync(join(dir, 'secrets.json'), 'utf8')).not.toContain('sk-test')
    expect(store.getKey('openai')).toBe('sk-test')
    await store.setKey('openai', '')
    expect(store.getKey('openai')).toBeUndefined()
  })
})
