import type { Importance, Priority, TaskDef, TaskKind, TaskStatus, UserProgress, Vacancy } from '../types'
import { getAvailability, getTaskProgress, isPracticeTask, taskImportance, type CurriculumIndex } from './progress'

export interface TaskFilterState {
  track: string
  status: TaskStatus | ''
  priority: Priority | ''
  importance: Importance | 'none' | ''
  /** practice — все практические задачи: упражнения, лабораторные, интеграции */
  kind: TaskKind | 'practice' | ''
  env: '' | 'only' | 'exclude'
  ready: boolean
  query: string
}

export const EMPTY_FILTERS: TaskFilterState = {
  track: '',
  status: '',
  priority: '',
  importance: '',
  kind: '',
  env: '',
  ready: false,
  query: '',
}

export function isFilterActive(f: TaskFilterState): boolean {
  return Object.entries(f).some(([k, v]) => v !== EMPTY_FILTERS[k as keyof TaskFilterState])
}

export function filterTasks(
  tasks: TaskDef[],
  f: TaskFilterState,
  idx: CurriculumIndex,
  p: UserProgress,
  vacancy: Vacancy,
): TaskDef[] {
  const q = f.query.trim().toLowerCase()
  return tasks.filter((task) => {
    if (f.track && task.trackId !== f.track) return false
    if (f.status && getTaskProgress(p, task.id).status !== f.status) return false
    if (f.priority && task.priority !== f.priority) return false
    if (f.kind && (f.kind === 'practice' ? !isPracticeTask(task) : task.kind !== f.kind)) return false
    if (f.env === 'only' && !task.environmentDependency) return false
    if (f.env === 'exclude' && task.environmentDependency) return false
    if (f.importance) {
      const imp = taskImportance(task, vacancy, idx)
      if (f.importance === 'none' ? imp !== null : imp !== f.importance) return false
    }
    if (f.ready && getAvailability(task, idx, p) !== 'ready') return false
    if (q) {
      const hay = `${task.id} ${task.title} ${task.description} ${task.tags.join(' ')}`.toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })
}
