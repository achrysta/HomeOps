import { QUIZ_PASS_THRESHOLD } from '../config/weights'
import type {
  Curriculum,
  GymDef,
  GymSession,
  QuizAttempt,
  TaskDef,
  Track,
  UserProgress,
} from '../types'
import { confirmedIncident as checkedIncident } from './incidents'
import { finalExamSize, validAttemptScore } from './quiz'
import { getTaskProgress, getVerification } from './progress'

export const validTimestamp = (at: string | undefined): number | null =>
  at && Number.isFinite(Date.parse(at)) ? Date.parse(at) : null

export const validAttempt = validAttemptScore

export const confirmedAttempt = (a: QuizAttempt): boolean =>
  validAttempt(a) && a.correct / a.total >= QUIZ_PASS_THRESHOLD

/** Не принимаем passed с низким score даже у ненормализованного импортированного объекта. */
export function confirmedTask(task: TaskDef, p: UserProgress): boolean {
  return getVerification(task, getTaskProgress(p, task.id)) === 'verified'
}

/** Исключение по окружению не является прохождением обязательной задачи. */
export function completedTrack(track: Track, c: Curriculum, p: UserProgress): boolean {
  const required = c.tasks.filter((t) => t.trackId === track.id && !t.optional)
  return required.length > 0 && required.every((t) => confirmedTask(t, p))
}

export function confirmedExam(c: Curriculum, p: UserProgress): boolean {
  const total = finalExamSize(c.quizzes)
  return total > 0 && p.finalExam.some((a) => a.total === total && confirmedAttempt(a))
}

/** Решение выводится заново по текущим checks; solvedAt и passed не являются доказательством. */
export const confirmedIncident = checkedIncident

/** Принимается только датированная последовательность актуальных подходов сессии. */
export function confirmedReps(
  def: GymDef,
  session: GymSession,
  now: number,
): { id: string; at: string }[] {
  let previous = validTimestamp(session.startedAt)
  const end = session.finishedAt ? validTimestamp(session.finishedAt) : now
  if (previous === null || end === null || previous > end || end > now) return []
  const reps: { id: string; at: string }[] = []
  for (const rep of def.reps) {
    const at = session.reps[rep.id]
    const time = validTimestamp(at)
    if (time === null || time < previous || time > end) break
    reps.push({ id: rep.id, at })
    previous = time
  }
  return reps
}

export const confirmedGym = (def: GymDef, p: UserProgress, now: number): boolean =>
  def.reps.length > 0 &&
  (p.gyms[def.id]?.sessions ?? []).some(
    (s) => !!s.finishedAt && confirmedReps(def, s, now).length === def.reps.length,
  )
