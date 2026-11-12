import { describe, expect, it } from 'vitest'
import { curriculum } from '../data'
import { reducer } from '../state/reducer'
import { search } from './search'
import { incidentStatusFor } from './incidents'
import { buildExport, createEmptyProgress, normalizeProgress, parseImport } from './storage'
import { DEFAULT_VACANCY_ID } from '../config/learning'

describe('export / import', () => {
  it('round-trips the full user progress', () => {
    let p = createEmptyProgress(curriculum)
    p = reducer(p, { type: 'task/status', id: 'A2', status: 'in_progress' })
    p = reducer(p, { type: 'task/notes', id: 'A2', notes: 'timeout через asyncio.timeout' })
    p = reducer(p, { type: 'task/evidence/add', id: 'A2', evidence: { type: 'url', value: 'https://gitlab.com/me/gw', description: 'MR' } })
    p = reducer(p, { type: 'resource/toggle', id: 'fastapi-tutorial' })
    p = reducer(p, { type: 'skill/self', id: 'python', selfLevel: 2, note: 'CLI A1' })
    p = reducer(p, { type: 'interview/rating', questionId: 'iv-py-1', rating: 2 })
    // дневника в интерфейсе больше нет, но старые записи из файла не теряются при экспорте и импорте
    p = { ...p, journal: [{ id: 'old', date: '2026-10-07', did: 'A1', learned: 'gather', unclear: 'TaskGroup', evidenceUrl: '' }] }

    const text = JSON.stringify(buildExport(p, curriculum))
    const res = parseImport(text, curriculum)
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.progress.tasks).toEqual(p.tasks)
    expect(res.progress.resources).toEqual(p.resources)
    expect(res.progress.skills).toEqual(p.skills)
    expect(res.progress.interview).toEqual(p.interview)
    expect(res.progress.journal).toEqual(p.journal)
    expect(res.warnings).toEqual([])
  })

  it('rejects invalid input', () => {
    expect(parseImport('not json', curriculum).ok).toBe(false)
    expect(parseImport('[1,2]', curriculum).ok).toBe(false)
    expect(parseImport('{"foo":1}', curriculum).ok).toBe(false)
  })

  it('keeps progress for unknown task ids and warns about them', () => {
    const res = parseImport(JSON.stringify({ tasks: { 'Z99': { status: 'completed' } }, journal: [] }), curriculum)
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.progress.tasks.Z99.status).toBe('completed')
    expect(res.warnings.join(' ')).toContain('Z99')
  })

  it('normalizes garbage fields to safe defaults', () => {
    const p = normalizeProgress(
      {
        activeVacancyId: 'missing',
        tasks: { A1: { status: 'weird', evidence: [{ value: '' }, { type: 'x', value: 'ok' }], criteriaDone: [1, 'a'] } },
        skills: { python: { selfLevel: 9 } },
        interview: { answers: { q: { rating: 7 } } },
        journal: [{}, { did: 'x' }],
      },
      curriculum,
    )
    expect(p.activeVacancyId).toBe(DEFAULT_VACANCY_ID)
    expect(p.tasks.A1.status).toBe('not_started')
    expect(p.tasks.A1.evidence).toHaveLength(1)
    expect(p.tasks.A1.evidence[0].type).toBe('note')
    expect(p.tasks.A1.criteriaDone).toEqual(['a'])
    expect(p.skills.python).toBeUndefined()
    expect(p.interview.answers.q).toBeUndefined()
    expect(p.journal).toHaveLength(1)
  })

  const def = curriculum.incidents[0]
  const createdAt = '2026-10-07T10:00:00.000Z'
  const at = '2026-10-07T11:00:00.000Z'
  const report = { id: 'verification', at, passed: true, source: 'upload', arch: 'aarch64', checks: def.checks.map((c) => ({ id: c.id, ok: true, message: 'ok' })) }
  const incidentProgress = (reports: unknown[], solvedAt = at) => ({ meta: { createdAt, updatedAt: at }, tasks: {}, incidents: { [def.id]: { hintsShown: 1, startedAt: createdAt, debriefOpenedAt: createdAt, solvedAt, reports } } })

  it.each([
    ['without a report', []],
    ['with a failed check', [{ ...report, checks: report.checks.map((c, i) => ({ ...c, ok: i !== 0 })) }]],
    ['with a missing check', [{ ...report, checks: report.checks.slice(1) }]],
    ['with a report before reset', [{ ...report, at: '2026-10-06T11:00:00.000Z' }]],
  ])('does not import a solved incident %s', (_case, reports) => {
    const res = parseImport(JSON.stringify(incidentProgress(reports)), curriculum)
    expect(res.ok).toBe(true)
    if (!res.ok) return
    const ip = res.progress.incidents[def.id]
    expect(ip.solvedAt).toBeUndefined()
    expect(incidentStatusFor(def, res.progress)).toBe('in_progress')
    expect(ip.reports.every((r) => !r.passed)).toBe(true)
    expect(res.warnings.join(' ')).toContain(def.title)
  })

  it('recomputes the solve time from valid reports and preserves hints, debrief and source on round-trip', () => {
    const raw = incidentProgress([{ ...report, passed: false }], '2026-10-07T09:00:00Z')
    const p = normalizeProgress(raw, curriculum)
    const ip = p.incidents[def.id]
    expect(ip.solvedAt).toBe(at)
    expect(ip.reports[0]).toEqual({ ...report, passed: true })
    expect(ip.hintsShown).toBe(1)
    expect(ip.debriefOpenedAt).toBe(createdAt)
    const res = parseImport(JSON.stringify(buildExport(p, curriculum)), curriculum)
    expect(res.ok && res.progress.incidents).toEqual(p.incidents)
    expect(normalizeProgress(p, curriculum)).toEqual(p)
  })

  it('keeps unknown incident data so it can be restored when the definition returns', () => {
    const raw = { hintsShown: 2, solvedAt: at, reports: [report] }
    expect(normalizeProgress({ incidents: { 'future-incident': raw } }, curriculum).incidents['future-incident']).toEqual(raw)
  })
})

describe('search', () => {
  it('finds tasks, resources, skills and user notes', () => {
    let p = createEmptyProgress(curriculum)
    p = reducer(p, { type: 'task/notes', id: 'C1', notes: 'Падает с OOM на KV cache при max-model-len 8192' })
    const r = search('kv cache', curriculum, p)
    expect(r.tasks.some((t) => t.id === 'C0')).toBe(true)
    expect(r.notes.some((n) => n.taskId === 'C1')).toBe(true)
    expect(search('pgvector', curriculum, p).resources.length).toBeGreaterThan(0)
    expect(search('recall', curriculum, p).skills.some((s) => s.id === 'retrieval-metrics')).toBe(true)
    expect(search('x', curriculum, p).total).toBe(0)
  })
})
