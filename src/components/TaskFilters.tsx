import { FilterX, Search, SlidersHorizontal } from 'lucide-react'
import { useState } from 'react'
import { EMPTY_FILTERS, isFilterActive, type TaskFilterState } from '../lib/filters'
import { IMPORTANCE_LABEL, KIND_LABEL, STATUS_LABEL } from '../lib/labels'
import { IMPORTANCE_ORDER } from '../lib/progress'
import { useStore } from '../state/context'
import type { Priority, TaskKind, TaskStatus } from '../types'
import { Button } from './ui'

const PRIORITIES: Priority[] = ['P0', 'P1', 'P2', 'P3']
const STATUSES: TaskStatus[] = ['not_started', 'in_progress', 'completed', 'blocked']
const KINDS: TaskKind[] = ['reading', 'exercise', 'lab', 'integration', 'quiz']

export function TaskFilters({
  value,
  onChange,
  showTrack = true,
  resultCount,
}: {
  value: TaskFilterState
  onChange: (v: TaskFilterState) => void
  showTrack?: boolean
  resultCount: number
}) {
  const { curriculum } = useStore()
  const set = <K extends keyof TaskFilterState>(k: K, v: TaskFilterState[K]) => onChange({ ...value, [k]: v })
  const sel = 'field w-auto max-w-full py-1 text-xs'
  const hiddenActive = [value.status, value.priority, value.importance, value.kind, value.env].filter(Boolean).length
  const [more, setMore] = useState(hiddenActive > 0)

  return (
    <div className="mb-5 flex flex-wrap items-center gap-2 rounded-xl bg-surface p-3 shadow-card">
      <div className="relative min-w-48 flex-1">
        <Search size={14} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-subtle" />
        <input
          className="field py-1 pl-8 text-xs"
          placeholder="Фильтр по названию и тегам…"
          value={value.query}
          onChange={(e) => set('query', e.target.value)}
        />
      </div>
      {showTrack && (
        <select className={sel} value={value.track} onChange={(e) => set('track', e.target.value)} aria-label="Трек">
          <option value="">Все треки</option>
          {curriculum.tracks.map((t) => (
            <option key={t.id} value={t.id}>
              {t.code} · {t.title}
            </option>
          ))}
        </select>
      )}
      <label className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-line bg-surface-2 px-2.5 py-1 text-xs text-muted select-none">
        <input type="checkbox" checked={value.ready} onChange={(e) => set('ready', e.target.checked)} className="accent-[var(--accent)]" />
        Можно начинать
      </label>
      <Button size="sm" variant="ghost" onClick={() => setMore(!more)} aria-expanded={more}>
        <SlidersHorizontal size={13} /> Ещё фильтры{hiddenActive ? ` · ${hiddenActive}` : ''}
      </Button>
      <span className="ml-auto text-xs text-subtle tabular-nums">{resultCount} задач</span>
      {more && (
        <div className="flex w-full flex-wrap items-center gap-2 border-t border-line pt-2">
        <select className={sel} value={value.status} onChange={(e) => set('status', e.target.value as TaskStatus | '')} aria-label="Статус">
          <option value="">Любой статус</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s]}
            </option>
          ))}
        </select>
        <select className={sel} value={value.priority} onChange={(e) => set('priority', e.target.value as Priority | '')} aria-label="Приоритет">
          <option value="">Любой приоритет</option>
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <select className={sel} value={value.importance} onChange={(e) => set('importance', e.target.value as TaskFilterState['importance'])} aria-label="Важность">
          <option value="">Любая важность</option>
          {IMPORTANCE_ORDER.map((i) => (
            <option key={i} value={i}>
              {IMPORTANCE_LABEL[i]}
            </option>
          ))}
          <option value="none">Без связи с ролью</option>
        </select>
        <select className={sel} value={value.kind} onChange={(e) => set('kind', e.target.value as TaskFilterState['kind'])} aria-label="Тип">
          <option value="">Любой тип</option>
          <option value="practice">Вся практика</option>
          {KINDS.map((k) => (
            <option key={k} value={k}>
              {KIND_LABEL[k]}
            </option>
          ))}
        </select>
        <select className={sel} value={value.env} onChange={(e) => set('env', e.target.value as TaskFilterState['env'])} aria-label="Окружение">
          <option value="">Любое окружение</option>
          <option value="only">Только зависящие от окружения</option>
          <option value="exclude">Без зависящих от окружения</option>
        </select>
        </div>
      )}
      {isFilterActive(value) && (
        <Button size="sm" variant="ghost" onClick={() => onChange(EMPTY_FILTERS)}>
          <FilterX size={13} /> Сбросить
        </Button>
      )}
    </div>
  )
}
