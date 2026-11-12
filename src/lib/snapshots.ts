// Сводка по прогрессу для предпросмотра снимка: что в нём есть и чем он отличается от текущего состояния.

import type { Curriculum, UserProgress } from '../types'
import { summarizeIncidents } from './incidents'
import { getTaskProgress, isVerified } from './progress'

export interface ProgressStats {
  tasksTouched: number
  tasksVerified: number
  evidence: number
  quizzesPassed: number
  incidentsSolved: number
  practiced: number
  interviewAnswers: number
  designs: number
  gymSessions: number
  saved: number
  journal: number
}

export const STAT_LABELS: Record<keyof ProgressStats, string> = {
  tasksVerified: 'Засчитано задач',
  tasksTouched: 'Задач с прогрессом',
  evidence: 'Подтверждений',
  quizzesPassed: 'Сдано тестов',
  incidentsSolved: 'Решено инцидентов',
  practiced: 'Вопросов в тренажёре',
  interviewAnswers: 'Ответов «Своими словами»',
  designs: 'Ответов на кейсы проектирования',
  gymSessions: 'Сессий в залах',
  saved: 'Закладок',
  journal: 'Записей старого дневника',
}

export function progressStats(p: UserProgress, c: Curriculum): ProgressStats {
  let verified = 0
  let quizzes = 0
  for (const task of c.tasks) {
    if (!isVerified(task, getTaskProgress(p, task.id))) continue
    verified++
    if (task.kind === 'quiz') quizzes++
  }
  return {
    tasksVerified: verified,
    tasksTouched: Object.keys(p.tasks).length,
    evidence: Object.values(p.tasks).reduce((a, t) => a + t.evidence.length, 0),
    quizzesPassed: quizzes,
    incidentsSolved: summarizeIncidents(c.incidents, p).solved,
    practiced: Object.keys(p.practice).length,
    interviewAnswers: Object.keys(p.interview.answers).length,
    designs: Object.keys(p.interview.designs).length,
    gymSessions: Object.values(p.gyms).reduce((n, g) => n + g.sessions.length, 0),
    saved: p.saved.length,
    journal: p.journal.length,
  }
}

export interface StatDiff {
  key: keyof ProgressStats
  label: string
  current: number
  snapshot: number
}

/** Построчное сравнение текущего прогресса со снимком. lost — в снимке меньше, чем сейчас (восстановление это потеряет). */
export function compareStats(current: ProgressStats, snapshot: ProgressStats): { rows: StatDiff[]; lost: StatDiff[] } {
  const rows = (Object.keys(STAT_LABELS) as (keyof ProgressStats)[])
    .map((key) => ({ key, label: STAT_LABELS[key], current: current[key], snapshot: snapshot[key] }))
    // дневника в интерфейсе нет; строка нужна, только пока в данных остались его записи
    .filter((r) => r.key !== 'journal' || r.current > 0 || r.snapshot > 0)
  return { rows, lost: rows.filter((r) => r.snapshot < r.current) }
}
