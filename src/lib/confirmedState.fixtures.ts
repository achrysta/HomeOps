// Изолированные данные тестов: не читают и не записывают пользовательское хранилище.
import { curriculum } from '../data'
import { QUIZ_PASS_THRESHOLD, QUIZ_SIZE } from '../config/weights'
import type { Curriculum, GymDef, IncidentDef, TaskDef, UserProgress } from '../types'
import { createEmptyProgress } from './storage'

export const TEST_AT = '2026-10-08T12:00:00.000Z'
export const TEST_NOW = Date.parse('2026-10-09T12:00:00.000Z')
export const testProgress = (c: Curriculum = curriculum): UserProgress => {
  const p = createEmptyProgress(c)
  p.meta.createdAt = '2026-01-01T12:00:00.000Z'
  return p
}
export function verifyTask(p: UserProgress, task: TaskDef) {
  p.tasks[task.id] = { status: 'completed', criteriaDone: [...task.acceptanceCriteria], notes: '', completedAt: TEST_AT, evidence: [{ id: 'proof', type: 'note', value: 'p95 уменьшился с 420 до 180 мс при 12 RPS', createdAt: TEST_AT }] }
  if (task.kind === 'quiz') p.tasks[task.id].quizAttempts = [{ id: 'attempt', at: TEST_AT, total: QUIZ_SIZE, correct: Math.ceil(QUIZ_SIZE * QUIZ_PASS_THRESHOLD), passed: true, wrongIds: [] }]
}
export function solveIncident(p: UserProgress, d: IncidentDef) {
  p.incidents[d.id] = { hintsShown: 0, solvedAt: TEST_AT, reports: [{ id: 'report', at: TEST_AT, passed: true, source: 'auto', checks: d.checks.map((check) => ({ id: check.id, ok: true, message: 'Ответ 200 за 35 мс' })) }] }
}
export function finishGym(p: UserProgress, d: GymDef) {
  p.gyms[d.id] = { sessions: [{ id: 'session', startedAt: '2026-10-08T11:00:00.000Z', finishedAt: TEST_AT, reps: Object.fromEntries(d.reps.map((r, i) => [r.id, new Date(Date.parse(TEST_AT) - (d.reps.length - i) * 1000).toISOString()])) }] }
}
