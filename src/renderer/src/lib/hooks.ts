import { useEffect, useState } from 'react'
import type { RecordingState } from '@shared/types'

/** Re-renders every `ms` milliseconds while `active`. */
export function useTicker(active: boolean, ms = 1000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    const t = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(t)
  }, [active, ms])
  return now
}

export function elapsedMs(rec: RecordingState, now: number): number {
  return rec.priorDurationMs + (rec.sessionStartedAt ? Math.max(0, now - rec.sessionStartedAt) : 0)
}
