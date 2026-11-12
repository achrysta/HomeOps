import { describe, expect, it, vi } from 'vitest'
import { curriculum } from '../data'
import { CKA_EXAM_VARIANTS } from '../data/ckaExams'
import { CKA_EXAM_POLICY } from '../config/learning'
import { CKA_DOMAIN_LABEL } from './labels'
import { examActive, examDeadline, examLate, examResult, examStands, normalizeCkaExam, validExamReport } from './ckaExam'
import { bounded, prepareExam, stopExam, verifyExam, type ExamService } from './ckaExamActions'
import { buildExport, createEmptyProgress, normalizeProgress, parseImport } from './storage'
import { reducer } from '../state/reducer'
import { buildIndex, computeInterviewReadiness, computeSkillLevels, computeVacancyMatch, summarize } from './progress'
import type { CkaExamAttempt, IncidentDef, IncidentReport } from '../types'
import { beginExamOperation, endExamOperation, examOperationBusy, subscribeExamOperations } from './ckaExamRuntime'

const start = '2026-10-09T10:00:00.000Z'
const end = '2026-10-09T11:00:00.000Z'
const stands = examStands('cka-1', curriculum.incidents)
const report = (d: IncidentDef, ok = true, at = end): IncidentReport => ({ id: `${d.id}-${at}`, at, source: 'auto', passed: !ok, checks: d.checks.map((c) => ({ id: c.id, ok, message: 'Проверено' })) })
const attempt = (): CkaExamAttempt => ({ id: 'test-exam', variantId: 'cka-1', createdAt: start, startedAt: start, submittedAt: end, finishedAt: end, phase: 'finished', reports: Object.fromEntries(stands.map((d) => [d.id, report(d)])) })

describe('CKA exam', () => {
  it('uses nine distinct namespace-only variants covering all domains, with a three-stand final', () => {
    expect(CKA_EXAM_VARIANTS).toHaveLength(9)
    const all = new Set<string>()
    const compositions = new Set<string>()
    for (const variant of CKA_EXAM_VARIANTS) {
      const defs = examStands(variant.id, curriculum.incidents)
      expect(defs).toHaveLength(variant.id === 'cka-9' ? 3 : 5)
      expect(defs).toHaveLength(variant.incidentIds.length)
      expect(new Set(variant.incidentIds).size).toBe(defs.length)
      expect(defs.every((d) => d.cluster && !d.nodeAccess)).toBe(true)
      const minutes = defs.reduce((n, d) => n + d.minutes, 0)
      expect(minutes).toBeGreaterThanOrEqual(CKA_EXAM_POLICY.minVariantMinutes)
      expect(minutes).toBeLessThanOrEqual(CKA_EXAM_POLICY.maxVariantMinutes)
      for (const id of Object.keys(CKA_DOMAIN_LABEL)) expect(defs.some((d) => d.cka?.some((domain) => domain === id)), `${variant.id}: ${id}`).toBe(true)
      defs.forEach((d) => all.add(d.id)); compositions.add([...variant.incidentIds].sort().join(','))
    }
    expect(all.size).toBe(16); expect(compositions.size).toBe(9)
    for (const variant of CKA_EXAM_VARIANTS.slice(6, 8)) {
      expect(variant.incidentIds).toHaveLength(5)
      expect(variant.incidentIds.some((id) => ['k8s-statefulset', 'k8s-gateway', 'k8s-operator'].includes(id))).toBe(true)
      expect(variant.incidentIds).not.toContain('k8s-gpu-scheduling')
    }
    expect(CKA_EXAM_VARIANTS.find((v) => v.id === 'cka-9')?.incidentIds).toEqual(['k8s-storm', 'k8s-operator', 'k8s-storage'])
    expect(examStands('unknown', curriculum.incidents)).toEqual([])
  })
  it('keeps the first eight compositions and historical reports compatible', () => {
    expect(CKA_EXAM_VARIANTS.slice(0, 8).map((v) => [v.id, [...v.incidentIds]])).toEqual([
      ['cka-1', ['k8s-crashloop', 'k8s-nodeport', 'k8s-kustomize', 'k8s-pending', 'k8s-probes']],
      ['cka-2', ['k8s-service-endpoints', 'k8s-secret', 'k8s-kustomize', 'k8s-storage', 'k8s-rollout']],
      ['cka-3', ['k8s-hpa-pdb', 'k8s-nodeport', 'k8s-secret', 'k8s-pending', 'k8s-crashloop']],
      ['cka-4', ['k8s-rbac', 'k8s-nodeport', 'k8s-rollout', 'k8s-pending', 'k8s-crashloop']],
      ['cka-5', ['k8s-netpol', 'k8s-kustomize', 'k8s-pending', 'k8s-secret', 'k8s-crashloop']],
      ['cka-6', ['k8s-rbac', 'k8s-service-endpoints', 'k8s-pending', 'k8s-rollout', 'k8s-crashloop']],
      ['cka-7', ['k8s-operator', 'k8s-statefulset', 'k8s-nodeport', 'k8s-pending', 'k8s-crashloop']],
      ['cka-8', ['k8s-gateway', 'k8s-operator', 'k8s-probes', 'k8s-storage', 'k8s-rollout']],
    ])
    const legacy = attempt()
    for (const r of Object.values(legacy.reports)) r.passed = r.checks.every((c) => c.ok)
    expect(normalizeCkaExam(legacy, curriculum.incidents)).toEqual(legacy)
  })
  it('recomputes the result per check and weights domain means, ignoring forged passed and score', () => {
    const a = attempt()
    a.reports[stands[0].id].checks[0].ok = false
    const result = examResult(a, curriculum.incidents)
    expect(result.stands[0].fraction).toBe((stands[0].checks.length - 1) / stands[0].checks.length)
    expect(result.score).toBeCloseTo(result.domains.reduce((n, d) => n + d.fraction * CKA_DOMAIN_LABEL[d.id].weight / 100, 0), 12)
    expect(result.score).toBeLessThan(1)
    expect(examResult(attempt(), curriculum.incidents).score).toBe(1)
  })
  it('rejects old, future, uploaded, live, duplicate and incomplete reports, even with passed=true', () => {
    const d = stands[0], r = report(d)
    expect(validExamReport({ ...r, at: start }, d, start, end)).not.toBeNull()
    for (const raw of [
      { ...r, at: '2026-10-08T10:00:00Z' }, { ...r, at: '2026-10-10T10:00:00Z' },
      { ...r, source: 'upload' }, { ...r, source: 'live' }, { ...r, id: '' },
      { ...r, checks: r.checks.slice(1), passed: true }, { ...r, checks: [r.checks[0], r.checks[0]], passed: true },
    ]) expect(validExamReport(raw, d, start, end)).toBeNull()
    const a = attempt(); a.reports[d.id].source = 'upload'
    expect(examResult(a, curriculum.incidents).stands[0].fraction).toBe(0)
    expect(normalizeCkaExam(a, curriculum.incidents)?.phase).toBe('checking')
  })
  it('normalizes imports/exports without backfilling old fields or changing valid dates', () => {
    const p = createEmptyProgress(curriculum)
    expect(normalizeProgress(p, curriculum)).not.toHaveProperty('ckaExams')
    const normalized = normalizeCkaExam(attempt(), curriculum.incidents)!
    const next = { ...p, ckaExams: [normalized] }
    const imported = parseImport(JSON.stringify(buildExport(next, curriculum)), curriculum)
    expect(imported.ok).toBe(true)
    if (imported.ok) expect(imported.progress.ckaExams).toEqual(next.ckaExams)
    expect(normalizeCkaExam({ ...attempt(), variantId: 'fake' }, curriculum.incidents)).toBeNull()
    expect(normalizeCkaExam({ ...attempt(), submittedAt: '2026-10-08' }, curriculum.incidents)).toBeNull()
    expect(normalizeCkaExam({ ...attempt(), startedAt: 'bad' }, curriculum.incidents)).toBeNull()
  })
  it('does not grant learning progress, skill levels, role match, solved incidents or interview readiness', () => {
    const p = createEmptyProgress(curriculum)
    const next = reducer(p, { type: 'cka-exam/upsert', attempt: attempt() })
    const idx = buildIndex(curriculum), vacancy = curriculum.vacancies[0]
    const oldLevels = computeSkillLevels(curriculum, p), levels = computeSkillLevels(curriculum, next)
    expect(next.ckaExams).toHaveLength(1)
    expect(next.tasks).toBe(p.tasks); expect(next.skills).toBe(p.skills); expect(next.incidents).toBe(p.incidents); expect(next.interview).toBe(p.interview)
    expect(summarize(curriculum.tasks, next)).toEqual(summarize(curriculum.tasks, p))
    expect(levels).toEqual(oldLevels)
    expect(computeVacancyMatch(vacancy, levels, idx)).toEqual(computeVacancyMatch(vacancy, oldLevels, idx))
    expect(computeInterviewReadiness(curriculum, next)).toEqual(computeInterviewReadiness(curriculum, p))
    expect(reducer(next, { type: 'cka-exam/upsert', attempt: { ...attempt(), error: 'Повторить' } }).ckaExams).toHaveLength(1)
  })
  it('preserves timer through reload and marks late submission using submission time rather than finish time', () => {
    const a = attempt()
    expect(examDeadline(a)).toBe(Date.parse(start) + 2 * 60 * 60_000)
    expect(examLate(a)).toBe(false)
    expect(examLate({ ...a, submittedAt: '2026-10-09T12:00:00.001Z' })).toBe(true)
    expect(examLate({ ...a, finishedAt: '2026-10-09T14:00:00Z' })).toBe(false)
    expect(examActive({ ...a, phase: 'checking' })).toBe(true)
    expect(examActive(a)).toBe(false)
  })
})

describe('exam service flow (no real labs)', () => {
  const service = (): ExamService => ({ action: vi.fn(async () => 0), reports: vi.fn(async () => Object.fromEntries(stands.map((d) => [d.id, [report(d)]]))), now: () => end })
  it('resets and starts each stand sequentially before starting the timer', async () => {
    const fake = service()
    await prepareExam(stands, () => {}, fake)
    expect(vi.mocked(fake.action).mock.calls.map(([id, action]) => `${id}:${action}`)).toEqual(stands.flatMap((d) => [`${d.id}:reset`, `${d.id}:up`]))
    vi.mocked(fake.action).mockResolvedValue(-1)
    await expect(prepareExam(stands, () => {}, fake)).rejects.toThrow('сброс')
  })
  it('accepts failed checks but requires a fresh full report from each verify, rejecting an earlier report in the same exam', async () => {
    const fake = service()
    vi.mocked(fake.action).mockResolvedValue(1)
    vi.mocked(fake.reports).mockResolvedValue(Object.fromEntries(stands.map((d) => [d.id, [report(d, false)]])))
    const result = await verifyExam(stands, start, () => {}, fake)
    expect(Object.keys(result)).toHaveLength(5); expect(result[stands[0].id].passed).toBe(false)
    vi.mocked(fake.reports).mockResolvedValue(Object.fromEntries(stands.map((d) => [d.id, [report(d, true, start)]])))
    await expect(verifyExam(stands, start, () => {}, fake)).rejects.toThrow('нет свежего')
    vi.mocked(fake.reports).mockResolvedValue(null)
    await expect(verifyExam(stands, start, () => {}, fake)).rejects.toThrow('нет свежего')
    vi.mocked(fake.action).mockResolvedValue(-1)
    await expect(verifyExam(stands, start, () => {}, fake)).rejects.toThrow('не завершилась')
  })
  it('attempts to stop every stand even when one down fails', async () => {
    const fake = service(); vi.mocked(fake.action).mockResolvedValueOnce(-1)
    await expect(stopExam(stands, () => {}, fake)).rejects.toThrow(stands[0].title)
    expect(fake.action).toHaveBeenCalledTimes(5)
  })
  it('turns a stuck request into a recoverable error', async () => {
    await expect(bounded(new Promise(() => {}), 5)).rejects.toThrow('Ответ задержался')
  })
  it('prevents a second submission during an action, including after route changes', () => {
    const changed = vi.fn(), unsubscribe = subscribeExamOperations(changed)
    expect(beginExamOperation('timer-test')).toBe(true)
    expect(beginExamOperation('timer-test')).toBe(false)
    expect(examOperationBusy('timer-test')).toBe(true)
    endExamOperation('timer-test')
    expect(examOperationBusy('timer-test')).toBe(false)
    expect(changed).toHaveBeenCalledTimes(2)
    unsubscribe()
  })
})


describe('final exam with a fake service', () => {
  it('prepares three stands, scores current reports and stops all even after a failure', async () => {
    const final = examStands('cka-9', curriculum.incidents)
    const calls: string[] = []
    const fake: ExamService = {
      action: async (id, action) => { calls.push(id + ':' + action); return 0 },
      reports: async () => Object.fromEntries(final.map((d) => [d.id, [report(d)]])), now: () => end,
    }
    await prepareExam(final, () => {}, fake)
    expect(calls).toEqual(final.flatMap((d) => [d.id + ':reset', d.id + ':up']))
    const reports = await verifyExam(final, start, () => {}, fake)
    const a: CkaExamAttempt = { ...attempt(), variantId: 'cka-9', reports }
    expect(examResult(a, curriculum.incidents).score).toBe(1)
    expect(normalizeCkaExam(a, curriculum.incidents)?.variantId).toBe('cka-9')
    fake.action = async (id, action) => { calls.push(id + ':' + action); return id === final[0].id ? -1 : 0 }
    await expect(stopExam(final, () => {}, fake)).rejects.toThrow(final[0].title)
    expect(calls.slice(-3)).toEqual(final.map((d) => d.id + ':down'))
  })
})


describe('review: report timestamp boundaries',()=>{
  it('compares timezone offsets numerically and rejects future reports',()=>{
    const def=curriculum.incidents[0]
    const report={id:'dated',source:'auto',at:'2026-10-08T12:00:00Z',checks:def.checks.map((c)=>({id:c.id,ok:true,message:''}))}
    expect(validExamReport(report,def,'2026-10-08T14:00:00+03:00')).not.toBeNull()
    expect(validExamReport(report,def,'2026-10-08T11:00:00Z','2026-10-08T14:00:00+03:00')).toBeNull()
    expect(validExamReport({...report,at:new Date(Date.now()+60_000).toISOString()},def,'2026-10-08T11:00:00Z')).toBeNull()
  })
})
