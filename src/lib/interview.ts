// «Своими словами»: самопроверка ответом вслух, сверка с тезисами и сроки повторения. Без React.
// Сохранённая структура прогресса прежняя (progress.interview), поэтому старые файлы читаются без изменений.

import { INTERVIEW_REVIEW_DAYS } from '../config/weights'
import type { InterviewAnswer, InterviewQuestion, InterviewRating, InterviewTopic } from '../types'

const DAY = 24 * 60 * 60 * 1000

/** Оценки шкалы по порядку: 0 — не могу ответить, 1 — с подсказкой, 2 — объясню самостоятельно. */
export const EXPLAIN_RATINGS = [0, 1, 2] as const satisfies readonly InterviewRating[]
export type ExplainRating = (typeof EXPLAIN_RATINGS)[number]

/**
 * Оценка по шкале самопроверки. Старое значение 3 («Покажу практический пример») из сохранённого
 * прогресса читается как «Объясню самостоятельно»; сама запись не переписывается.
 */
export const explainRating = (rating: InterviewRating): ExplainRating => (rating === 3 ? 2 : rating)

/** У вопросов без собственного списка — навыки темы. */
export const questionSkills = (topic: InterviewTopic, q: InterviewQuestion): string[] => q.skillIds ?? topic.skillIds

/** Вслепую оценил себя выше, чем после сверки с тезисами. */
export const overrated = (a: InterviewAnswer | undefined): boolean =>
  !!a?.checkedAt && a.blindRating !== undefined && explainRating(a.blindRating) > explainRating(a.rating)

/** Когда вопрос снова стоит повторить: по оценке от последней оценки или сверки. */
export function interviewDueAt(a: InterviewAnswer | undefined): number {
  if (!a) return 0
  const last = Date.parse(a.ratedAt ?? a.checkedAt ?? a.updatedAt) || 0
  return last + INTERVIEW_REVIEW_DAYS[explainRating(a.rating)] * DAY
}

export const isInterviewDue = (a: InterviewAnswer | undefined, now: number): boolean => interviewDueAt(a) <= now

/** Пора повторить только оценённый вопрос: новые вопросы — отдельный поток, чтобы не вытеснять просроченные. */
export const isReviewDue = (answer: InterviewAnswer | undefined, now: number): boolean => !!answer && isInterviewDue(answer, now)

/** Темы только с вопросами, которые пора повторить. */
export function interviewReviewTopics(topics: readonly InterviewTopic[], answers: Record<string, InterviewAnswer>, now: number): InterviewTopic[] {
  return topics.map((t) => ({ ...t, questions: t.questions.filter((q) => isReviewDue(answers[q.id], now)) })).filter((t) => t.questions.length > 0)
}
