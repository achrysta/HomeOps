import { getVerification } from './progress'
import type { TaskDef, TaskProgress, TaskTiming, UserProgress } from '../types'
import { taskEstimates } from '../data/taskEstimates'

export function normalizeTiming(raw: unknown): TaskTiming | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const r = raw as Partial<TaskTiming>
  const start = typeof r.startedAt === 'string' ? Date.parse(r.startedAt) : NaN
  if (!Number.isFinite(start)) return undefined
  const end = typeof r.firstVerifiedAt === 'string' ? Date.parse(r.firstVerifiedAt) : NaN
  return { startedAt: r.startedAt!, ...(Number.isFinite(end) && end >= start ? { firstVerifiedAt: r.firstVerifiedAt } : {}) }
}

/** Первая дата фиксируется только при новом событии; импорт и старые отметки время не создают. */
export function recordTiming(task: TaskDef | undefined, before: TaskProgress, after: TaskProgress, now: string): TaskProgress {
  if (!task) return after
  let timing = after.timing
  if (!timing && before.status !== 'in_progress' && after.status === 'in_progress') timing = { startedAt: now }
  if (timing && !timing.firstVerifiedAt && getVerification(task, before) !== 'verified' && getVerification(task, after) === 'verified' && Date.parse(now) >= Date.parse(timing.startedAt)) timing = { ...timing, firstVerifiedAt: now }
  return timing === after.timing ? after : { ...after, timing }
}

export function elapsedMinutes(timing: TaskTiming | undefined): number | null {
  if (!timing?.firstVerifiedAt) return null
  const value = (Date.parse(timing.firstVerifiedAt) - Date.parse(timing.startedAt)) / 60_000
  return Number.isFinite(value) && value >= 0 ? value : null
}

export function formatMinutes(n: number): string {
  if (n < 1) return 'меньше минуты'
  const minutes = Math.round(n)
  if (minutes < 60) return `${minutes} мин`
  const days = Math.floor(minutes / 1440)
  const hours = Math.floor((minutes % 1440) / 60)
  const rest = minutes % 60
  return [days ? `${days} дн` : '', hours ? `${hours} ч` : '', rest ? `${rest} мин` : ''].filter(Boolean).join(' ')
}

export function trackTime(tasks: readonly TaskDef[], p: UserProgress) {
  const required = tasks
  const measured = required.flatMap((t) => {
    const tp = p.tasks[t.id]
    const n = elapsedMinutes(tp?.timing)
    return tp && getVerification(t, tp) === 'verified' && n !== null ? [n] : []
  })
  return { min: required.reduce((n,t)=>n+(taskEstimates[t.id]?.minMinutes??0),0), max: required.reduce((n,t)=>n+(taskEstimates[t.id]?.maxMinutes??0),0), actual: measured.reduce((n,v)=>n+v,0), measured: measured.length, total: required.length }
}
