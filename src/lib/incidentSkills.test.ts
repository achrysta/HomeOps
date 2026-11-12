import { describe, expect, it } from 'vitest'
import { DEFAULT_VACANCY_ID } from '../config/learning'
import { INCIDENT_LEVEL } from '../config/weights'
import { curriculum } from '../data'
import type { UserProgress } from '../types'
import { buildIndex, computeSkillLevels, computeVacancyMatch, coreTasks, summarize } from './progress'
import { createEmptyProgress, normalizeProgress } from './storage'

const empty = () => {
  const p = createEmptyProgress(curriculum)
  p.meta.createdAt = '2026-10-08T10:00:00.000Z'
  return p
}

function solve(p: UserProgress, id: string, debrief?: 'before' | 'after'): UserProgress {
  const def = curriculum.incidents.find((d) => d.id === id)!
  return normalizeProgress({ ...p, incidents: { ...p.incidents, [id]: {
    hintsShown: 0, startedAt: p.meta.createdAt,
    ...(debrief ? { debriefOpenedAt: debrief === 'before' ? '2026-10-08T10:30:00.000Z' : '2026-10-08T11:30:00.000Z' } : {}),
    reports: [{ id: `r-${id}`, at: '2026-10-08T11:00:00.000Z', passed: true, source: 'auto', checks: def.checks.map((check) => ({ id: check.id, ok: true, message: 'OK' })) }],
  } } }, curriculum)
}

describe('solved stands as skill evidence', () => {
  it('grants level 2 for an independent solve and level 1 after the debrief', () => {
    expect(computeSkillLevels(curriculum, empty()).get('postgresql-ops')).toMatchObject({ earned: 0, solvedIncidentIds: [] })
    expect(computeSkillLevels(curriculum, solve(empty(), 'pg-pitr')).get('postgresql-ops')).toMatchObject({ earned: INCIDENT_LEVEL.independent, solvedIncidentIds: ['pg-pitr'] })
    expect(computeSkillLevels(curriculum, solve(empty(), 'pg-pitr', 'after')).get('backup-restore')?.earned).toBe(INCIDENT_LEVEL.independent)
    expect(computeSkillLevels(curriculum, solve(empty(), 'pg-pitr', 'before')).get('postgresql-ops')?.earned).toBe(INCIDENT_LEVEL.withDebrief)
  })

  it('ignores an untrusted passed flag and reports from before the progress was created', () => {
    const p = solve(empty(), 'linux-oom')
    p.incidents['linux-oom'].reports[0].checks[0].ok = false
    expect(computeSkillLevels(curriculum, normalizeProgress(p, curriculum)).get('linux')?.earned).toBe(0)
    const early = solve({ ...empty(), meta: { ...empty().meta, createdAt: '2026-10-09T00:00:00.000Z' } }, 'linux-oom')
    expect(computeSkillLevels(curriculum, early).get('linux')?.earned).toBe(0)
  })

  it('raises the role match but not the learning progress', () => {
    const role = curriculum.vacancies.find((v) => v.id === DEFAULT_VACANCY_ID)!
    const idx = buildIndex(curriculum)
    const before = empty()
    const after = ['linux-oom', 'linux-dns', 'pg-sync-replica'].reduce((p, id) => solve(p, id), empty())
    const match = (p: UserProgress) => computeVacancyMatch(role, computeSkillLevels(curriculum, p), idx).overall
    expect(match(after)).toBeGreaterThan(match(before))
    const core = coreTasks(curriculum, idx)
    expect(summarize(core, after)).toEqual(summarize(core, before))
  })

  it('makes the platform profile the first-run target and keeps the ML profile available', () => {
    expect(empty().activeVacancyId).toBe('platform-engineer')
    expect(curriculum.vacancies.map((v) => v.id)).toEqual(expect.arrayContaining(['platform-engineer', 'mlops-ai-platform']))
  })
})
