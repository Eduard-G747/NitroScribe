import clsx from 'clsx'
import { Loader2, X } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'solid' | 'pill'

export function Button({
  variant = 'secondary',
  size = 'md',
  className,
  loading,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md'; loading?: boolean }) {
  return (
    <button
      {...props}
      disabled={props.disabled || loading}
      className={clsx(
        'no-drag inline-flex flex-none select-none items-center justify-center gap-1.5 whitespace-nowrap font-medium transition-colors disabled:pointer-events-none disabled:opacity-45',
        size === 'sm' ? 'h-7 px-2.5 text-[12.5px]' : 'h-8 px-3 text-[13px]',
        variant === 'pill' ? 'rounded-full' : 'rounded-lg',
        variant === 'primary' && 'bg-accent text-white hover:brightness-105 dark:text-[#10331f]',
        variant === 'solid' && 'bg-ink text-app hover:opacity-90',
        (variant === 'secondary' || variant === 'pill') && 'border border-edge bg-card text-ink hover:bg-hover',
        variant === 'ghost' && 'text-muted hover:bg-hover hover:text-ink',
        variant === 'danger' && 'border border-edge bg-card text-danger hover:bg-hover',
        className
      )}
    >
      {loading && <Loader2 className="size-3.5 animate-spin" />}
      {children}
    </button>
  )
}

export function IconButton({ className, label, children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      {...props}
      title={label}
      aria-label={label}
      className={clsx('no-drag inline-flex size-7 items-center justify-center rounded-md text-muted transition-colors hover:bg-hover hover:text-ink disabled:opacity-40', className)}
    >
      {children}
    </button>
  )
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={clsx('size-4 animate-spin text-muted', className)} />
}

export function Toggle({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={clsx('relative inline-flex h-5 w-9 flex-none items-center rounded-full transition-colors disabled:opacity-50', checked ? 'bg-accent' : 'bg-active')}
    >
      <span className={clsx('inline-block size-4 rounded-full bg-white shadow transition-transform', checked ? 'translate-x-[18px]' : 'translate-x-0.5')} />
    </button>
  )
}

export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: ReactNode }[]; onChange: (v: T) => void }) {
  return (
    <div className="inline-flex rounded-lg bg-hover p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={clsx('flex h-7 items-center gap-1.5 rounded-md px-3 text-[12.5px] font-medium transition-colors', value === o.value ? 'bg-card text-ink shadow-sm' : 'text-muted hover:text-ink')}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Field({ label, hint, children, inline }: { label: string; hint?: ReactNode; children: ReactNode; inline?: boolean }) {
  if (inline) {
    return (
      <div className="flex items-start justify-between gap-6 py-3">
        <div>
          <div className="text-[13.5px] font-medium">{label}</div>
          {hint && <div className="mt-0.5 text-[12.5px] leading-relaxed text-muted">{hint}</div>}
        </div>
        <div className="flex-none pt-0.5">{children}</div>
      </div>
    )
  }
  return (
    <label className="block py-2.5">
      <div className="mb-1.5 text-[13.5px] font-medium">{label}</div>
      {children}
      {hint && <div className="mt-1.5 text-[12.5px] leading-relaxed text-muted">{hint}</div>}
    </label>
  )
}

const inputClass =
  'w-full rounded-lg border border-edge bg-card px-3 py-2 text-[13.5px] text-ink outline-none transition-shadow placeholder:text-faint focus:border-accent/60 focus:ring-3 focus:ring-accent/15 disabled:opacity-60'

export function TextInput({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={clsx(inputClass, className)} />
}

export function TextArea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={clsx(inputClass, 'resize-y leading-relaxed', className)} />
}

export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...props} className={clsx(inputClass, 'appearance-auto pr-8 [&>optgroup]:bg-card [&>option]:bg-card', className)}>
      {children}
    </select>
  )
}

export function Modal({ open, onClose, children, className, top }: { open: boolean; onClose: () => void; children: ReactNode; className?: string; top?: boolean }) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])
  if (!open) return null
  return (
    <div
      className={clsx('no-drag fixed inset-0 z-50 flex justify-center bg-black/30 p-6 backdrop-blur-[2px] dark:bg-black/50', top ? 'items-start pt-[12vh]' : 'items-center')}
      onMouseDown={onClose}
    >
      <div role="dialog" aria-modal="true" className={clsx('relative max-h-full overflow-hidden rounded-2xl border border-edge bg-app shadow-2xl', className)} onMouseDown={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  )
}

export function CloseButton({ onClick, className }: { onClick: () => void; className?: string }) {
  return (
    <IconButton label="Close" onClick={onClick} className={className}>
      <X className="size-4" />
    </IconButton>
  )
}

/** Dropdown anchored to its trigger; closes on outside click or Escape. */
export function Dropdown({
  trigger,
  children,
  align = 'left',
  side = 'bottom',
  className
}: {
  trigger: (props: { open: boolean; toggle: () => void }) => ReactNode
  children: (close: () => void) => ReactNode
  align?: 'left' | 'right'
  side?: 'top' | 'bottom'
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const [flip, setFlip] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const popover = useRef<HTMLDivElement>(null)
  // Keep the popover inside the window: flip to the other side if it would overflow.
  useLayoutEffect(() => {
    if (!open) return setFlip(false)
    const r = popover.current?.getBoundingClientRect()
    if (r && (r.right > window.innerWidth - 8 || r.left < 8)) setFlip(true)
  }, [open])
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])
  return (
    <div ref={ref} className="no-drag relative">
      {trigger({ open, toggle: () => setOpen((o) => !o) })}
      {open && (
        <div
          ref={popover}
          className={clsx(
            'absolute z-40 min-w-48 overflow-hidden rounded-xl border border-edge bg-card p-1 shadow-xl',
            (align === 'right') !== flip ? 'right-0' : 'left-0',
            side === 'top' ? 'bottom-full mb-2' : 'top-full mt-1.5',
            className
          )}
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  )
}

export function MenuItem({ icon, children, onClick, danger, active, hint }: { icon?: ReactNode; children: ReactNode; onClick: () => void; danger?: boolean; active?: boolean; hint?: string }) {
  return (
    <button
      onClick={onClick}
      className={clsx('flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-[13px] transition-colors hover:bg-hover', danger ? 'text-danger' : 'text-ink', active && 'bg-active')}
    >
      {icon && <span className="flex size-4 flex-none items-center justify-center text-muted">{icon}</span>}
      <span className="min-w-0 flex-1">
        <span className="block truncate">{children}</span>
        {hint && <span className="block truncate text-[11.5px] text-muted">{hint}</span>}
      </span>
    </button>
  )
}

/** Animated audio level bars (the recording indicator). */
export function Bars({ level, active, className }: { level: number; active: boolean; className?: string }) {
  const shape = [0.55, 0.85, 1, 0.75, 0.5]
  const l = active ? Math.min(1, Math.sqrt(level) * 3.2) : 0
  return (
    <span className={clsx('bars inline-flex h-4 items-center gap-[2px]', className)}>
      {shape.map((s, i) => (
        <span key={i} style={{ height: `${Math.max(3, Math.round(16 * Math.max(active ? 0.18 : 0.15, l * s * (0.75 + 0.25 * Math.sin(Date.now() / 120 + i)))))}px` }} />
      ))}
    </span>
  )
}

/** Small time with a lighter AM/PM suffix. */
export function Time({ date, className }: { date: string | Date; className?: string }) {
  const parts = new Date(date).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }).split(/\s+/)
  return (
    <span className={clsx('tabular-nums', className)}>
      {parts[0]}
      {parts[1] && <span className="ml-0.5 text-[0.82em] uppercase opacity-80">{parts[1]}</span>}
    </span>
  )
}

const SPEAKER_COLORS = ['#e0795f', '#5b9bd5', '#c58fd9', '#d6a64b', '#4db6ac', '#e57399', '#8fbf5a', '#9a8cff']

/** A stable color per speaker label. */
export function speakerColor(key: string): string {
  let h = 0
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0
  return SPEAKER_COLORS[h % SPEAKER_COLORS.length]
}

export function Avatar({ name, color, size = 20 }: { name: string; color?: string; size?: number }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('')
  return (
    <span
      className="inline-flex flex-none items-center justify-center rounded-full font-semibold text-white"
      style={{ width: size, height: size, fontSize: size * 0.42, background: color ?? speakerColor(name) }}
    >
      {initials || '?'}
    </span>
  )
}
