import { ArrowRight } from 'lucide-react'
import { completedTrack } from '../lib/confirmedState'
import { getTaskProgress, getVerification } from '../lib/progress'
import { roadmapTrack } from '../lib/roadmapMap'
import { useStore } from '../state/context'
import { setTaskParam } from '../state/router'
import type { Track } from '../types'
import { TrackCompletion } from './TrackCompletion'
import { Badge, Card, InfoTip } from './ui'

export function RoadmapMap({
  selectedTrack,
  onSelect,
}: {
  selectedTrack: string
  onSelect: (id: string) => void
}) {
  const { curriculum, idx, progress } = useStore()
  const core = curriculum.tracks.filter((t) => t.kind === 'core')
  const side = curriculum.tracks.filter((t) => t.kind !== 'core')
  const optional = curriculum.tasks.filter(
    (t) => t.optional && idx.trackById.get(t.trackId)?.kind === 'core',
  )
  const node = (track: Track, step?: number) => {
    const { total, summary, dependencies } = roadmapTrack(track, idx, progress)
    const selected = selectedTrack === track.id
    return (
      <div key={track.id} className="flex min-w-0 flex-col self-start">
        <button
          type="button"
          aria-pressed={selected}
          onClick={() => onSelect(selected ? '' : track.id)}
          className={`flex min-w-0 flex-1 flex-col rounded-xl bg-surface p-4 text-left shadow-card hover:ring-1 hover:ring-accent/40 ${selected ? 'ring-2 ring-accent' : ''}`}
        >
          <span className="flex items-center justify-between gap-2">
            <span className="grid h-7 w-7 place-items-center rounded-lg bg-accent/12 text-xs font-bold text-accent">
              {track.code}
            </span>
            <span className="text-xs text-subtle">
              {step
                ? `шаг ${step}`
                : track.kind === 'fundamentals'
                  ? 'параллельно'
                  : 'после основного'}
            </span>
          </span>
          <span className="mt-2.5 font-semibold leading-snug text-fg">{track.title}</span>
          <span className="mt-2 text-xs leading-relaxed text-muted">
            {track.workProblem ?? track.goal}
          </span>
          <span className="mt-3 text-xs leading-relaxed text-muted">
            <span className="font-medium text-fg">Предпосылки: </span>
            {track.entryRequirements?.join(' · ') || 'Смотрите предыдущие задачи'}
          </span>
          {dependencies.length > 0 && (
            <span className="mt-1 text-xs text-subtle">
              Связи задач: {dependencies.map((id) => idx.trackById.get(id)?.code).join(', ')}
            </span>
          )}
          <span className="mt-4 text-sm font-semibold text-fg tabular-nums">
            Засчитано {summary.verified} из {total}
          </span>
          {summary.envSkipped > 0 && (
            <span className="mt-1 text-xs text-subtle">
              {summary.envSkipped} исключено по окружению
            </span>
          )}
          {track.kind !== 'core' && (
            <span className="mt-1 text-xs text-subtle">Вне прогресса обучения</span>
          )}
        </button>
        {completedTrack(track, curriculum, progress) && <TrackCompletion track={track} compact />}
      </div>
    )
  }
  return (
    <div className="mb-10 grid items-start gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <section className="min-w-0">
        <h2 className="mb-3 flex items-center justify-between gap-2 text-sm font-semibold text-fg">
          Обязательное{' '}
          <InfoTip label="Счётчики карты">
            В основном маршруте считаются задачи без optional. «Засчитано» требует актуальной
            проверки критериев и подтверждения; тест — сданной попытки. Исключённые по окружению
            остаются в «всего», но не входят во взвешенный процент обучения. Трудоёмкая практика
            влияет на него сильнее чтения; веса и время доступны в «Подробнее» карточки задачи.
            Подсказки предпосылок не меняют реальные
            зависимости задач.
          </InfoTip>
        </h2>
        <div className="grid gap-3 sm:grid-cols-2">{core.map((t, i) => node(t, i + 1))}</div>
      </section>
      <section className="min-w-0">
        <h2 className="mb-3 text-sm font-semibold text-fg">Углубление</h2>
        <div className="space-y-3">{side.map((t) => node(t))}</div>
        {optional.length > 0 && (
          <Card
            className="mt-3"
            title="Необязательная практика"
            subtitle="Не увеличивает основной прогресс обучения"
          >
            <ul className="space-y-3">
              {optional.map((task) => (
                <li key={task.id}>
                  <button
                    type="button"
                    onClick={() => setTaskParam(task.id)}
                    className="flex w-full items-start gap-2 text-left text-xs text-accent hover:underline"
                  >
                    <span className="min-w-0 flex-1">
                      {task.id} · {task.title}
                    </span>
                    <ArrowRight size={13} className="mt-0.5 shrink-0" />
                  </button>
                  {getVerification(task, getTaskProgress(progress, task.id)) === 'verified' && (
                    <Badge tone="ok" className="mt-1">
                      Засчитано
                    </Badge>
                  )}
                </li>
              ))}
            </ul>
          </Card>
        )}
      </section>
    </div>
  )
}
