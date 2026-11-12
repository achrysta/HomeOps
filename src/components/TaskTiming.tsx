import { Clock3 } from 'lucide-react'
import { taskEstimates, DIFFICULTY_LABEL } from '../data/taskEstimates'
import { elapsedMinutes, formatMinutes, trackTime } from '../lib/timing'
import { getVerification } from '../lib/progress'
import type { TaskDef, TaskProgress, UserProgress } from '../types'
import { InfoTip } from './ui'

export function TaskTiming({
  task,
  progress,
  compact = false,
}: {
  task: TaskDef
  progress: TaskProgress
  compact?: boolean
}) {
  const estimate = taskEstimates[task.id]
  const actual = elapsedMinutes(progress.timing)
  if (!estimate) return null
  return (
    <span
      className={`flex flex-wrap items-center gap-x-2 gap-y-1 ${compact ? 'text-[11px] text-subtle' : 'text-xs text-muted'}`}
    >
      <Clock3 size={12} />
      <span>
        {DIFFICULTY_LABEL[estimate.level]} · оценка {formatMinutes(estimate.minMinutes)}–
        {formatMinutes(estimate.maxMinutes)}
      </span>
      {actual !== null && (
        <span className={getVerification(task, progress) === 'verified' ? 'text-ok' : 'text-muted'}>
          {getVerification(task, progress) === 'verified' ? 'Первый зачёт' : 'Предыдущий зачёт'}:{' '}
          {formatMinutes(actual)}
        </span>
      )}
      {!compact && (
        <InfoTip label="Как считается время">
          Оценка — ориентир для планирования. Фактическое время — календарный промежуток от первого
          перевода в «В работе» до первого зачёта, включая перерывы и блокировки. Ручное «Выполнено»
          отсчёт не заканчивает. Старые даты не восстанавливаются; снятие зачёта не переписывает
          историю.
        </InfoTip>
      )}
      {!compact && actual === null && (
        <span>
          {progress.timing
            ? 'Начато ' + new Date(progress.timing.startedAt).toLocaleString('ru-RU')
            : 'Фактическое время не измерено'}
        </span>
      )}
    </span>
  )
}

export function TrackTiming({ tasks, progress }: { tasks: TaskDef[]; progress: UserProgress }) {
  const t = trackTime(tasks, progress)
  if (!t.total) return null
  return (
    <p className="mb-4 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
      <Clock3 size={13} />
      <span>
        Все задачи трека: {formatMinutes(t.min)}–{formatMinutes(t.max)}
      </span>
      {t.measured > 0 && (
        <span>
          Первый зачёт {t.measured}/{t.total} задач: {formatMinutes(t.actual)}
        </span>
      )}
      <InfoTip label="Сумма времени трека">
        Сумма начальных оценок всех задач трека, включая необязательные. Фактическая сумма включает
        только задачи, засчитанные сейчас и имеющие сохранённые даты старта и первого зачёта;
        календарные перерывы входят в длительность.
      </InfoTip>
    </p>
  )
}
