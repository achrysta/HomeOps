// Экран «Сегодня»: только выбор и сводка уже сохранённых результатов, без изменения прогресса.
import { QUIZ_SIZE, TODAY_WINDOW_DAYS } from '../config/weights'
import type { Curriculum, UserProgress } from '../types'
import { checkedIncidentReports, confirmedIncident } from './incidents'
import { gymState } from './gyms'
import { isReviewDue } from './interview'
import { getTaskProgress, getVerification, isPracticeTask } from './progress'
import { attemptPasses, finalExamSize, isDue } from './quiz'

/** Всё, что повторяет тренажёр: вопросы тестов треков, банки MLOps- и DevOps-базы и упражнения */
const practiceQuestions = (c: Curriculum): { id: string }[] => [
  ...c.quizzes.flatMap((q) => q.questions),
  ...c.drills.flatMap((d) => d.questions),
  ...c.exercises.flatMap((s) => s.exercises),
]

export function todayReviews(c: Curriculum, p: UserProgress, now: number) {
  return {
    practice: practiceQuestions(c).filter((q) => isDue(p.practice[q.id], now)).length,
    /** Вопросы «Своими словами», которые пора повторить */
    interview: c.interviewTopics
      .flatMap((t) => t.questions)
      .filter((q) => isReviewDue(p.interview.answers[q.id], now)).length,
    /** Залы, которые пора пройти по расписанию (новые и на паузе не считаются) */
    gyms: c.gyms.filter((g) => gymState(g, p.gyms[g.id], now) === 'due').length,
  }
}

export function recentWindowStart(now: number): number {
  const start = new Date(now)
  start.setHours(0, 0, 0, 0)
  start.setDate(start.getDate() - (TODAY_WINDOW_DAYS - 1))
  return start.getTime()
}

const timestamp = (at: string | undefined) => (at ? Date.parse(at) : NaN)
const within = (at: string | undefined, from: number, to: number) =>
  timestamp(at) >= from && timestamp(at) <= to

export function todayIncident(c: Curriculum, p: UserProgress, now: number) {
  const active = c.incidents
    .flatMap((incident) => {
      const ip = p.incidents[incident.id]
      if (!ip) return []
      const reports = checkedIncidentReports(incident, p, now)
      if (confirmedIncident(incident, p, now)) return []
      const activity = [ip.startedAt, ip.debriefOpenedAt, ...reports.map((r) => r.at)]
        .filter((at) => within(at, timestamp(p.meta.createdAt), now))
        .map(timestamp)
      // Сбой часов не должен прятать явно начатый стенд; неизвестную дату не используем для сортировки.
      if (!ip.startedAt && !ip.debriefOpenedAt && !ip.hintsShown && !reports.length) return []
      const last = reports.at(-1)
      return [
        {
          incident,
          lastActivity: Math.max(0, ...activity),
          passedChecks: last
            ? incident.checks.filter((check) =>
                last.checks.some((r) => r.id === check.id && r.ok === true),
              ).length
            : null,
        },
      ]
    })
    .sort((a, b) => b.lastActivity - a.lastActivity)
  return { current: active[0], total: active.length }
}

export function recentPractice(c: Curriculum, p: UserProgress, now: number) {
  const from = recentWindowStart(now)
  const recent = (at: string | undefined) => within(at, from, now)
  // completedAt — дата ручной отметки, updatedAt меняется даже при редактировании заметки.
  // Не выдаём их за дату верификации: считаем реально датированные подтверждения засчитанной практики.
  const evidence = new Set(
    c.tasks.filter(isPracticeTask).flatMap((task) => {
      const tp = getTaskProgress(p, task.id)
      return getVerification(task, tp) === 'verified'
        ? tp.evidence.filter((e) => recent(e.createdAt)).map((e) => `${task.id}:${e.id}`)
        : []
    }),
  ).size
  const passed = (total: number) => (a: { total: number; correct: number; at: string }) =>
    attemptPasses(a, total) && recent(a.at)
  const quizzes =
    c.quizzes.filter((q) => (p.tasks[q.id]?.quizAttempts ?? []).some(passed(QUIZ_SIZE))).length +
    (p.finalExam.some(passed(finalExamSize(c.quizzes))) ? 1 : 0)
  const incidents = c.incidents.filter((incident) => {
    const first = confirmedIncident(incident, p, now)?.report
    return first && recent(first.at)
  }).length
  // В practice хранится последний ответ на вопрос, а не журнал всех попыток за день.
  const questions = new Set(
    practiceQuestions(c)
      .filter((q) => (p.practice[q.id]?.seen ?? 0) > 0 && recent(p.practice[q.id]?.lastAt))
      .map((q) => q.id),
  ).size
  return { from, evidence, quizzes, incidents, questions }
}
