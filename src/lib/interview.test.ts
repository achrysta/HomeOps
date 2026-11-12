import { describe, expect, it, vi } from 'vitest'
import { INTERVIEW_REVIEW_DAYS } from '../config/weights'
import { curriculum } from '../data'
import { reducer } from '../state/reducer'
import type { InterviewAnswer, InterviewTopic } from '../types'
import {
  explainRating,
  interviewDueAt,
  interviewReviewTopics,
  isInterviewDue,
  isReviewDue,
  overrated,
  questionSkills,
} from './interview'
import { computeInterviewReadiness } from './progress'
import { createEmptyProgress, normalizeProgress } from './storage'

const DAY = 24 * 60 * 60 * 1000
const T0 = Date.parse('2026-10-08T10:00:00Z')
const at = (ms: number) => new Date(ms).toISOString()
const answer = (
  rating: InterviewAnswer['rating'],
  ageDays = 0,
  extra: Partial<InterviewAnswer> = {},
): InterviewAnswer => ({ rating, updatedAt: at(T0 - ageDays * DAY), ...extra })

/** Вопросы всех тем, которые проверяют навык. */
const questionsFor = (skillId: string) =>
  curriculum.interviewTopics.flatMap((t) => t.questions.filter((q) => questionSkills(t, q).includes(skillId)))

describe('interview question bank', () => {
  it('every question has key points and a typical mistake', () => {
    for (const topic of curriculum.interviewTopics) {
      for (const q of topic.questions) {
        expect(q.points.length, q.id).toBeGreaterThanOrEqual(3)
        expect(q.points.length, q.id).toBeLessThanOrEqual(6)
        expect(new Set(q.points).size, `${q.id}: тезисы не повторяются`).toBe(q.points.length)
        for (const point of q.points) expect(point.trim().length, q.id).toBeGreaterThan(10)
        expect(q.pitfall.trim().length, q.id).toBeGreaterThan(20)
      }
    }
  })

  it('keeps 8–10 questions per topic', () => {
    for (const topic of curriculum.interviewTopics) {
      expect(topic.questions.length, topic.id).toBeGreaterThanOrEqual(8)
      expect(topic.questions.length, topic.id).toBeLessThanOrEqual(10)
    }
  })

  it('tags questions with the role skills they check', () => {
    const skillIds = new Set(curriculum.skills.map((s) => s.id))
    for (const topic of curriculum.interviewTopics) {
      for (const s of topic.skillIds) expect(skillIds.has(s), `${topic.id} → ${s}`).toBe(true)
      for (const q of topic.questions) {
        // в теме с несколькими навыками вопрос называет свои — иначе покрытие требований завышается
        if (topic.skillIds.length > 1) expect(q.skillIds, `${q.id}: навыки вопроса`).toBeDefined()
        if (!q.skillIds) continue
        expect(q.skillIds.length, q.id).toBeGreaterThan(0)
        expect(new Set(q.skillIds).size, q.id).toBe(q.skillIds.length)
        for (const s of q.skillIds)
          expect(topic.skillIds, `${q.id} → ${s} вне навыков темы`).toContain(s)
      }
      // каждый навык темы проверяет хотя бы один вопрос
      for (const s of topic.skillIds)
        expect(
          topic.questions.some((q) => questionSkills(topic, q).includes(s)),
          `${topic.id}: ${s} без вопросов`,
        ).toBe(true)
    }
  })

  it('covers every required, important and bonus requirement of each role profile', () => {
    for (const vacancy of curriculum.vacancies) {
      const gaps = vacancy.requirements
        .filter((r) => r.importance !== 'advanced' && questionsFor(r.skillId).length === 0)
        .map((r) => r.skillId)
      expect(gaps, vacancy.id).toEqual([])
    }
  })

  it('checks every required skill with at least three questions', () => {
    for (const vacancy of curriculum.vacancies)
      for (const r of vacancy.requirements.filter((x) => x.importance === 'required'))
        expect(questionsFor(r.skillId).length, `${vacancy.id}: ${r.skillId}`).toBeGreaterThanOrEqual(3)
  })
})

describe('interview topics and incidents', () => {
  it('links topics to existing incidents and splits them into MLOps and DevOps groups', () => {
    const incidentIds = new Set(curriculum.incidents.map((d) => d.id))
    for (const topic of curriculum.interviewTopics) {
      expect(['mlops', 'devops'], topic.id).toContain(topic.group)
      for (const id of topic.incidentIds)
        expect(incidentIds.has(id), `${topic.id} → ${id}`).toBe(true)
      expect(topic.questions.length, topic.id).toBeGreaterThanOrEqual(3)
    }
    const devops = curriculum.interviewTopics.filter((t) => t.group === 'devops')
    expect(devops.map((t) => t.id)).toEqual(['iv-linux', 'iv-docker', 'iv-k8s', 'iv-net', 'iv-db', 'iv-iac'])
    // каждый DevOps-инцидент можно привести как пример хотя бы в одной теме
    const linked = new Set(curriculum.interviewTopics.flatMap((t) => t.incidentIds))
    for (const d of curriculum.incidents.filter((x) => x.category === 'devops'))
      expect(linked.has(d.id), d.id).toBe(true)
  })
})

describe('self-check scale', () => {
  it('reads the legacy «покажу пример» rating as «объясню самостоятельно» without rewriting it', () => {
    expect(explainRating(3)).toBe(2)
    expect(explainRating(2)).toBe(2)
    expect(explainRating(1)).toBe(1)
    const topic = curriculum.interviewTopics.find((t) => t.id === 'iv-serving')!
    let p = createEmptyProgress(curriculum)
    p.interview.answers = Object.fromEntries(topic.questions.map((q) => [q.id, answer(3)]))
    const t = computeInterviewReadiness(curriculum, p).topics.find((x) => x.topic.id === topic.id)!
    expect(t.pct).toBeCloseTo(1)
    expect(t.counts).toEqual([0, 0, topic.questions.length])
    expect(normalizeProgress(p, curriculum).interview.answers[topic.questions[0].id].rating).toBe(3)
    for (const q of topic.questions) p = reducer(p, { type: 'interview/rating', questionId: q.id, rating: 1 })
    expect(computeInterviewReadiness(curriculum, p).topics.find((x) => x.topic.id === topic.id)!.pct).toBeCloseTo(0.5)
  })

  it('depends only on ratings, not on solved stands or verified tasks', () => {
    const p = createEmptyProgress(curriculum)
    const def = curriculum.incidents.find((d) => d.id === 'k8s-crashloop')!
    const solved = {
      ...p,
      incidents: { [def.id]: { hintsShown: 0, startedAt: at(T0), reports: [{ id: 'r', at: at(T0 + DAY), passed: true, source: 'auto' as const, checks: def.checks.map((c) => ({ id: c.id, ok: true, message: '' })) }] } },
    }
    expect(computeInterviewReadiness(curriculum, solved)).toEqual(computeInterviewReadiness(curriculum, p))
  })

  it('detects overrating: blind rating above the rating after checking key points', () => {
    expect(overrated(answer(1, 0, { blindRating: 2, checkedAt: at(T0) }))).toBe(true)
    expect(overrated(answer(2, 0, { blindRating: 3, checkedAt: at(T0) }))).toBe(false)
    expect(overrated(answer(2, 0, { blindRating: 1, checkedAt: at(T0) }))).toBe(false)
    expect(overrated(answer(1, 0, { blindRating: 2 }))).toBe(false)
  })
})

describe('interview flow in the reducer', () => {
  it('keeps the blind rating until key points are opened', () => {
    const id = 'iv-sv-1'
    let p = createEmptyProgress(curriculum)
    p = reducer(p, { type: 'interview/rating', questionId: id, rating: 3 })
    p = reducer(p, { type: 'interview/rating', questionId: id, rating: 2 })
    expect(p.interview.answers[id]).toMatchObject({ rating: 2, blindRating: 2 })
    p = reducer(p, { type: 'interview/check', questionId: id })
    const checkedAt = p.interview.answers[id].checkedAt
    expect(checkedAt).toBeTruthy()
    p = reducer(p, { type: 'interview/rating', questionId: id, rating: 1 })
    expect(p.interview.answers[id]).toMatchObject({ rating: 1, blindRating: 2, checkedAt })
    expect(computeInterviewReadiness(curriculum, p).overrated).toBe(1)
    // повторное открытие тезисов не сдвигает момент первой сверки
    expect(reducer(p, { type: 'interview/check', questionId: id })).toBe(p)
  })

  it('normalizes answers from a file, dropping broken entries', () => {
    const raw = {
      interview: {
        answers: {
          a: {
            rating: 2,
            blindRating: 3,
            checkedAt: at(T0),
            ratedAt: at(T0 + DAY),
            updatedAt: at(T0 + DAY),
          },
          b: { rating: 1, blindRating: 9 },
        },
      },
    }
    const p = normalizeProgress(raw, curriculum)
    expect(p.interview.answers.a).toMatchObject({
      rating: 2,
      blindRating: 3,
      checkedAt: at(T0),
      ratedAt: at(T0 + DAY),
    })
    expect(p.interview.answers.b.blindRating).toBeUndefined()
  })

  it('schedules a new assessment from its date rather than the first thesis reveal', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      vi.setSystemTime(T0 - 30 * DAY)
      let p = reducer(createEmptyProgress(curriculum), {
        type: 'interview/rating',
        questionId: 'iv-sv-1',
        rating: 3,
      })
      p = reducer(p, { type: 'interview/check', questionId: 'iv-sv-1' })
      vi.setSystemTime(T0)
      p = reducer(p, { type: 'interview/rating', questionId: 'iv-sv-1', rating: 2 })
      expect(interviewDueAt(p.interview.answers['iv-sv-1'])).toBe(T0 + 7 * DAY)
      vi.setSystemTime(T0 + 2 * DAY)
      p = reducer(p, { type: 'interview/note', questionId: 'iv-sv-1', note: 'Пример из практики' })
      expect(interviewDueAt(normalizeProgress(p, curriculum).interview.answers['iv-sv-1'])).toBe(
        T0 + 7 * DAY,
      )
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not postpone legacy answers when only a note changes', () => {
    let p = createEmptyProgress(curriculum)
    p.interview.answers['iv-sv-1'] = answer(2, 20)
    p.interview.answers['iv-sv-2'] = answer(2, 10, { checkedAt: at(T0 - 20 * DAY) })
    const due = ['iv-sv-1', 'iv-sv-2'].map((id) => interviewDueAt(p.interview.answers[id]))
    for (const id of ['iv-sv-1', 'iv-sv-2'])
      p = reducer(p, { type: 'interview/note', questionId: id, note: 'Заметка' })
    expect(['iv-sv-1', 'iv-sv-2'].map((id) => interviewDueAt(p.interview.answers[id]))).toEqual(due)
  })
})

describe('review schedule', () => {
  const topic: InterviewTopic = {
    id: 't',
    title: 't',
    group: 'mlops',
    trackIds: [],
    skillIds: [],
    incidentIds: [],
    questions: ['new', 'weak-due', 'strong-due', 'fresh-strong', 'fresh-weak'].map((id) => ({
      id,
      text: id,
      points: [],
      pitfall: '',
    })),
  }
  const answers: Record<string, InterviewAnswer> = {
    'weak-due': answer(0, 1),
    'strong-due': answer(3, INTERVIEW_REVIEW_DAYS[2] + 1),
    'fresh-strong': answer(2, 1),
    'fresh-weak': answer(1, 0),
  }

  it('schedules review by rating, the legacy rating like «объясню самостоятельно»', () => {
    expect(interviewDueAt(undefined)).toBe(0)
    expect(isInterviewDue(answers['weak-due'], T0)).toBe(true)
    expect(isInterviewDue(answers['strong-due'], T0)).toBe(true)
    expect(isInterviewDue(answers['fresh-strong'], T0)).toBe(false)
    expect(isInterviewDue(answers['fresh-weak'], T0)).toBe(false)
    expect(isInterviewDue(answers['fresh-weak'], T0 + DAY)).toBe(true)
    expect(interviewDueAt(answer(3))).toBe(interviewDueAt(answer(2)))
  })

  it('keeps new questions out of the review list', () => {
    expect(isReviewDue(undefined, T0)).toBe(false)
    const due = interviewReviewTopics([topic], answers, T0)
    expect(due.map((t) => t.questions.map((q) => q.id))).toEqual([['weak-due', 'strong-due']])
    expect(interviewReviewTopics([topic], {}, T0)).toEqual([])
  })
})
