import { describe, expect, it } from 'vitest'
import { isNewer, parseRepoSlug } from '@shared/version'

describe('update checks', () => {
  it('compares release versions', () => {
    expect(isNewer('v1.0.2', '1.0.1')).toBe(true)
    expect(isNewer('1.1.0', '1.0.9')).toBe(true)
    expect(isNewer('v2.0.0', '1.9.9')).toBe(true)
    expect(isNewer('v1.0.1', '1.0.1')).toBe(false)
    expect(isNewer('1.0.0', '1.0.1')).toBe(false)
    expect(isNewer('v1.2', '1.1.5')).toBe(true)
  })
  it('finds the GitHub repo in package.json', () => {
    expect(parseRepoSlug('https://github.com/Eduard-G747/nitroscribe.git')).toBe('Eduard-G747/nitroscribe')
    expect(parseRepoSlug('git@github.com:me/app.git')).toBe('me/app')
    expect(parseRepoSlug('github:me/app')).toBe('me/app')
    expect(parseRepoSlug('https://gitlab.com/me/app')).toBeNull()
  })
})
