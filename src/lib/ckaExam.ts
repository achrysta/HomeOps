import { CKA_EXAM_VARIANTS } from '../data/ckaExams'
import { CKA_EXAM_POLICY } from '../config/learning'
import { CKA_DOMAIN_LABEL } from './labels'
import type { CkaDomain, CkaExamAttempt, IncidentDef, IncidentReport } from '../types'

export function examStands(variantId: string, defs: readonly IncidentDef[]): IncidentDef[] {
  const variant = CKA_EXAM_VARIANTS.find((v) => v.id === variantId)
  if (!variant) return []
  return variant.incidentIds.flatMap((id) => {
    const def = defs.find((d) => d.id === id && d.cluster && !d.nodeAccess)
    return def ? [def] : []
  })
}

const iso = (v: unknown): string | undefined =>
  typeof v === 'string' && Number.isFinite(Date.parse(v)) ? new Date(v).toISOString() : undefined
const obj = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v)

/** Только полная автопроверка; поля passed и сохранённый балл не являются доказательством. */
export function validExamReport(
  raw: unknown,
  def: IncidentDef,
  notBefore: string,
  notAfter?: string,
): IncidentReport | null {
  if (!obj(raw) || typeof raw.id !== 'string' || !raw.id || raw.source !== 'auto') return null
  const at = iso(raw.at)
  if (
    !at ||
    Date.parse(at) > Date.now() ||
    Date.parse(at) < Date.parse(notBefore) ||
    !Number.isFinite(Date.parse(notBefore)) ||
    (notAfter &&
      (!Number.isFinite(Date.parse(notAfter)) || Date.parse(at) > Date.parse(notAfter))) ||
    !Array.isArray(raw.checks)
  )
    return null
  const checks = def.checks.map((check) => {
    const matches = raw.checks as unknown[]
    const found = matches.filter((c) => obj(c) && c.id === check.id)
    return found.length === 1 && obj(found[0]) && typeof found[0].ok === 'boolean'
      ? {
          id: check.id,
          ok: found[0].ok,
          message: typeof found[0].message === 'string' ? found[0].message : '',
        }
      : null
  })
  if (raw.checks.length !== def.checks.length || checks.some((c) => !c) || !checks.length)
    return null
  const complete = checks.filter((c) => c !== null)
  return { id: raw.id, at, source: 'auto', passed: complete.every((c) => c.ok), checks: complete }
}

export function normalizeCkaExam(
  raw: unknown,
  defs: readonly IncidentDef[],
): CkaExamAttempt | null {
  if (!obj(raw) || typeof raw.id !== 'string' || !raw.id || typeof raw.variantId !== 'string')
    return null
  const stands = examStands(raw.variantId, defs)
  const variant = CKA_EXAM_VARIANTS.find((v) => v.id === raw.variantId)
  if (!variant || stands.length !== variant.incidentIds.length) return null
  const createdAt = iso(raw.createdAt),
    startedAt = iso(raw.startedAt),
    submittedAt = iso(raw.submittedAt),
    finishedAt = iso(raw.finishedAt)
  const phases: CkaExamAttempt['phase'][] = [
    'preparing',
    'running',
    'checking',
    'finished',
    'cancelled',
  ]
  if (!createdAt || !phases.includes(raw.phase as CkaExamAttempt['phase'])) return null
  const phase = raw.phase as CkaExamAttempt['phase']
  if (phase !== 'preparing' && phase !== 'cancelled' && !startedAt) return null
  if (startedAt && startedAt < createdAt) return null
  if (submittedAt && (!startedAt || submittedAt < startedAt)) return null
  if (finishedAt && finishedAt < (submittedAt ?? startedAt ?? createdAt)) return null
  if (phase === 'finished' && (!finishedAt || !submittedAt)) return null
  const reports: Record<string, IncidentReport> = {}
  for (const def of stands) {
    const report =
      startedAt && obj(raw.reports)
        ? validExamReport(raw.reports[def.id], def, startedAt, finishedAt)
        : null
    if (report) reports[def.id] = report
  }
  // Повреждённый итог можно перепроверить; недостающие проверки не становятся зелёными.
  const normalizedPhase =
    phase === 'finished' && stands.some((d) => !reports[d.id]) ? 'checking' : phase
  return {
    id: raw.id,
    variantId: raw.variantId,
    createdAt,
    phase: normalizedPhase,
    reports,
    ...(startedAt ? { startedAt } : {}),
    ...(submittedAt ? { submittedAt } : {}),
    ...(finishedAt && normalizedPhase === 'finished' ? { finishedAt } : {}),
    ...(raw.autoSubmissionTried === true ? { autoSubmissionTried: true } : {}),
    ...(typeof raw.error === 'string' && raw.error ? { error: raw.error } : {}),
  }
}

export function normalizeCkaExams(raw: unknown, defs: readonly IncidentDef[]): CkaExamAttempt[] {
  if (!Array.isArray(raw)) return []
  const attempts = new Map<string, CkaExamAttempt>()
  for (const item of raw) {
    const attempt = normalizeCkaExam(item, defs)
    if (attempt) attempts.set(attempt.id, attempt)
  }
  return [...attempts.values()]
}

export const examActive = (attempt: CkaExamAttempt): boolean =>
  ['preparing', 'running', 'checking'].includes(attempt.phase)
export const examDeadline = (attempt: CkaExamAttempt): number =>
  Date.parse(attempt.startedAt ?? '') + CKA_EXAM_POLICY.minutes * 60_000
export const examLate = (attempt: CkaExamAttempt): boolean =>
  !!attempt.submittedAt && Date.parse(attempt.submittedAt) > examDeadline(attempt)

export function examResult(attempt: CkaExamAttempt, defs: readonly IncidentDef[]) {
  const stands = examStands(attempt.variantId, defs).map((def) => {
    const report = attempt.startedAt
      ? validExamReport(attempt.reports[def.id], def, attempt.startedAt, attempt.finishedAt)
      : null
    const passed = report?.checks.filter((c) => c.ok).length ?? 0
    return {
      def,
      report,
      passed,
      total: def.checks.length,
      fraction: passed / (def.checks.length || 1),
    }
  })
  const domains = (Object.keys(CKA_DOMAIN_LABEL) as CkaDomain[]).map((id) => {
    const relevant = stands.filter((s) => s.def.cka?.includes(id))
    return {
      id,
      ...CKA_DOMAIN_LABEL[id],
      fraction: relevant.length
        ? relevant.reduce((n, s) => n + s.fraction, 0) / relevant.length
        : 0,
      count: relevant.length,
    }
  })
  return { stands, domains, score: domains.reduce((n, d) => n + d.fraction * d.weight, 0) / 100 }
}
