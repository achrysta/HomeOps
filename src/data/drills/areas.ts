import type { DrillArea, DrillGroup } from '../../types'

/** Группы банков в порядке показа: сначала ML/AI-платформа, затем DevOps-база. */
export const DRILL_GROUPS: { id: DrillGroup; title: string; description: string }[] = [
  { id: 'mlops', title: 'MLOps-база', description: 'serving, пайплайны, Kubernetes для ML, агенты, GPU и дообучение' },
  { id: 'devops', title: 'DevOps-база', description: 'Linux, сети, контейнеры, Kubernetes, CI/CD и базы данных' },
]

/** Разделы банков в порядке показа: темы группируются по полю area, разделы — по группе. */
export const DRILL_AREAS: { id: DrillArea; title: string; group: DrillGroup }[] = [
  { id: 'ml', title: 'MLOps и AI Platform', group: 'mlops' },
  { id: 'infra', title: 'Инфраструктура', group: 'devops' },
  { id: 'data', title: 'Базы данных и очереди', group: 'devops' },
]
