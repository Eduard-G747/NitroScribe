import { EventEmitter } from 'node:events'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import type { UpdateInfo } from '@shared/types'
import { isNewer, parseRepoSlug } from '@shared/version'
import { log } from './util/log'

const DAY = 86_400_000

/** The GitHub repo the app was built from (package.json "repository"). */
function repoSlug(): string | null {
  try {
    const pkg = JSON.parse(readFileSync(join(app.getAppPath(), 'package.json'), 'utf8')) as { repository?: string | { url?: string } }
    return parseRepoSlug(typeof pkg.repository === 'string' ? pkg.repository : (pkg.repository?.url ?? ''))
  } catch {
    return null
  }
}

/**
 * Asks GitHub once a day whether a newer release exists. Only the public "latest release" endpoint is
 * called; nothing about the user or their meetings is sent. Disabled in development builds.
 */
export class UpdateChecker extends EventEmitter {
  latest: UpdateInfo | null = null
  private timer: NodeJS.Timeout | null = null

  constructor(private enabled: () => boolean) {
    super()
  }

  start(): void {
    if (!app.isPackaged) return
    setTimeout(() => void this.check(), 20_000)
    this.timer = setInterval(() => void this.check(), DAY)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
  }

  async check(): Promise<void> {
    const repo = repoSlug()
    if (!repo || !this.enabled()) return
    try {
      const res = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'NitroScribe' },
        signal: AbortSignal.timeout(15_000)
      })
      if (!res.ok) return
      const r = (await res.json()) as { tag_name?: string; html_url?: string; assets?: { name: string; browser_download_url: string }[] }
      const version = (r.tag_name ?? '').replace(/^v/i, '')
      if (!version || !isNewer(version, app.getVersion())) return
      const page = r.html_url?.startsWith('https://github.com/') ? r.html_url : `https://github.com/${repo}/releases/latest`
      const ext = process.platform === 'darwin' ? '.dmg' : '.exe'
      const asset = r.assets?.find((a) => a.name.toLowerCase().endsWith(ext) && a.browser_download_url.startsWith('https://github.com/'))
      const info: UpdateInfo = { version, url: asset?.browser_download_url ?? page, page }
      const isNew = this.latest?.version !== version
      this.latest = info
      if (isNew) log(`update available: ${version}`)
      this.emit('available', info, isNew)
    } catch {
      // Offline or rate-limited: try again tomorrow.
    }
  }
}
