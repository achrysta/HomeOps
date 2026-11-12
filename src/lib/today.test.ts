import { describe, expect, it } from 'vitest'
import { curriculum } from '../data'
import type { IncidentReport, TaskDef, UserProgress } from '../types'
import { interviewReviewTopics } from './interview'
import { finalExamSize } from './quiz'
import { createEmptyProgress } from './storage'
import { recentPractice, recentWindowStart, todayIncident, todayReviews } from './today'

const DAY = 86_400_000
const NOW = new Date(2026, 9, 8, 10, 0).getTime()
const at = (time: number) => new Date(time).toISOString()
const from = recentWindowStart(NOW)
const empty = () => {
  const p = createEmptyProgress(curriculum)
  p.meta.createdAt = at(NOW - 30 * DAY)
  return p
}
const lab = curriculum.tasks.find((t) => t.kind === 'lab')!
const quiz = curriculum.quizzes[0]
const incident = curriculum.incidents[0]
const another = curriculum.incidents[1]
const complete = (p: UserProgress, task: TaskDef = lab, date = at(NOW)) => {
  p.tasks[task.id] = {
    status: 'completed',
    criteriaDone: [...task.acceptanceCriteria],
    notes: '',
    evidence: [{ id: 'proof', type: 'commit', value: 'abc', createdAt: date }],
    completedAt: at(NOW),
    updatedAt: at(NOW),
  }
}
const report = (def = incident, date = at(NOW), good = true): IncidentReport => ({
  id: date,
  at: date,
  passed: good,
  source: 'auto',
  checks: def.checks.map((c) => ({ id: c.id, ok: good, message: good ? 'OK' : 'Ошибка' })),
})

describe('today reviews', () => {
  it('does not treat unseen questions as overdue', () => {
    const p = empty()
    expect(todayReviews(curriculum, p, NOW)).toEqual({ practice: 0, interview: 0, gyms: 0 })
    expect(interviewReviewTopics(curriculum.interviewTopics, p.interview.answers, NOW)).toEqual([])
  })

  it('includes both course and DevOps questions and ignores removed ids', () => {
    const p = empty()
    const stat = { seen: 1, correct: 0, streak: 0, lastCorrect: false, lastAt: at(NOW) }
    p.practice[quiz.questions[0].id] = stat
    p.practice[curriculum.drills[0].questions[0].id] = stat
    p.practice.removed = stat
    p.practice[quiz.questions[1].id] = { ...stat, correct: 1, streak: 1, lastCorrect: true }
    p.interview.answers[curriculum.interviewTopics[0].questions[0].id] = {
      rating: 1,
      ratedAt: at(NOW - DAY),
      updatedAt: at(NOW),
    }
    p.interview.answers.removed = { rating: 0, updatedAt: at(NOW) }
    expect(todayReviews(curriculum, p, NOW)).toEqual({ practice: 2, interview: 1, gyms: 0 })
  })

  it('offers only due interview questions even when many new ones exist', () => {
    const p = empty()
    const q = curriculum.interviewTopics[0].questions[0]
    p.interview.answers[q.id] = { rating: 1, updatedAt: at(NOW - DAY) }
    p.interview.answers[curriculum.interviewTopics[0].questions[1].id] = {
      rating: 3,
      updatedAt: at(NOW),
    }
    const before = structuredClone(curriculum.interviewTopics)
    const topics = interviewReviewTopics(curriculum.interviewTopics, p.interview.answers, NOW)
    expect(topics.flatMap((t) => t.questions.map((x) => x.id))).toEqual([q.id])
    expect(curriculum.interviewTopics).toEqual(before)
  })
})

describe('recent practice without invented progress', () => {
  it('uses seven local calendar days, including today', () => {
    expect(new Date(from)).toEqual(new Date(2026, 9, 2, 0, 0, 0, 0))
    const p = empty()
    complete(p, lab, at(from))
    expect(recentPractice(curriculum, p, NOW).evidence).toBe(1)
    p.tasks[lab.id].evidence[0].createdAt = at(from - 1)
    expect(recentPractice(curriculum, p, NOW).evidence).toBe(0)
    p.tasks[lab.id].evidence[0].createdAt = at(NOW + 1)
    expect(recentPractice(curriculum, p, NOW).evidence).toBe(0)
  })

  it('counts verified exercises as practice too, but not reading', () => {
    const p = empty()
    const exercise = curriculum.tasks.find((t) => t.kind === 'exercise')!
    complete(p, exercise)
    expect(recentPractice(curriculum, p, NOW).evidence).toBe(1)
    const reading = curriculum.tasks.find((t) => t.kind === 'reading')!
    complete(p, reading)
    expect(recentPractice(curriculum, p, NOW).evidence).toBe(1)
  })

  it('counts evidence only with completed status and all current criteria', () => {
    const p = empty()
    complete(p)
    expect(recentPractice(curriculum, p, NOW).evidence).toBe(1)
    p.tasks[lab.id].criteriaDone.pop()
    expect(recentPractice(curriculum, p, NOW).evidence).toBe(0)
    p.tasks[lab.id].criteriaDone = [...lab.acceptanceCriteria]
    p.tasks[lab.id].status = 'in_progress'
    expect(recentPractice(curriculum, p, NOW).evidence).toBe(0)
  })

  it('does not use manual completion or note dates as dates of verified practice', () => {
    const p = empty()
    complete(p, lab, at(from - DAY))
    expect(recentPractice(curriculum, p, NOW).evidence).toBe(0)
    p.tasks[lab.id].updatedAt = at(NOW)
    p.tasks[lab.id].notes = 'Новая заметка'
    expect(recentPractice(curriculum, p, NOW).evidence).toBe(0)
    const reading = curriculum.tasks.find((t) => t.kind === 'reading')!
    complete(p, reading)
    complete(p, { ...lab, id: 'removed-task' })
    expect(recentPractice(curriculum, p, NOW).evidence).toBe(0)
  })

  it('counts a passed test once, with a real passing score and date', () => {
    const p = empty()
    const attempt = { id: 'a', at: at(NOW), correct: 16, total: 20, passed: true, wrongIds: [] }
    p.tasks[quiz.id] = {
      status: 'completed',
      evidence: [],
      criteriaDone: [],
      notes: '',
      quizAttempts: [attempt, { ...attempt, id: 'b' }],
    }
    expect(recentPractice(curriculum, p, NOW).quizzes).toBe(1)
    p.tasks[quiz.id].quizAttempts = [{ ...attempt, correct: 1 }]
    expect(recentPractice(curriculum, p, NOW).quizzes).toBe(0)
    p.tasks[quiz.id].quizAttempts = [{ ...attempt, passed: false }]
    expect(recentPractice(curriculum, p, NOW).quizzes).toBe(1)
    p.tasks[quiz.id].quizAttempts = [{ ...attempt, correct: 1, total: 1, passed: true }]
    expect(recentPractice(curriculum, p, NOW).quizzes).toBe(0)
    p.tasks[quiz.id].quizAttempts = [{ ...attempt, at: at(NOW + DAY) }]
    expect(recentPractice(curriculum, p, NOW).quizzes).toBe(0)
    p.tasks[quiz.id].quizAttempts = []
    expect(recentPractice(curriculum, p, NOW).quizzes).toBe(0)
  })

  it('includes the final exam once and counts questions, not lifetime answers', () => {
    const p = empty()
    // размер экзамена растёт с числом треков: берём фактический, а не число на момент написания теста
    const total = finalExamSize(curriculum.quizzes)
    const attempt = { id: 'exam', at: at(NOW), correct: total - 2, total, passed: true, wrongIds: [] }
    p.finalExam = [attempt, { ...attempt, id: 'exam-again' }]
    const stat = { seen: 900, correct: 800, streak: 0, lastCorrect: false, lastAt: at(NOW) }
    p.practice[quiz.questions[0].id] = stat
    p.practice[curriculum.drills[0].questions[0].id] = stat
    p.practice.removed = stat
    p.practice[quiz.questions[1].id] = { ...stat, lastAt: at(from - 1) }
    p.practice[quiz.questions[2].id] = { ...stat, lastAt: at(NOW + 1) }
    expect(recentPractice(curriculum, p, NOW)).toMatchObject({ quizzes: 1, questions: 2 })
  })

  it('does not turn interview self-assessment into confirmed weekly practice', () => {
    const p = empty()
    p.interview.answers[curriculum.interviewTopics[0].questions[0].id] = {
      rating: 3,
      checkedAt: at(NOW),
      updatedAt: at(NOW),
    }
    expect(recentPractice(curriculum, p, NOW)).toEqual({
      from,
      evidence: 0,
      quizzes: 0,
      incidents: 0,
      questions: 0,
    })
  })

  it('rechecks incident checks instead of trusting passed or solvedAt', () => {
    const p = empty()
    const r = report()
    p.incidents[incident.id] = {
      hintsShown: 0,
      reports: [{ ...r, checks: r.checks.slice(1) }],
      solvedAt: at(NOW),
    }
    expect(recentPractice(curriculum, p, NOW).incidents).toBe(0)
    p.incidents[incident.id].reports = [{ ...r, passed: false }]
    expect(recentPractice(curriculum, p, NOW).incidents).toBe(1)
  })

  it('ignores reports before reset, future reports and old solutions checked again', () => {
    const p = empty()
    p.incidents[incident.id] = {
      hintsShown: 0,
      reports: [report(incident, at(NOW - 31 * DAY)), report(incident, at(NOW + DAY))],
    }
    expect(recentPractice(curriculum, p, NOW).incidents).toBe(0)
    expect(todayIncident(curriculum, p, NOW).current).toBeUndefined()
    p.incidents[incident.id].reports = [report(incident, at(from - DAY)), report()]
    expect(recentPractice(curriculum, p, NOW).incidents).toBe(0)
    expect(todayIncident(curriculum, p, NOW).current).toBeUndefined()
  })

  it('returns a new summary without changing saved progress or report ordering', () => {
    const p = empty()
    complete(p)
    p.incidents[incident.id] = {
      hintsShown: 0,
      reports: [report(), report(incident, at(NOW - DAY), false)],
    }
    const before = structuredClone(p)
    recentPractice(curriculum, p, NOW)
    todayIncident(curriculum, p, NOW)
    todayReviews(curriculum, p, NOW)
    expect(p).toEqual(before)
  })
})

describe('resume incident', () => {
  it('keeps a manually started stand visible after a clock error, without counting a solution', () => {
    const p = empty()
    p.incidents[incident.id] = {
      startedAt: at(NOW + DAY),
      hintsShown: 0,
      reports: [report(incident, at(NOW + DAY))],
    }
    expect(todayIncident(curriculum, p, NOW).current).toMatchObject({
      incident: { id: incident.id },
      passedChecks: null,
    })
    expect(recentPractice(curriculum, p, NOW).incidents).toBe(0)
  })

  it('chooses the latest activity, with only current check ids counted', () => {
    const p = empty()
    const partial = report(incident, at(NOW), false)
    partial.checks[0].ok = true
    partial.checks.push({ id: 'removed-check', ok: true, message: 'OK' })
    p.incidents[incident.id] = { startedAt: at(NOW - 3 * DAY), hintsShown: 0, reports: [partial] }
    p.incidents[another.id] = { startedAt: at(NOW - DAY), hintsShown: 0, reports: [] }
    const resume = todayIncident(curriculum, p, NOW)
    expect(resume.total).toBe(2)
    expect(resume.current).toMatchObject({ incident: { id: incident.id }, passedChecks: 1 })
  })

  it('excludes solved and unknown incidents; starting without a report is enough to resume', () => {
    const p = empty()
    p.incidents[incident.id] = { hintsShown: 0, reports: [report()] }
    p.incidents[another.id] = { hintsShown: 0, startedAt: at(NOW), reports: [] }
    p.incidents.removed = { hintsShown: 0, startedAt: at(NOW), reports: [] }
    expect(todayIncident(curriculum, p, NOW)).toMatchObject({
      total: 1,
      current: { incident: { id: another.id }, passedChecks: null },
    })
  })
})
