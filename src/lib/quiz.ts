import {
  FINAL_EXAM_PER_TRACK,
  QUIZ_PASS_THRESHOLD,
  QUIZ_SIZE,
  REVIEW_INTERVAL_DAYS,
} from '../config/weights'
import type { PracticeStat, Quiz, QuizAttempt, QuizQuestion } from '../types'

export type Answers = Record<string, number[]>

export function shuffle<T>(items: readonly T[], rnd: () => number = Math.random): T[] {
  const a = [...items]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

/** Ответ засчитывается только при точном совпадении множества выбранных вариантов. */
export function isCorrect(q: QuizQuestion, chosen: readonly number[] | undefined): boolean {
  if (!chosen || chosen.length !== q.correct.length) return false
  return q.correct.every((c) => chosen.includes(c))
}

export function scoreAttempt(
  questions: readonly QuizQuestion[],
  answers: Answers,
  threshold: number,
) {
  const wrongIds = questions.filter((q) => !isCorrect(q, answers[q.id])).map((q) => q.id)
  const total = questions.length
  const correct = total - wrongIds.length
  return { correct, total, wrongIds, passed: total > 0 && correct / total >= threshold }
}

export function validAttemptScore(a: { correct: number; total: number }): boolean {
  return (
    Number.isSafeInteger(a.total) &&
    a.total > 0 &&
    Number.isSafeInteger(a.correct) &&
    a.correct >= 0 &&
    a.correct <= a.total
  )
}

export function attemptPasses(a: { correct: number; total: number }, total?: number): boolean {
  return (
    validAttemptScore(a) &&
    (total === undefined || a.total === total) &&
    a.correct / a.total >= QUIZ_PASS_THRESHOLD
  )
}

export function bestRatio(
  attempts: readonly QuizAttempt[] | undefined,
  total = QUIZ_SIZE,
): number | null {
  const valid = (attempts ?? []).filter((a) => validAttemptScore(a) && a.total === total)
  return valid.length ? Math.max(...valid.map((a) => a.correct / a.total)) : null
}

export const finalExamSize = (quizzes: readonly Quiz[]): number =>
  quizzes.reduce((n, q) => n + Math.min(FINAL_EXAM_PER_TRACK, q.questions.length), 0)

export const hasPassed = (attempts: readonly QuizAttempt[] | undefined, total = QUIZ_SIZE) =>
  !!attempts?.some((a) => attemptPasses(a, total))

/**
 * Ограничить историю попыток последними max, не теряя зачёт: если сданная попытка
 * выпадает из окна, лучшая из сданных остаётся первой в истории.
 */
export function trimAttempts(attempts: QuizAttempt[], max: number): QuizAttempt[] {
  if (attempts.length <= max) return attempts
  const recent = attempts.slice(-max)
  if (recent.some((a) => a.passed)) return recent
  const ratio = (a: QuizAttempt) => (a.total ? a.correct / a.total : 0)
  const best = attempts.filter((a) => a.passed).sort((a, b) => ratio(b) - ratio(a))[0]
  return best ? [best, ...attempts.slice(-(max - 1))] : recent
}

/** Сквозной экзамен: по N случайных вопросов из каждого теста, общий порядок тоже случайный. */
export function sampleFinalExam(
  quizzes: readonly Quiz[],
  perQuiz: number,
  rnd: () => number = Math.random,
): QuizQuestion[] {
  return shuffle(
    quizzes.flatMap((q) => shuffle(q.questions, rnd).slice(0, perQuiz)),
    rnd,
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Тренажёр
// ─────────────────────────────────────────────────────────────────────────────

export type PracticeMode = 'smart' | 'due' | 'mistakes' | 'random'

const DAY_MS = 86_400_000

const intervalDays = (streak: number) =>
  REVIEW_INTERVAL_DAYS[Math.max(0, Math.min(streak, REVIEW_INTERVAL_DAYS.length - 1))]

/**
 * Когда вопрос пора повторить (мс): после ошибки — сразу, после верного ответа — через интервал
 * по длине серии верных ответов. null — вопрос ещё не встречался.
 */
export function reviewDueAt(s: PracticeStat | undefined): number | null {
  if (!s) return null
  const last = Date.parse(s.lastAt)
  if (Number.isNaN(last)) return 0
  return s.lastCorrect ? last + intervalDays(s.streak) * DAY_MS : last
}

/** Вопрос уже встречался, и срок его повторения наступил (включая последние ошибки). */
export function isDue(s: PracticeStat | undefined, now: number): boolean {
  const due = reviewDueAt(s)
  return due !== null && now >= due
}

/** Вопрос освоен — помню сейчас: последний ответ верный, минимум два верных подряд и срок повторения ещё не наступил. */
export const isMastered = (s: PracticeStat | undefined, now: number) =>
  !!s && s.lastCorrect && s.streak >= 2 && !isDue(s, now)

/**
 * Вес вопроса в «умном» режиме: последние ошибки, просроченные повторения и новые вопросы — чаще,
 * вопросы, у которых срок повторения ещё не наступил, — редко, но не никогда.
 */
export function practiceWeight(s: PracticeStat | undefined, now: number): number {
  if (!s) return 3
  if (!s.lastCorrect) return 6
  const due = reviewDueAt(s) ?? 0
  if (now >= due) {
    const overdue = (now - due) / (Math.max(1, intervalDays(s.streak)) * DAY_MS)
    return 4 + Math.min(2, overdue * 2)
  }
  return s.streak <= 1 ? 0.6 : 0.2
}

/** Выбор для сессии тренажёра: вопросы и упражнения — всё, у чего есть id статистики. */
export function pickPracticeQuestions<T extends { id: string }>(
  pool: readonly T[],
  stats: Record<string, PracticeStat>,
  mode: PracticeMode,
  limit: number,
  now: number,
  rnd: () => number = Math.random,
): T[] {
  if (mode === 'random') return shuffle(pool, rnd).slice(0, limit)
  if (mode === 'mistakes')
    return shuffle(
      pool.filter((q) => stats[q.id] && !stats[q.id].lastCorrect),
      rnd,
    ).slice(0, limit)
  if (mode === 'due') {
    // самые просроченные — первыми, внутри одинакового срока — случайно
    return shuffle(
      pool.filter((q) => isDue(stats[q.id], now)),
      rnd,
    )
      .sort((a, b) => (reviewDueAt(stats[a.id]) ?? 0) - (reviewDueAt(stats[b.id]) ?? 0))
      .slice(0, limit)
  }
  // взвешенная выборка без возвращения
  const items = pool.map((q) => ({ q, w: practiceWeight(stats[q.id], now) }))
  const picked: T[] = []
  while (picked.length < limit && items.length) {
    const total = items.reduce((a, x) => a + x.w, 0)
    let r = rnd() * total
    let i = 0
    while (i < items.length - 1 && r >= items[i].w) r -= items[i++].w
    picked.push(items[i].q)
    items.splice(i, 1)
  }
  return picked
}
