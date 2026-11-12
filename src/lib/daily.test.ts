import { describe, expect, it } from 'vitest'
import { curriculum } from '../data'
import { reducer } from '../state/reducer'
import type { UserProgress } from '../types'
import { dailyDoneCount, dailySet, dayKey, EMPTY_DAILY_PREFS, recommendedDailyItem, type DailyItem } from './daily'
import { createEmptyProgress } from './storage'

const NOW = new Date(2026, 9, 8, 15, 0).getTime()
const DAY = 86_400_000
const iso = (ms: number) => new Date(ms).toISOString()
const byKind = (p: UserProgress, now = NOW, prefs = EMPTY_DAILY_PREFS) =>
  Object.fromEntries(dailySet(curriculum, p, now, prefs).map((i) => [i.kind, i]))
const empty = () => ({
  ...createEmptyProgress(curriculum),
  meta: {
    createdAt: iso(NOW - 30 * DAY),
    updatedAt: iso(NOW),
    curriculumVersion: curriculum.version,
  },
})

describe('recommended daily format', () => {
  it('is stable throughout a local day and does not mutate the set', () => {
    const items = dailySet(curriculum, empty(), NOW)
    const before = structuredClone(items)
    const first = recommendedDailyItem(items, NOW)
    expect(first).toBeDefined()
    expect(recommendedDailyItem(items, NOW - 6 * 3600_000)).toEqual(first)
    expect(recommendedDailyItem(items, NOW + 6 * 3600_000)).toEqual(first)
    expect(recommendedDailyItem([...items].reverse(), NOW)).toEqual(first)
    expect(items).toEqual(before)
  })

  it.each(['due', 'in_progress'] as const)('prefers %s to new formats', (status) => {
    const items = dailySet(curriculum, empty(), NOW)
    for (const chosen of items) {
      const mixed = items.map((i) => ({ ...i, status: i === chosen ? status : 'new' } as DailyItem))
      expect(recommendedDailyItem(mixed, NOW)?.id).toBe(chosen.id)
    }
  })

  it('moves away from a format done today while preserving the honest count', () => {
    const p = empty()
    const first = byKind(p)
    const answered = {
      ...p,
      practice: {
        [first.trainer.id]: { seen: 1, correct: 0, streak: 0, lastCorrect: false, lastAt: iso(NOW) },
      },
    }
    const items = dailySet(curriculum, answered, NOW)
    expect(dailyDoneCount(items)).toBe(1)
    expect(items.find((i) => i.kind === 'trainer')?.status).toBe('done')
    expect(recommendedDailyItem(items, NOW)?.kind).not.toBe('trainer')
    expect(recommendedDailyItem(items.map((i) => ({ ...i, status: 'done' })), NOW)).toBeUndefined()
    expect(recommendedDailyItem([], NOW)).toBeUndefined()
  })

  it('respects skipped IDs and hidden topics without counting them as done', () => {
    const p = empty()
    const first = dailySet(curriculum, p, NOW)
    const recommended = recommendedDailyItem(first, NOW)!
    const skipped = dailySet(curriculum, p, NOW, {
      skipped: { day: dayKey(NOW), ids: [recommended.id] }, hidden: [],
    })
    expect(skipped.some((i) => i.id === recommended.id)).toBe(false)
    expect(recommendedDailyItem(skipped, NOW)?.id).not.toBe(recommended.id)
    expect(dailyDoneCount(skipped)).toBe(0)
    const hidden = dailySet(curriculum, p, NOW, {
      skipped: { day: '', ids: [] }, hidden: [recommended.topic],
    })
    expect(hidden.some((i) => i.topic === recommended.topic)).toBe(false)
    expect(recommendedDailyItem(hidden, NOW)?.topic).not.toBe(recommended.topic)
    expect(dailyDoneCount(hidden)).toBe(0)
  })

  it('counts an incident by its first valid successful report, not a saved solvedAt', () => {
    const def = curriculum.incidents[0]
    const p = empty()
    const report = {
      id: 'real', at: iso(NOW), passed: false, source: 'auto' as const,
      checks: def.checks.map((c) => ({ id: c.id, ok: true, message: '' })),
    }
    const today = { ...p, incidents: { [def.id]: { hintsShown: 0, reports: [report] } } }
    expect(dailyDoneCount(dailySet(curriculum, today, NOW))).toBe(1)
    const stale = {
      ...p,
      incidents: { [def.id]: { hintsShown: 0, solvedAt: iso(NOW), reports: [{ ...report, at: iso(NOW - DAY) }] } },
    }
    expect(dailyDoneCount(dailySet(curriculum, stale, NOW))).toBe(0)
    const partial = {
      ...p,
      incidents: { [def.id]: { hintsShown: 0, solvedAt: iso(NOW), reports: [{ ...report, passed: true, checks: [] }] } },
    }
    expect(dailyDoneCount(dailySet(curriculum, partial, NOW))).toBe(0)
  })
})

describe('daily set', () => {
  it('offers one task of each format, starting with exercises and easy incidents', () => {
    const set = byKind(empty())
    expect(Object.keys(set).sort()).toEqual(['gym', 'incident', 'interview', 'trainer'])
    expect(curriculum.exercises.some((x) => x.exercises.some((e) => e.id === set.trainer.id))).toBe(
      true,
    )
    expect(curriculum.incidents.find((d) => d.id === set.incident.id)?.level).toBe('start')
    expect(Object.values(set).every((i) => i.status === 'new')).toBe(true)
    expect(set.trainer.link).toEqual({ page: 'trainer', params: { item: set.trainer.id } })
    expect(set.interview.link.params.q).toBe(set.interview.id)
  })

  it('stays the same within a day and keeps a task done today in place', () => {
    const p = empty()
    const first = byKind(p)
    expect(byKind(p, NOW + 3 * 3600_000)).toEqual(first)
    const answered = {
      ...p,
      practice: {
        [first.trainer.id]: { seen: 1, correct: 1, streak: 1, lastCorrect: true, lastAt: iso(NOW) },
      },
    }
    expect(byKind(answered).trainer).toMatchObject({ id: first.trainer.id, status: 'done' })
    // назавтра сделанное вчера уже не отмечено: после первого верного ответа оно само приходит на повторение
    expect(byKind(answered, NOW + DAY).trainer).toMatchObject({
      id: first.trainer.id,
      status: 'due',
    })
  })

  it('puts reviews that are due before anything new', () => {
    const drillQ = curriculum.drills[3].questions[2].id
    const p = {
      ...empty(),
      practice: {
        [drillQ]: {
          seen: 1,
          correct: 0,
          streak: 0,
          lastCorrect: false,
          lastAt: iso(NOW - 2 * DAY),
        },
      },
    }
    expect(byKind(p).trainer).toMatchObject({ id: drillQ, status: 'due' })
  })

  it('skips an item only for today and hides whole topics until they are returned', () => {
    const p = empty()
    const first = byKind(p)
    const skipped = byKind(p, NOW, {
      skipped: { day: dayKey(NOW), ids: [first.interview.id] },
      hidden: [],
    })
    expect(skipped.interview.id).not.toBe(first.interview.id)
    expect(
      byKind(p, NOW, { skipped: { day: dayKey(NOW - DAY), ids: [first.interview.id] }, hidden: [] })
        .interview.id,
    ).toBe(first.interview.id)
    const hidden = byKind(p, NOW, { skipped: { day: '', ids: [] }, hidden: [first.incident.topic] })
    expect(hidden.incident.topic).not.toBe(first.incident.topic)
  })

  it('marks an interview question rated today as done and prefers questions due for review', () => {
    const q = curriculum.interviewTopics[2].questions[1].id
    let p = empty()
    p = reducer(p, { type: 'interview/rating', questionId: q, rating: 1 })
    const rated = p.interview.answers[q]
    const today = {
      ...p,
      interview: {
        ...p.interview,
        answers: { [q]: { ...rated, ratedAt: iso(NOW), updatedAt: iso(NOW) } },
      },
    }
    expect(byKind(today).interview).toMatchObject({ id: q, status: 'done' })
    const overdue = {
      ...p,
      interview: {
        ...p.interview,
        answers: { [q]: { ...rated, ratedAt: iso(NOW - 5 * DAY), updatedAt: iso(NOW - 5 * DAY) } },
      },
    }
    expect(byKind(overdue).interview).toMatchObject({ id: q, status: 'due' })
  })

  it('continues an incident in progress, and shows only incidents solved today as done', () => {
    const def = curriculum.incidents.find((d) => d.level === 'challenge')!
    const started = {
      ...empty(),
      incidents: { [def.id]: { hintsShown: 0, startedAt: iso(NOW - DAY), reports: [] } },
    }
    expect(byKind(started).incident).toMatchObject({ id: def.id, status: 'in_progress' })
    const solvedToday = {
      ...empty(),
      incidents: {
        [def.id]: {
          hintsShown: 0,
          startedAt: iso(NOW - DAY),
          solvedAt: iso(NOW - 3600_000),
          reports: [
            {
              id: 'today',
              at: iso(NOW - 3600_000),
              passed: true,
              source: 'auto' as const,
              checks: def.checks.map((c) => ({ id: c.id, ok: true, message: '' })),
            },
          ],
        },
      },
    }
    expect(byKind(solvedToday).incident).toMatchObject({ id: def.id, status: 'done' })
    const solvedBefore = {
      ...empty(),
      incidents: {
        [def.id]: {
          hintsShown: 0,
          startedAt: iso(NOW - 3 * DAY),
          solvedAt: iso(NOW - 2 * DAY),
          reports: [
            {
              id: 'old',
              at: iso(NOW - 2 * DAY),
              passed: true,
              source: 'auto' as const,
              checks: def.checks.map((c) => ({ id: c.id, ok: true, message: '' })),
            },
          ],
        },
      },
    }
    expect(byKind(solvedBefore).incident.id).not.toBe(def.id)
  })

  it('brings a gym that is due, keeps a full session today as done and leaves paused gyms out', () => {
    const g = curriculum.gyms[1]
    const at = (ms: number) => iso(ms)
    const full = Object.fromEntries(g.reps.map((r) => [r.id, at(NOW - 3 * DAY)]))
    const due = {
      ...empty(),
      gyms: {
        [g.id]: {
          sessions: [
            {
              id: 's1',
              startedAt: at(NOW - 3 * DAY - 600_000),
              finishedAt: at(NOW - 3 * DAY),
              reps: full,
            },
          ],
        },
      },
    }
    expect(byKind(due).gym).toMatchObject({ id: g.id, status: 'due' })
    const today = {
      ...empty(),
      gyms: {
        [g.id]: {
          sessions: [
            {
              id: 's2',
              startedAt: at(NOW - 3600_000),
              finishedAt: at(NOW - 600_000),
              reps: Object.fromEntries(g.reps.map((r) => [r.id, at(NOW - 600_000)])),
            },
          ],
        },
      },
    }
    expect(byKind(today).gym).toMatchObject({ id: g.id, status: 'done' })
    const paused = {
      ...empty(),
      gyms: Object.fromEntries(curriculum.gyms.map((x) => [x.id, { sessions: [], paused: true }])),
    }
    expect(byKind(paused).gym).toBeUndefined()
  })
})
