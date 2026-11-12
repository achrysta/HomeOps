import { DIAGNOSTIC_POLICY as P } from '../config/learning'
import { diagnosticSkills } from '../data/diagnostics'
import type { Curriculum, QuizQuestion, UserProgress, Vacancy } from '../types'
import { getTaskProgress, getVerification } from './progress'

export interface DiagnosticQuestion {
  question: QuizQuestion
  trackId: string
  skillIds: string[]
  /** Приоритет навыков вопроса по важности в профиле роли: им выбирается следующий вопрос трека */
  priority: Record<string, number>
}
export interface DiagnosticAnswer {
  questionId: string
  correct: boolean
  confident: boolean
  selection: number[]
}
export function diagnosticPool(c: Curriculum, v: Vacancy): DiagnosticQuestion[] {
  const role = new Map(
    v.requirements.flatMap((r) =>
      r.importance === 'advanced' ? [] : [[r.skillId, P.skillPriority[r.importance]] as const],
    ),
  )
  return c.quizzes.flatMap((quiz) =>
    quiz.questions.flatMap((question) => {
      const skillIds = diagnosticSkills[question.id]?.filter((id) => role.has(id)) ?? []
      const priority = Object.fromEntries(skillIds.map((id) => [id, role.get(id) ?? 0]))
      return skillIds.length ? [{ question, trackId: quiz.trackId, skillIds, priority }] : []
    }),
  )
}
export const diagnosticCorrect = (q: QuizQuestion, selection: readonly number[]): boolean =>
  selection.length === q.correct.length &&
  new Set(selection).size === selection.length &&
  q.correct.every((n) => selection.includes(n))

/** Сначала охват треков, затем уточнение слабых ответов; заданный вопрос не повторяется. */
export function nextDiagnosticQuestion(
  pool: readonly DiagnosticQuestion[],
  answers: readonly DiagnosticAnswer[],
): DiagnosticQuestion | null {
  if (answers.length >= P.maxQuestions) return null
  const seen = new Set(answers.map((a) => a.questionId))
  // внутри трека сначала вопрос о ещё не проверенных навыках, важные для роли — раньше желательных
  const covered = new Set(pool.filter((q) => seen.has(q.question.id)).flatMap((q) => q.skillIds))
  const fresh = (q: DiagnosticQuestion) =>
    q.skillIds.reduce((sum, id) => sum + (covered.has(id) ? 0 : q.priority[id]), 0)
  const tracks = [...new Set(pool.map((q) => q.trackId))]
  const byTrack = tracks.map((id) => {
    const questions = pool.filter((q) => q.trackId === id)
    const asked = answers.filter((a) => questions.some((q) => q.question.id === a.questionId))
    return {
      id,
      asked,
      weak: asked.filter((a) => !a.correct || !a.confident).length,
      next: questions
        .filter((q) => !seen.has(q.question.id))
        .reduce<DiagnosticQuestion | undefined>((best, q) => (!best || fresh(q) > fresh(best) ? q : best), undefined),
    }
  })
  const target = Math.min(P.minQuestions, tracks.length * P.minPerTrack)
  if (
    answers.length >= target &&
    byTrack.every((t) => t.asked.length >= P.minPerTrack) &&
    byTrack.every((t) => !t.weak || t.asked.length >= P.maxPerTrack)
  )
    return null
  const available = byTrack.filter((t) => t.next && t.asked.length < P.maxPerTrack)
  available.sort(
    (a, b) =>
      Number(b.asked.length < P.minPerTrack) - Number(a.asked.length < P.minPerTrack) ||
      a.asked.length - b.asked.length ||
      b.weak - a.weak,
  )
  return available[0]?.next ?? null
}

export function diagnosticKnowledge(
  v: Vacancy,
  pool: readonly DiagnosticQuestion[],
  answers: readonly DiagnosticAnswer[],
) {
  return v.requirements
    .filter((r) => r.importance !== 'advanced')
    .map((requirement) => {
      const ids = new Set(
        pool.filter((q) => q.skillIds.includes(requirement.skillId)).map((q) => q.question.id),
      )
      const used = answers.filter((a) => ids.has(a.questionId))
      const correct = used.filter((a) => a.correct && a.confident).length
      const status = !used.length
        ? 'untested'
        : used.some((a) => !a.correct || !a.confident)
          ? 'review'
          : correct >= P.solidAnswers
            ? 'solid'
            : 'insufficient'
      return {
        skillId: requirement.skillId,
        total: used.length,
        correct,
        status: status as 'untested' | 'review' | 'solid' | 'insufficient',
      }
    })
}
export function diagnosticRecommendations(
  c: Curriculum,
  p: UserProgress,
  v: Vacancy,
  pool: readonly DiagnosticQuestion[],
  answers: readonly DiagnosticAnswer[],
) {
  const knowledge = diagnosticKnowledge(v, pool, answers)
  const solid = new Set(knowledge.filter((k) => k.status === 'solid').map((k) => k.skillId))
  const skim = c.tasks.filter(
    (t) =>
      t.kind === 'reading' &&
      t.vacancyRequirementIds.length &&
      t.vacancyRequirementIds.every((s) => solid.has(s)) &&
      getVerification(t, getTaskProgress(p, t.id)) !== 'verified',
  )
  const faster = c.tracks.filter(
    (t) =>
      t.kind === 'core' &&
      pool.filter((q) => q.trackId === t.id).some((q) => q.skillIds.some((id) => solid.has(id))),
  )
  return { knowledge, skim, faster }
}
