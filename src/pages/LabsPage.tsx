import { ArrowDownUp, Paperclip, SearchX } from 'lucide-react'
import { useState } from 'react'
import { AvailabilityBadge, EnvBadge, ImportanceBadge, KindBadge, PriorityBadge, StatusBadge, VerificationBadge } from '../components/badges'
import { RoadmapTabs } from '../components/SectionTabs'
import { TaskFilters } from '../components/TaskFilters'
import { StatusIcon } from '../components/TaskRow'
import { EmptyState, PageHeader } from '../components/ui'
import { EMPTY_FILTERS, filterTasks, type TaskFilterState } from '../lib/filters'
import { getAvailability, getTaskProgress, getVerification, IMPORTANCE_ORDER, taskImportance, taskWeight } from '../lib/progress'
import { useStore } from '../state/context'
import { replaceRoute, setTaskParam, useRoute } from '../state/router'
import { useLocalState } from '../state/useLocalState'
import type { TaskDef, TaskKind } from '../types'

const KIND_IDS: TaskKind[] = ['reading', 'exercise', 'lab', 'integration', 'quiz']

type SortKey = 'roadmap' | 'priority' | 'importance' | 'weight'

export function LabsPage() {
  const { curriculum, idx, progress, vacancy } = useStore()
  const [stored, setStored] = useLocalState<TaskFilterState>('labs.filters', { ...EMPTY_FILTERS })
  const { params } = useRoute()
  // ?kind=practice&status=completed из ссылок «Сегодня» — поверх сохранённых фильтров, пока их не поменяли
  const linkedKind = params.get('kind')
  const linked = linkedKind === 'practice' || KIND_IDS.includes(linkedKind as TaskKind) ? (linkedKind as TaskFilterState['kind']) : null
  const linkedStatus = params.get('status') === 'completed' ? ('completed' as const) : null
  const filters: TaskFilterState = { ...stored, ...(linked ? { kind: linked } : {}), ...(linkedStatus ? { status: linkedStatus } : {}) }
  const practice = filters.kind === 'practice'
  const setFilters = (next: TaskFilterState) => {
    setStored(next)
    const rest = Object.fromEntries(params.entries())
    if (linked && next.kind !== linked) delete rest.kind
    if (linkedStatus && next.status !== linkedStatus) delete rest.status
    if (Object.keys(rest).length !== [...params.keys()].length) replaceRoute('labs', rest)
  }
  const [sort, setSort] = useState<SortKey>('roadmap')

  const order = new Map(curriculum.tasks.map((t, i) => [t.id, i]))
  const trackOrder = (t: TaskDef) => idx.trackById.get(t.trackId)?.order ?? 0
  const impRank = (t: TaskDef) => {
    const imp = taskImportance(t, vacancy, idx)
    return imp ? IMPORTANCE_ORDER.indexOf(imp) : 9
  }
  const compare: Record<SortKey, (a: TaskDef, b: TaskDef) => number> = {
    roadmap: (a, b) => trackOrder(a) - trackOrder(b) || order.get(a.id)! - order.get(b.id)!,
    priority: (a, b) => a.priority.localeCompare(b.priority) || trackOrder(a) - trackOrder(b),
    importance: (a, b) => impRank(a) - impRank(b) || a.priority.localeCompare(b.priority),
    weight: (a, b) => taskWeight(b) - taskWeight(a) || a.priority.localeCompare(b.priority),
  }
  const tasks = filterTasks(curriculum.tasks, filters, idx, progress, vacancy).sort(compare[sort])

  return (
    <div>
      <PageHeader eyebrow="Учиться"
        title={practice ? 'Практические задачи' : 'Дорожная карта'}
        description={practice ? 'Упражнения, лабораторные и интеграции программы: засчитываются по критериям приёмки и подтверждениям.' : 'Все задачи программы одной таблицей — удобно сортировать и фильтровать.'}
        actions={
          <>
          <RoadmapTabs active="labs" />
          <label className="flex items-center gap-2 text-xs text-muted">
            <ArrowDownUp size={14} />
            <select className="field w-auto py-1 text-xs" value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
              <option value="roadmap">По дорожной карте</option>
              <option value="priority">По приоритету</option>
              <option value="importance">По важности для роли</option>
              <option value="weight">По весу</option>
            </select>
          </label>
          </>
        }
      />
      <TaskFilters value={filters} onChange={setFilters} resultCount={tasks.length} />

      {tasks.length === 0 ? (
        <EmptyState icon={<SearchX size={22} />} title="Нет задач под выбранные фильтры" />
      ) : (
        <div className="overflow-x-auto rounded-xl bg-surface shadow-card">
          <table className="w-full min-w-[1000px] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-[11px] tracking-wide text-subtle uppercase">
                <th className="w-8 px-3 py-2" />
                <th className="px-2 py-2 font-medium">ID</th>
                <th className="px-2 py-2 font-medium">Задача</th>
                <th className="px-2 py-2 font-medium">Трек</th>
                <th className="px-2 py-2 font-medium">Тип</th>
                <th className="px-2 py-2 font-medium">Приор.</th>
                <th className="px-2 py-2 font-medium">Важность</th>
                <th className="px-2 py-2 font-medium">Статус</th>
                <th className="px-3 py-2 font-medium">Подтв.</th>
              </tr>
            </thead>
            <tbody>
              {tasks.map((t) => {
                const tp = getTaskProgress(progress, t.id)
                const track = idx.trackById.get(t.trackId)
                const availability = getAvailability(t, idx, progress)
                return (
                  <tr key={t.id} onClick={() => setTaskParam(t.id)} className="cursor-pointer border-b border-line/60 align-top last:border-0 hover:bg-surface-2/60">
                    <td className="px-3 py-2.5">
                      <StatusIcon task={t} />
                    </td>
                    <td className="px-2 py-2.5 font-mono text-xs text-subtle">{t.id}</td>
                    <td className="px-2 py-2.5">
                      <div className="font-medium text-fg">{t.title}</div>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {t.environmentDependency && <EnvBadge />}
                        {t.optional && <span className="text-[11px] text-subtle">необязательно</span>}
                        {(availability === 'ready' || availability === 'locked' || availability === 'env_skipped') && <AvailabilityBadge availability={availability} />}
                      </div>
                    </td>
                    <td className="px-2 py-2.5 text-xs whitespace-nowrap text-muted">
                      {track?.code} · {track?.title}
                    </td>
                    <td className="px-2 py-2.5">
                      <KindBadge kind={t.kind} />
                    </td>
                    <td className="px-2 py-2.5">
                      <PriorityBadge priority={t.priority} />
                    </td>
                    <td className="px-2 py-2.5">
                      <ImportanceBadge importance={taskImportance(t, vacancy, idx)} />
                    </td>
                    <td className="px-2 py-2.5">
                      <div className="flex flex-col items-start gap-1">
                        <StatusBadge status={tp.status} />
                        <VerificationBadge verification={getVerification(t, tp)} />
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-xs text-muted">
                      {tp.evidence.length > 0 ? (
                        <span className="inline-flex items-center gap-1">
                          <Paperclip size={12} /> {tp.evidence.length}
                        </span>
                      ) : (
                        <span className="text-subtle">—</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
