import { Cpu, SearchX } from 'lucide-react'
import { RoadmapMap } from '../components/RoadmapMap'
import { RoadmapTabs } from '../components/SectionTabs'
import { TaskFilters } from '../components/TaskFilters'
import { TaskRow } from '../components/TaskRow'
import { TrackCompletion } from '../components/TrackCompletion'
import { TrackTiming } from '../components/TaskTiming'
import { Badge, Card, EmptyState, InfoTip, PageHeader } from '../components/ui'
import { EMPTY_FILTERS, filterTasks, isFilterActive, type TaskFilterState } from '../lib/filters'
import { completedTrack } from '../lib/confirmedState'
import { summarize, tasksForTrackProgress, trackDependencies } from '../lib/progress'
import { useStore } from '../state/context'
import { replaceRoute, useRoute } from '../state/router'
import { useLocalState } from '../state/useLocalState'

export function RoadmapPage() {
  const { curriculum, idx, progress, vacancy } = useStore()
  const route = useRoute()
  const [local, setLocal] = useLocalState<TaskFilterState>('roadmap.filters', EMPTY_FILTERS)
  const filters: TaskFilterState = { ...local, track: route.params.get('track') ?? '' }

  const onChange = (f: TaskFilterState) => {
    setLocal({ ...f, track: '' })
    if (f.track !== filters.track) {
      const params = Object.fromEntries(route.params.entries())
      replaceRoute('roadmap', { ...params, track: f.track || undefined })
    }
  }

  const visible = filterTasks(curriculum.tasks, filters, idx, progress, vacancy)
  const visibleIds = new Set(visible.map((t) => t.id))
  const active = isFilterActive(filters)

  return (
    <div>
      <PageHeader
        eyebrow="Учиться"
        title="Дорожная карта"
        actions={<RoadmapTabs active="roadmap" />}
        description={
          <>
            Маршрут к роли: треки по порядку, у каждого — какую рабочую задачу он закрывает.{' '}
            <InfoTip label="Как открываются задачи">
              Задача становится «Можно начинать», когда засчитаны все предыдущие задачи.
              Лабораторные, зависящие от окружения и отмеченные «Заблокировано», следующие не
              блокируют. Нажмите на трек — ниже останутся только его задачи.
            </InfoTip>
          </>
        }
      />

      <RoadmapMap
        selectedTrack={filters.track}
        onSelect={(track) => onChange({ ...filters, track })}
      />

      <TaskFilters value={filters} onChange={onChange} resultCount={visible.length} />

      {visible.length === 0 && (
        <EmptyState icon={<SearchX size={22} />} title="Нет задач под выбранные фильтры" />
      )}

      <div className="space-y-6">
        {curriculum.tracks.map((track) => {
          const tasks = (idx.tasksByTrack.get(track.id) ?? []).filter((t) => visibleIds.has(t.id))
          if (tasks.length === 0) return null
          const s = summarize(tasksForTrackProgress(track, idx), progress)
          const deps = trackDependencies(track, idx)
          return (
            <Card
              key={track.id}
              title={
                <span className="flex flex-wrap items-center gap-2">
                  <span className="grid h-7 w-7 place-items-center rounded-lg bg-accent/12 text-xs font-bold text-accent">
                    {track.code}
                  </span>
                  <span>{track.title}</span>
                  {track.kind === 'fundamentals' && (
                    <Badge tone="violet">Параллельный фундамент</Badge>
                  )}
                  {track.kind === 'advanced' && (
                    <Badge tone="violet" className="whitespace-normal!">Продвинутое · не входит в соответствие роли</Badge>
                  )}
                </span>
              }
              subtitle={track.workProblem ?? track.goal}
              action={
                <div className="ml-auto flex shrink-0 items-center gap-1.5 text-sm font-semibold text-fg tabular-nums">
                  Засчитано {s.verified} из {s.taskCount + s.envSkipped}
                  <InfoTip label={`Как считается прогресс трека ${track.code}`}>
                    Счётчик — засчитанные задачи из всех задач этого трека
                    {track.kind === 'core' ? ' без необязательных' : ''}.
                    Процент прогресса обучения взвешенный: трудоёмкая практика влияет сильнее чтения.
                    Задачи, исключённые по окружению, остаются в «всего», но не входят во взвешенный процент.
                    Веса и время можно посмотреть в «Подробнее» карточки задачи.
                  </InfoTip>
                </div>
              }
            >
              {completedTrack(track, curriculum, progress) && <TrackCompletion track={track} />}
              <details className="mb-4 text-xs text-muted">
                <summary className="cursor-pointer hover:text-fg">Планирование времени трека</summary>
                <div className="mt-2">
                  <TrackTiming tasks={idx.tasksByTrack.get(track.id) ?? []} progress={progress} />
                </div>
              </details>
              {!active && (
                <div className="mb-4 grid gap-4 lg:grid-cols-3">
                  <div className="lg:col-span-2">
                    <p className="mb-3 text-xs text-muted">
                      Предпосылки:{' '}
                      {track.entryRequirements?.join(' · ') || 'Смотрите предыдущие задачи'}
                    </p>
                    <div className="mb-2 text-xs font-semibold tracking-wider text-subtle uppercase">
                      Темы
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {track.topics.map((t) => (
                        <span
                          key={t}
                          className="rounded-md bg-surface-2 px-2 py-0.5 text-xs text-muted"
                        >
                          {t}
                        </span>
                      ))}
                    </div>
                    {deps.length > 0 && (
                      <div className="mt-2 text-xs text-muted">
                        Зависит от треков:{' '}
                        {deps
                          .map(
                            (d) => `${idx.trackById.get(d)?.code} ${idx.trackById.get(d)?.title}`,
                          )
                          .join(', ')}
                      </div>
                    )}
                    {track.note && (
                      <div className="mt-3 flex gap-2 rounded-lg bg-surface-2/60 px-3 py-2 text-xs text-muted">
                        <Cpu size={13} className="mt-0.5 shrink-0 text-violet" />
                        <span>
                          Условия трека{' '}
                          <InfoTip label={`Условия трека ${track.code}`}>{track.note}</InfoTip>
                        </span>
                      </div>
                    )}
                  </div>
                  <div>
                    <div className="mb-2 text-xs font-semibold tracking-wider text-subtle uppercase">
                      Критерии приёмки трека
                    </div>
                    <ul className="list-disc space-y-0.5 pl-4 text-xs text-muted">
                      {track.acceptanceCriteria.map((c) => (
                        <li key={c}>{c}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}
              <div className="-mx-3 divide-y divide-line/60">
                {tasks.map((t) => (
                  <TaskRow key={t.id} task={t} />
                ))}
              </div>
            </Card>
          )
        })}
      </div>
    </div>
  )
}
