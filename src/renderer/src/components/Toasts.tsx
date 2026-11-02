import clsx from 'clsx'
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react'
import { useApp } from '../lib/store'

export function Toasts() {
  const toasts = useApp((s) => s.toasts)
  const dismiss = useApp((s) => s.dismissToast)
  return (
    <div className="pointer-events-none fixed bottom-24 right-5 z-[60] flex w-[360px] flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={clsx(
            'pointer-events-auto flex items-start gap-2.5 rounded-xl border bg-card px-3.5 py-3 text-[13px] shadow-lg',
            t.kind === 'error' ? 'border-danger/40' : 'border-edge'
          )}
        >
          {t.kind === 'error' ? (
            <AlertCircle className="mt-0.5 size-4 flex-none text-danger" />
          ) : t.kind === 'success' ? (
            <CheckCircle2 className="mt-0.5 size-4 flex-none text-accent" />
          ) : (
            <Info className="mt-0.5 size-4 flex-none text-muted" />
          )}
          <div className="min-w-0 flex-1 break-words leading-snug">{t.message}</div>
          <button onClick={() => dismiss(t.id)} className="text-faint hover:text-ink">
            <X className="size-3.5" />
          </button>
        </div>
      ))}
    </div>
  )
}
