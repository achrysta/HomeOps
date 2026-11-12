import { describe, expect, it } from 'vitest'
import { curriculum } from '../data'
import { EMPTY_FILTERS, filterTasks, isFilterActive } from './filters'
import { buildIndex, isPracticeTask } from './progress'
import { createEmptyProgress } from './storage'

const idx = buildIndex(curriculum)
const vacancy = curriculum.vacancies[0]
const progress = createEmptyProgress(curriculum)

describe('task filters', () => {
  it('«вся практика» shows exercises, labs and integrations, but not reading or quizzes', () => {
    const practice = filterTasks(curriculum.tasks, { ...EMPTY_FILTERS, kind: 'practice' }, idx, progress, vacancy)
    expect(practice.length).toBe(curriculum.tasks.filter(isPracticeTask).length)
    expect(practice.every(isPracticeTask)).toBe(true)
    expect(new Set(practice.map((t) => t.kind))).toEqual(new Set(['exercise', 'lab', 'integration']))
    expect(isFilterActive({ ...EMPTY_FILTERS, kind: 'practice' })).toBe(true)
  })

  it('a single kind still filters exactly by that kind', () => {
    const labs = filterTasks(curriculum.tasks, { ...EMPTY_FILTERS, kind: 'lab' }, idx, progress, vacancy)
    expect(labs.length).toBeGreaterThan(0)
    expect(labs.every((t) => t.kind === 'lab')).toBe(true)
  })
})
