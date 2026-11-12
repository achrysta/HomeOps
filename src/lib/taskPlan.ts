import type { TaskDef } from '../types'

/** План присоединяется только к представлению карточки, без изменения каталога и прогресса. */
export function withTaskPlan(task: TaskDef, plans: Readonly<Record<string, string[]>>): TaskDef {
  const steps = plans[task.id] ?? task.steps
  return steps ? { ...task, steps } : task
}
