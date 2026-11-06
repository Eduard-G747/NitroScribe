import { useCallback, useEffect, useRef, useState } from 'react'
import { onAiStream } from './store'

const clean = (message: string) => message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

/** Runs a streaming AI request (follow-up email, weekly review) and tracks its text. Cancels on unmount. */
export function useAiStream() {
  const [text, setText] = useState('')
  const [status, setStatus] = useState<'idle' | 'writing' | 'done' | 'error'>('idle')
  const [error, setError] = useState('')
  const current = useRef<string | null>(null)

  const cancel = useCallback(() => {
    if (current.current) void window.api.ai.cancel(current.current)
    current.current = null
  }, [])

  const start = useCallback(
    async (begin: () => Promise<string>) => {
      cancel()
      setText('')
      setError('')
      setStatus('writing')
      try {
        const id = await begin()
        current.current = id
        onAiStream(id, (e) => {
          if (current.current !== id) return
          if (e.delta) setText((t) => t + e.delta)
          if (e.error) {
            setError(clean(e.error))
            setStatus('error')
            current.current = null
          } else if (e.done) {
            if (e.text !== undefined) setText(e.text)
            setStatus('done')
            current.current = null
          }
        })
      } catch (err) {
        setError(clean((err as Error).message))
        setStatus('error')
      }
    },
    [cancel]
  )

  useEffect(() => cancel, [cancel])
  return { text, setText, status, error, start, cancel }
}
