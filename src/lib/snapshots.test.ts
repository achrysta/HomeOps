import { describe, expect, it } from 'vitest'
import { curriculum } from '../data'
import { reducer } from '../state/reducer'
import { compareStats, progressStats } from './snapshots'
import { createEmptyProgress } from './storage'

describe('snapshot preview', () => {
  it('counts progress and reports what a restore would lose', () => {
    const empty = createEmptyProgress(curriculum)
    const quiz = curriculum.tasks.find((t) => t.kind === 'quiz')!
    let p = reducer(empty, { type: 'quiz/attempt', id: quiz.id, attempt: { correct: 18, total: 20, passed: true, wrongIds: [] } })
    p = { ...p, journal: [{ id: 'old', date: '2026-10-07', did: 'тест', learned: '', unclear: '', evidenceUrl: '' }] }
    const now = progressStats(p, curriculum)
    expect(now).toMatchObject({ tasksVerified: 1, quizzesPassed: 1, journal: 1 })

    const { rows, lost } = compareStats(now, progressStats(empty, curriculum))
    expect(rows.find((r) => r.key === 'tasksVerified')).toMatchObject({ current: 1, snapshot: 0 })
    expect(lost.map((r) => r.key).sort()).toEqual(['journal', 'quizzesPassed', 'tasksTouched', 'tasksVerified'])
    // без записей старого дневника строки для него нет
    const blank = progressStats(empty, curriculum)
    expect(compareStats(blank, blank).rows.some((r) => r.key === 'journal')).toBe(false)
  })
})
