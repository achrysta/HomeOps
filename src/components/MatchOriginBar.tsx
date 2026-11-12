import { pct } from '../lib/labels'
import type { MatchOrigin } from '../lib/progress'

const PARTS: { key: keyof MatchOrigin; label: string; bar: string; hint: string }[] = [
  { key: 'practice', label: 'подтверждено задачами', bar: 'bg-ok', hint: 'Засчитанные лабораторные, интеграции и тесты' },
  { key: 'baseline', label: 'исходный опыт', bar: 'bg-info', hint: 'Стартовые уровни программы' },
  { key: 'self', label: 'самооценка', bar: 'bg-violet', hint: 'Скорректированные вами уровни с обоснованием' },
]

/** Полоса соответствия роли, разложенная по источникам уровня навыков. */
export function MatchOriginBar({ origin, compact = false }: { origin: MatchOrigin; compact?: boolean }) {
  return (
    <div>
      <div className="flex h-2 w-full overflow-hidden rounded-full bg-surface-2" role="img" aria-label="Из чего складывается соответствие роли">
        {PARTS.map((p) =>
          origin[p.key] > 0 ? <div key={p.key} className={p.bar} style={{ width: `${origin[p.key] * 100}%` }} title={`${p.label}: ${pct(origin[p.key])}`} /> : null,
        )}
      </div>
      <div className={`mt-2 flex flex-wrap gap-x-3 gap-y-1 ${compact ? 'text-[11px]' : 'text-xs'} text-muted`}>
        {PARTS.filter((p) => p.key !== 'baseline' || origin.baseline > 0).map((p) => (
          <span key={p.key} className="inline-flex items-center gap-1.5" title={p.hint}>
            <span className={`h-2 w-2 rounded-full ${p.bar}`} />
            {p.label} <span className="font-mono text-fg tabular-nums">{pct(origin[p.key])}</span>
          </span>
        ))}
      </div>
    </div>
  )
}
