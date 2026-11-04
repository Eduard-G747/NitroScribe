/** "owner/repo" from a package.json repository URL, e.g. "https://github.com/me/app.git" → "me/app". */
export function parseRepoSlug(url: string): string | null {
  return /github(?:\.com[/:]|:)([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/.exec(url.trim())?.[1] ?? null
}

/** True if `latest` (e.g. "v1.2.0") is a higher version than `current` ("1.1.9"). */
export function isNewer(latest: string, current: string): boolean {
  const parse = (v: string) =>
    v
      .replace(/^v/i, '')
      .split(/[.+-]/)
      .slice(0, 3)
      .map((n) => parseInt(n, 10) || 0)
  const [a, b] = [parse(latest), parse(current)]
  for (let i = 0; i < 3; i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0)
  return false
}
