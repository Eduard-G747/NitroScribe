/**
 * True for addresses on this PC or the local network: localhost, loopback, private IPv4 ranges,
 * link-local, IPv6 unique-local, and *.local / *.lan / *.home.arpa names.
 */
export function isLocalUrl(url: string): boolean {
  let host: string
  try {
    host = new URL(url).hostname.toLowerCase().replace(/^\[|\]$/g, '')
  } catch {
    return false
  }
  if (host === 'localhost' || host.endsWith('.localhost') || host === '::1') return true
  if (/\.(local|lan|home\.arpa|internal)$/.test(host)) return true
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host)
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])]
    return a === 127 || a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127)
  }
  return /^f[cd][0-9a-f]{0,2}:/.test(host) || /^fe80:/.test(host)
}

export function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}
