import { X } from 'lucide-react'
import { useEffect, useState, type ComponentProps, type ReactNode } from 'react'
import { TONE_TEXT, type Tone } from '../lib/labels'

const cx = (...xs: (string | false | null | undefined)[]) => xs.filter(Boolean).join(' ')

const TONE_BADGE: Record<Tone, string> = {
  neutral: 'bg-surface-2 text-muted border-line',
  accent: 'bg-accent/10 text-accent border-accent/25',
  ok: 'bg-ok/10 text-ok border-ok/25',
  warn: 'bg-warn/10 text-warn border-warn/25',
  bad: 'bg-bad/10 text-bad border-bad/25',
  info: 'bg-info/10 text-info border-info/25',
  violet: 'bg-violet/10 text-violet border-violet/25',
}

const TONE_BAR: Record<Tone, string> = {
  neutral: 'bg-subtle',
  accent: 'bg-accent',
  ok: 'bg-ok',
  warn: 'bg-warn',
  bad: 'bg-bad',
  info: 'bg-info',
  violet: 'bg-violet',
}

export function Badge({ tone = 'neutral', children, className, title }: { tone?: Tone; children: ReactNode; className?: string; title?: string }) {
  return (
    <span
      title={title}
      // Оптическая поправка для Onest в компактной строке бейджа.
      className={cx('inline-flex items-center gap-1 whitespace-nowrap rounded-md border px-1.5 pt-[3px] pb-px text-[12px] font-medium leading-none', TONE_BADGE[tone], className)}
    >
      {children}
    </span>
  )
}

export function Card({ children, className, title, action, subtitle }: { children: ReactNode; className?: string; title?: ReactNode; subtitle?: ReactNode; action?: ReactNode }) {
  return (
    // min-w-0: в сетке карточка сжимается по ширине экрана, даже если внутри длинный текст с truncate
    // Карточка отделяется фоном, а не рамкой; заголовок — часть карточки, без разделителя
    <section className={cx('min-w-0 rounded-xl bg-surface shadow-card', className)}>
      {(title || action) && (
        <header className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2 px-5 pt-5">
          {/* на узком экране действие уходит под заголовок, а не сжимает его */}
          <div className="min-w-0 flex-1 basis-44">
            {title && <h2 className="text-base font-semibold text-fg">{title}</h2>}
            {subtitle && <p className="mt-1 text-xs leading-relaxed text-muted">{subtitle}</p>}
          </div>
          {action}
        </header>
      )}
      <div className={title || action ? 'px-5 pt-4 pb-5' : 'p-5'}>{children}</div>
    </section>
  )
}

const TONE_VAR: Record<Tone, string> = {
  neutral: 'var(--subtle)',
  accent: 'var(--accent)',
  ok: 'var(--ok)',
  warn: 'var(--warn)',
  bad: 'var(--bad)',
  info: 'var(--info)',
  violet: 'var(--violet)',
}

/** Кольцо прогресса: доля value (0–1), в центре — children (обычно процент). */
export function Ring({ value, tone = 'accent', size = 72, label, children }: { value: number; tone?: Tone; size?: number; label: string; children?: ReactNode }) {
  const v = Math.max(0, Math.min(1, value))
  return (
    <div
      role="img"
      aria-label={label}
      className="grid shrink-0 place-items-center rounded-full"
      style={{ width: size, height: size, background: `conic-gradient(${TONE_VAR[tone]} ${v * 360}deg, var(--surface-2) 0)` }}
    >
      <div className="grid place-items-center rounded-full bg-surface" style={{ width: size - 12, height: size - 12 }}>
        {children}
      </div>
    </div>
  )
}

/** Подсказка «?»: пояснение открывается по нажатию, а не занимает место на экране. */
export function InfoTip({ children, label = 'Пояснение' }: { children: ReactNode; label?: string }) {
  const [open, setOpen] = useState(false)
  return (
    <span className="relative inline-flex align-middle">
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}
        className="grid h-[22px] w-[22px] shrink-0 place-items-center rounded-full border border-line text-[11px] leading-none font-semibold text-subtle hover:border-accent/50 hover:text-accent"
      >
        ?
      </button>
      {open && (
        <span role="note" className="absolute top-7 right-0 z-30 w-72 max-w-[80vw] rounded-lg bg-surface-2 p-3 text-xs leading-relaxed font-normal text-fg normal-case shadow-lg ring-1 ring-line">
          {children}
        </span>
      )}
    </span>
  )
}

export function ProgressBar({ value, tone = 'accent', className, size = 'md' }: { value: number; tone?: Tone; className?: string; size?: 'sm' | 'md' }) {
  const v = Math.max(0, Math.min(1, value))
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(v * 100)}
      className={cx('w-full overflow-hidden rounded-full bg-surface-2', size === 'sm' ? 'h-1.5' : 'h-2', className)}
    >
      <div className={cx('h-full rounded-full', TONE_BAR[tone])} style={{ width: `${v * 100}%` }} />
    </div>
  )
}

export function Button({
  variant = 'secondary',
  size = 'md',
  className,
  children,
  ...rest
}: ComponentProps<'button'> & { variant?: 'primary' | 'secondary' | 'ghost' | 'danger'; size?: 'sm' | 'md' | 'lg' }) {
  const variants = {
    primary: 'bg-accent text-bg hover:opacity-90 border-transparent font-semibold shadow-sm',
    secondary: 'bg-surface-2 text-fg border-line hover:border-subtle',
    ghost: 'bg-transparent text-muted border-transparent hover:text-fg hover:bg-surface-2',
    danger: 'bg-bad/10 text-bad border-bad/30 hover:bg-bad/20',
  }
  return (
    <button
      type="button"
      className={cx(
        'inline-flex items-center justify-center gap-1.5 border transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        size === 'sm' ? 'rounded-md px-2.5 py-1 text-xs' : size === 'lg' ? 'rounded-xl px-5 py-2.5 text-[15px]' : 'rounded-lg px-3.5 py-2 text-sm',
        variants[variant],
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  )
}

export function PageHeader({ title, description, actions, eyebrow }: { title: string; description?: ReactNode; actions?: ReactNode; eyebrow?: ReactNode }) {
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {eyebrow && <div className="mb-2 text-xs font-semibold tracking-[0.14em] text-subtle uppercase">{eyebrow}</div>}
        <h1 className="text-[28px] leading-tight font-bold tracking-tight text-fg sm:text-[32px]">{title}</h1>
        {description && <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

export function Stat({ label, value, hint, tone = 'neutral', children }: { label: string; value: ReactNode; hint?: ReactNode; tone?: Tone; children?: ReactNode }) {
  return (
    <div className="rounded-xl bg-surface p-5 shadow-card">
      <div className="text-xs font-semibold tracking-wider text-subtle uppercase">{label}</div>
      <div className={cx('mt-2 text-3xl font-semibold tabular-nums', TONE_TEXT[tone])}>{value}</div>
      {children && <div className="mt-2">{children}</div>}
      {hint && <div className="mt-1.5 text-xs text-muted">{hint}</div>}
    </div>
  )
}

export function EmptyState({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-line px-6 py-12 text-center">
      {/* иконка в мягком круге: пустое состояние читается как подсказка, а не как ошибка */}
      {icon && <div className="mb-4 grid h-12 w-12 place-items-center rounded-2xl bg-surface-2 text-subtle">{icon}</div>}
      <div className="text-base font-semibold text-fg">{title}</div>
      {children && <div className="mt-1 max-w-md text-sm text-muted">{children}</div>}
    </div>
  )
}

export function Drawer({ open, onClose, children, title }: { open: boolean; onClose: () => void; children: ReactNode; title: ReactNode }) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [open, onClose])

  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} aria-hidden />
      <aside role="dialog" aria-modal="true" className="relative flex h-full w-full max-w-3xl flex-col border-l border-line bg-bg shadow-2xl">
        <header className="flex items-start justify-between gap-4 border-b border-line/60 px-5 py-5 sm:px-7">
          <div className="min-w-0 flex-1">{title}</div>
          <Button variant="ghost" size="sm" onClick={onClose} aria-label="Закрыть">
            <X size={16} />
          </Button>
        </header>
        <div className="scrollbar-thin flex-1 overflow-y-auto px-5 py-6 sm:px-7">{children}</div>
      </aside>
    </div>
  )
}

export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  size = 'md',
}: {
  value: T | null
  options: { value: T; label: string; tone?: Tone }[]
  onChange: (v: T) => void
  size?: 'sm' | 'md'
}) {
  return (
    <div className="inline-flex flex-wrap gap-1 rounded-lg bg-surface-2 p-1">
      {options.map((o) => {
        const active = o.value === value
        return (
          <button
            key={String(o.value)}
            type="button"
            onClick={() => onChange(o.value)}
            aria-pressed={active}
            className={cx(
              'rounded-md border px-2.5 transition-colors',
              size === 'sm' ? 'py-0.5 text-[12px]' : 'py-1 text-xs',
              active ? cx('font-medium', o.tone === 'neutral' ? 'border-subtle bg-surface text-fg' : TONE_BADGE[o.tone ?? 'accent']) : 'border-transparent text-muted hover:text-fg',
            )}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}
