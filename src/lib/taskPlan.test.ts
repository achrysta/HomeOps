import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { incidentMetadata } from '../../scripts/incidentMetadata'
import { curriculum } from '../data'
import { tasks } from '../data/curriculum'
import { labSteps } from '../data/labSteps'
import { withTaskPlan } from './taskPlan'
import { buildIndex, computeInterviewReadiness, computeSkillLevels, computeVacancyMatch, getTaskProgress, getVerification, summarize } from './progress'
import { createEmptyProgress, normalizeProgress } from './storage'
import { reducer, type Action } from '../state/reducer'
import { search } from './search'
import { todayIncident, todayReviews } from './today'

describe('task catalog without eager plans', () => {
  it('preserves verification, levels, role match and self-check summary with confirmed and unconfirmed tasks', () => {
    const metadata = { ...curriculum, tasks, incidents: incidentMetadata(readFileSync(new URL('../data/incidents.ts', import.meta.url), 'utf8')) }
    let p = createEmptyProgress(curriculum)
    const selected = curriculum.tasks.filter((t) => t.kind === 'lab').slice(0, 2)
    for (const task of selected) {
      const actions: Action[] = [{ type: 'task/status', id: task.id, status: 'completed' }]
      if (task === selected[0]) actions.push(...task.acceptanceCriteria.map((criterion): Action => ({ type: 'task/criterion', id: task.id, criterion, done: true })), { type: 'task/evidence/add', id: task.id, evidence: { type: 'commit', value: 'Контрольный пример' } })
      p = actions.reduce(reducer, p)
    }
    const def = curriculum.incidents[0], at = new Date().toISOString()
    p.incidents[def.id] = { hintsShown: 2, solvedAt: at, reports: [{ id: 'metadata-proof', at, source: 'auto', passed: true, checks: def.checks.map((c) => ({ id: c.id, ok: true, message: 'Проверено' })) }] }
    expect(getVerification(selected[0], getTaskProgress(p, selected[0].id))).toBe('verified')
    expect(getVerification(selected[1], getTaskProgress(p, selected[1].id))).not.toBe('verified')
    const before = JSON.stringify(p)
    for (const task of curriculum.tasks) expect(getVerification(task, getTaskProgress(p, task.id))).toEqual(getVerification(tasks.find((t) => t.id === task.id)!, getTaskProgress(p, task.id)))
    expect(summarize(metadata.tasks, p)).toEqual(summarize(curriculum.tasks, p))
    const levels = computeSkillLevels(metadata, p)
    expect(levels).toEqual(computeSkillLevels(curriculum, p))
    expect(computeVacancyMatch(curriculum.vacancies[0], levels, buildIndex(metadata))).toEqual(computeVacancyMatch(curriculum.vacancies[0], levels, buildIndex(curriculum)))
    expect(computeInterviewReadiness(metadata, p)).toEqual(computeInterviewReadiness(curriculum, p))
    const now = Date.now()
    const hits = search('Python', metadata, p)
    expect({ ...hits, tasks: hits.tasks.map((t) => withTaskPlan(t, labSteps)) }).toEqual(search('Python', curriculum, p))
    expect(todayReviews(metadata, p, now)).toEqual(todayReviews(curriculum, p, now))
    expect(todayIncident(metadata, p, now)).toEqual(todayIncident(curriculum, p, now))
    expect(normalizeProgress(p, metadata)).toEqual(normalizeProgress(p, curriculum))
    expect(JSON.stringify(p)).toBe(before)
  })
  it('restores every original plan only in the card view without mutating metadata', () => {
    const before = JSON.stringify(tasks)
    for (const task of tasks) {
      const full = withTaskPlan(task, labSteps)
      expect(full).toEqual(curriculum.tasks.find((t) => t.id === task.id))
      expect(full.acceptanceCriteria).toBe(task.acceptanceCriteria)
    }
    expect(JSON.stringify(tasks)).toBe(before)
  })
  it('keeps every incident field and hint count while excluding only hint/debrief texts', () => {
    const source = readFileSync(new URL('../data/incidents.ts', import.meta.url), 'utf8')
    const metadata = incidentMetadata(source)
    expect(metadata).toHaveLength(curriculum.incidents.length)
    metadata.forEach((d, i) => {
      expect(d).toEqual({ ...curriculum.incidents[i], hints: curriculum.incidents[i].hints.map(() => ''), debrief: { cause: '', fix: '', lesson: '' } })
    })
    expect(() => incidentMetadata('export const incidents = [makeIncident()]')).toThrow()
    expect(() => incidentMetadata('export const other = []')).toThrow()
  })
})
