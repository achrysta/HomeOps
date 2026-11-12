import { describe, expect, it } from 'vitest'
import { DEFAULT_VACANCY_ID } from '../config/learning'
import { QUIZ_SIZE } from '../config/weights'
import { curriculum } from '../data'
import { reducer, type Action } from '../state/reducer'
import type { UserProgress } from '../types'
import {
  buildIndex,
  computeSkillLevels,
  computeVacancyMatch,
  coreTasks,
  getAvailability,
  getVerification,
  matchOrigin,
  nextActions,
  summarize,
} from './progress'
import { createEmptyProgress } from './storage'

const idx = buildIndex(curriculum)
const vacancy = curriculum.vacancies[0]
const run = (p: UserProgress, ...actions: Action[]) => actions.reduce(reducer, p)
const task = (id: string) => idx.taskById.get(id)!

/** Полностью засчитать задачу: статус, все criteria, evidence. */
function complete(p: UserProgress, id: string): UserProgress {
  const t = task(id)
  return run(
    p,
    { type: 'task/status', id, status: 'completed' },
    ...t.acceptanceCriteria.map((criterion): Action => ({ type: 'task/criterion', id, criterion, done: true })),
    { type: 'task/evidence/add', id, evidence: { type: 'commit', value: 'abc123' } },
  )
}

/** Сдать контрольный тест полной попыткой без ошибок. */
const passQuiz = (p: UserProgress, id: string) =>
  run(p, { type: 'quiz/attempt', id, attempt: { correct: QUIZ_SIZE, total: QUIZ_SIZE, passed: true, wrongIds: [] } })

const matchOf = (p: UserProgress) => computeVacancyMatch(vacancy, computeSkillLevels(curriculum, p), idx)

describe('verification', () => {
  it('does not count a lab marked Completed without evidence', () => {
    let p = createEmptyProgress(curriculum)
    p = run(p, { type: 'task/status', id: 'A1', status: 'completed' })
    expect(getVerification(task('A1'), p.tasks.A1)).toBe('needs_both')
    for (const criterion of task('A1').acceptanceCriteria) p = run(p, { type: 'task/criterion', id: 'A1', criterion, done: true })
    expect(getVerification(task('A1'), p.tasks.A1)).toBe('needs_evidence')
    p = run(p, { type: 'task/evidence/add', id: 'A1', evidence: { type: 'repo', value: 'gitlab.com/me/labs/a1' } })
    expect(getVerification(task('A1'), p.tasks.A1)).toBe('verified')
  })

  it('accepts reading tasks without evidence but still requires criteria', () => {
    let p = run(createEmptyProgress(curriculum), { type: 'task/status', id: 'B0', status: 'completed' })
    expect(getVerification(task('B0'), p.tasks.B0)).toBe('needs_criteria')
    for (const criterion of task('B0').acceptanceCriteria) p = run(p, { type: 'task/criterion', id: 'B0', criterion, done: true })
    expect(getVerification(task('B0'), p.tasks.B0)).toBe('verified')
  })

  it('ignores empty evidence values', () => {
    const p = run(createEmptyProgress(curriculum), { type: 'task/evidence/add', id: 'A1', evidence: { type: 'note', value: '   ' } })
    expect(p.tasks.A1).toBeUndefined()
  })
})

describe('dependencies', () => {
  it('locks tasks until prerequisites are verified', () => {
    let p = createEmptyProgress(curriculum)
    expect(getAvailability(task('A0.1'), idx, p)).toBe('ready')
    expect(getAvailability(task('A0.2'), idx, p)).toBe('locked')
    p = run(p, { type: 'task/status', id: 'A0.1', status: 'completed' })
    expect(getAvailability(task('A0.2'), idx, p)).toBe('locked')
    p = complete(p, 'A0.1')
    expect(getAvailability(task('A0.2'), idx, p)).toBe('ready')
  })

  it('treats a blocked environment-dependent lab as non-blocking', () => {
    let p = complete(createEmptyProgress(curriculum), 'C0')
    expect(getAvailability(task('C2'), idx, p)).toBe('locked')
    p = run(p, { type: 'task/status', id: 'C1', status: 'blocked' })
    expect(getAvailability(task('C1'), idx, p)).toBe('env_skipped')
    expect(getAvailability(task('C2'), idx, p)).toBe('ready')
  })

  it('keeps a blocked regular task blocking its dependents', () => {
    const p = run(createEmptyProgress(curriculum), { type: 'task/status', id: 'A0.1', status: 'blocked' })
    expect(getAvailability(task('A0.1'), idx, p)).toBe('blocked')
    expect(getAvailability(task('A0.2'), idx, p)).toBe('locked')
  })
})

describe('learning progress', () => {
  it('weights labs above docs', () => {
    const core = coreTasks(curriculum, idx)
    const docs = summarize(core, complete(createEmptyProgress(curriculum), 'B0'))
    const lab = summarize(core, complete(createEmptyProgress(curriculum), 'B1'))
    const integration = summarize(core, complete(createEmptyProgress(curriculum), 'A4'))
    expect(docs.earned).toBe(1)
    expect(lab.earned).toBe(4)
    expect(integration.earned).toBe(6)
    expect(lab.pct).toBeGreaterThan(docs.pct)
  })

  it('excludes optional, fundamentals and advanced tasks from core progress', () => {
    const core = coreTasks(curriculum, idx)
    expect(core.some((t) => t.optional)).toBe(false)
    expect(core.some((t) => t.trackId === 'fundamentals' || t.trackId === 'advanced')).toBe(false)
    const p = complete(createEmptyProgress(curriculum), 'F0.1')
    expect(summarize(core, p).earned).toBe(0)
  })

  it('removes env-skipped labs from the denominator', () => {
    const core = coreTasks(curriculum, idx)
    const before = summarize(core, createEmptyProgress(curriculum))
    const after = summarize(core, run(createEmptyProgress(curriculum), { type: 'task/status', id: 'C1', status: 'blocked' }))
    expect(after.total).toBe(before.total - 4)
    expect(after.envSkipped).toBe(1)
  })
})

describe('vacancy match', () => {
  it('starts from zero until the learner assesses their own experience', () => {
    const m = matchOf(createEmptyProgress(curriculum))
    expect(m.overall).toBe(0)
    const k8s = m.rows.find((r) => r.skill.id === 'kubernetes')!
    expect(k8s.current).toBe(0)
    expect(k8s.gap).toBeGreaterThan(0)
  })

  it('does not let advanced skills affect the score', () => {
    const base = matchOf(createEmptyProgress(curriculum)).overall
    let p = createEmptyProgress(curriculum)
    for (const id of ['X1', 'X2', 'X3', 'X4', 'X5', 'X6']) p = complete(p, id)
    expect(matchOf(p).overall).toBeCloseTo(base, 10)
  })

  it('caps the bonus contribution', () => {
    let p = createEmptyProgress(curriculum)
    for (const req of vacancy.requirements.filter((r) => r.importance === 'bonus')) {
      p = run(p, { type: 'skill/self', id: req.skillId, selfLevel: 4, note: 'test' })
    }
    const m = matchOf(p)
    expect(m.categories.bonus.pct).toBe(1)
    const base = matchOf(createEmptyProgress(curriculum))
    expect(m.overall - base.overall).toBeLessThanOrEqual(0.08 + 1e-9)
  })

  it('ignores self-assessment without justification', () => {
    const p = run(createEmptyProgress(curriculum), { type: 'skill/self', id: 'llm-eval', selfLevel: 3, note: '' })
    const row = matchOf(p).rows.find((r) => r.skill.id === 'llm-eval')!
    expect(row.current).toBe(0)
    const p2 = run(p, { type: 'skill/self', id: 'llm-eval', selfLevel: 3, note: 'Делал eval-платформу на прошлой работе' })
    expect(matchOf(p2).rows.find((r) => r.skill.id === 'llm-eval')!.current).toBe(3)
  })

  it('raises skill level from verified labs', () => {
    const p = complete(createEmptyProgress(curriculum), 'F7')
    const row = matchOf(p).rows.find((r) => r.skill.id === 'llm-eval')!
    expect(row.current).toBe(3)
    expect(row.info.verifiedTaskIds).toContain('F7')
  })

  it('splits the score by origin: baseline at start, practice after verified labs', () => {
    const start = matchOf(createEmptyProgress(curriculum))
    const o = matchOrigin(start)
    expect(o.practice).toBe(0)
    expect(o.self).toBe(0)
    expect(o.baseline).toBeCloseTo(start.overall, 10)

    let p = complete(createEmptyProgress(curriculum), 'F7')
    p = run(p, { type: 'skill/self', id: 'vllm', selfLevel: 2, note: 'Поднимал vLLM в пет-проекте' })
    const m = matchOf(p)
    const o2 = matchOrigin(m)
    expect(o2.practice).toBeGreaterThan(0)
    expect(o2.self).toBeGreaterThan(0)
    expect(o2.practice + o2.baseline + o2.self).toBeCloseTo(m.overall, 10)
  })

  it('gives 100% when every requirement meets its target', () => {
    let p = createEmptyProgress(curriculum)
    for (const req of vacancy.requirements) p = run(p, { type: 'skill/self', id: req.skillId, selfLevel: req.targetLevel, note: 'ok' })
    const m = matchOf(p)
    expect(m.overall).toBeCloseTo(1)
  })
})

describe('next actions', () => {
  it('MLOps profile starts with track A and offers independent C0 reading for role gaps in parallel', () => {
    const p = createEmptyProgress(curriculum)
    const actions = nextActions(curriculum, idx, p, vacancy, computeSkillLevels(curriculum, p), curriculum.tasks.length)
    expect(actions[0].task.id).toBe('A0.1')
    expect(actions[0].type).toBe('start')
    expect(getAvailability(task('A0.1'), idx, p)).toBe('ready')
    const c0 = actions.find((a) => a.task.id === 'C0')!
    expect(c0.task.prerequisites).toEqual([])
    expect(c0.score).toBeLessThan(actions[0].score)
    expect(c0.why).toContain('параллельно текущему треку')
  })

  it('Platform Engineer route goes through the platform base before ML specialization tracks', () => {
    const core = curriculum.tracks.filter((t) => t.kind === 'core')
    expect(core.slice(0, 2).map((t) => t.id)).toEqual(['platform-iac', 'python'])
    const pe = curriculum.vacancies.find((v) => v.id === DEFAULT_VACANCY_ID)!
    let p = createEmptyProgress(curriculum)
    const route: string[] = []
    for (let i = 0; i < 12; i++) {
      const next = nextActions(curriculum, idx, p, pe, computeSkillLevels(curriculum, p), 1)[0]
      route.push(next.task.id)
      p = next.task.kind === 'quiz' ? passQuiz(p, next.task.id) : complete(p, next.task.id)
    }
    expect(route[0]).toBe('K1')
    const platform = new Set(['platform-iac', 'python'])
    const firstSpecialization = route.findIndex((id) => !platform.has(task(id).trackId))
    const platformBase = curriculum.tasks.filter((t) => t.trackId === 'platform-iac' && !t.optional).map((t) => t.id)
    expect(firstSpecialization).toBeGreaterThan(0)
    for (const id of platformBase) expect(route.indexOf(id), id).toBeGreaterThanOrEqual(0)
    for (const id of platformBase) expect(route.indexOf(id), id).toBeLessThan(firstSpecialization)
  })

  it('suggests only tasks with satisfied prerequisites', () => {
    const p = createEmptyProgress(curriculum)
    const levels = computeSkillLevels(curriculum, p)
    const actions = nextActions(curriculum, idx, p, vacancy, levels)
    expect(actions).toHaveLength(3)
    for (const a of actions) expect(getAvailability(a.task, idx, p)).toBe('ready')
    expect(new Set(actions.map((a) => a.task.id)).size).toBe(3)
  })

  it('puts unverified completed work first', () => {
    const p = run(createEmptyProgress(curriculum), { type: 'task/status', id: 'E0', status: 'completed' })
    const actions = nextActions(curriculum, idx, p, vacancy, computeSkillLevels(curriculum, p))
    expect(actions[0].task.id).toBe('E0')
    expect(actions[0].type).toBe('verify')
  })
})
