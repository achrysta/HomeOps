// Инциденты: проверка отчётов автопроверки, статус и сводка. Без React.

import type {
  CkaDomain,
  IncidentDef,
  IncidentProgress,
  IncidentReport,
  UserProgress,
} from '../types'

export const INCIDENT_REPORT_FORMAT = 'homeops-incident-report'
/** Сколько последних отчётов хранить на инцидент (первый успешный сохраняется всегда) */
export const MAX_INCIDENT_REPORTS = 20

export type IncidentStatus = 'not_started' | 'in_progress' | 'solved'

export const emptyIncident = (): IncidentProgress => ({ hintsShown: 0, reports: [] })

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/**
 * Привести отчёт verify.py (из inbox сервера или загруженного файла) к IncidentReport.
 * «Решено» определяется по проверкам из описания инцидента в программе, а не по полю passed отчёта:
 * отчёт засчитывается, только если в нём есть все проверки инцидента и все они пройдены.
 */
export function parseIncidentReport(
  raw: unknown,
  defs: readonly IncidentDef[],
  source: IncidentReport['source'],
): { incidentId: string; report: IncidentReport } | { error: string } {
  if (!isObj(raw)) return { error: 'Файл не похож на отчёт автопроверки' }
  if ('format' in raw && raw.format !== INCIDENT_REPORT_FORMAT)
    return { error: 'Это не отчёт автопроверки инцидента (.reports/last.json)' }
  const def = defs.find((d) => d.id === raw.incidentId)
  if (!def) return { error: `Неизвестный инцидент: ${String(raw.incidentId)}` }
  const at = typeof raw.at === 'string' ? raw.at : ''
  if (typeof raw.id !== 'string' || !raw.id || Number.isNaN(Date.parse(at)))
    return { error: 'В отчёте нет id или времени проверки' }
  const results = Array.isArray(raw.checks) ? raw.checks.filter(isObj) : []
  const ids = results.map((r) => r.id)
  if (new Set(ids).size !== ids.length) return { error: 'В отчёте повторяются id проверок' }
  const checks = def.checks.flatMap((c) => {
    const r = results.find((x) => x.id === c.id)
    return r && typeof r.ok === 'boolean'
      ? [
          {
            id: c.id,
            ok: r.ok,
            message: typeof r.message === 'string' ? r.message.slice(0, 600) : '',
          },
        ]
      : []
  })
  if (!checks.length)
    return { error: 'В отчёте нет проверок этого инцидента — возможно, он от старой версии стенда' }
  const passed = checks.length === def.checks.length && checks.every((c) => c.ok)
  const env = isObj(raw.env) ? raw.env : {}
  const arch =
    typeof raw.arch === 'string' ? raw.arch : typeof env.arch === 'string' ? env.arch : undefined
  return {
    incidentId: def.id,
    report: {
      id: raw.id,
      at: new Date(at).toISOString(),
      passed,
      checks,
      ...(arch ? { arch } : {}),
      source,
    },
  }
}

/**
 * Добавить отчёты к прогрессу инцидента: без дублей по id, по времени, с ограничением истории.
 * Отчёты старше начала прогресса (например, до сброса) не принимаются.
 */
export function checkedIncidentReports(def: IncidentDef, p: UserProgress, now = Date.now()) {
  const created = Date.parse(p.meta.createdAt)
  if (!Number.isFinite(created) || !def.checks.length) return []
  return (p.incidents[def.id]?.reports ?? [])
    .flatMap((r) => {
      const at = Date.parse(r.at)
      if (!Number.isFinite(at) || at < created || at > now) return []
      const parsed = parseIncidentReport({ ...r, incidentId: def.id }, [def], r.source)
      return 'report' in parsed ? [parsed.report] : []
    })
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
}

/** Первый успешный отчёт с текущими проверками определяет границу самостоятельности. */
export function confirmedIncident(def: IncidentDef, p: UserProgress, now = Date.now()) {
  const reports = checkedIncidentReports(def, p, now).filter((r) => r.passed)
  const report = reports[0]
  if (!report) return null
  const opened = p.incidents[def.id]?.debriefOpenedAt
  return {
    report,
    independent:
      !opened ||
      (Number.isFinite(Date.parse(opened)) && Date.parse(opened) >= Date.parse(report.at)),
  }
}

export function mergeIncidentReports(
  ip: IncidentProgress,
  reports: readonly IncidentReport[],
  notBefore?: string,
): IncidentProgress {
  const known = new Set(ip.reports.map((r) => r.id))
  const fresh = reports.filter((r) => {
    const at = Date.parse(r.at)
    if (
      known.has(r.id) ||
      !Number.isFinite(at) ||
      at > Date.now() ||
      (notBefore && (!Number.isFinite(Date.parse(notBefore)) || at < Date.parse(notBefore)))
    )
      return false
    known.add(r.id)
    return true
  })
  if (!fresh.length) return ip
  const all = [...ip.reports, ...fresh].sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
  const firstPass = all.find((r) => r.passed)
  let kept = all.slice(-MAX_INCIDENT_REPORTS)
  if (firstPass && !kept.includes(firstPass))
    kept = [firstPass, ...all.slice(-(MAX_INCIDENT_REPORTS - 1))]
  const solvedAt = ip.solvedAt ?? firstPass?.at
  const startedAt = ip.startedAt ?? all[0].at
  // Inbox хранит больше отчётов, чем история в прогрессе. Повторно пришедшие старые
  // отчёты могут снова выпасть при обрезке: если итог прежний, новой правки нет.
  if (
    startedAt === ip.startedAt &&
    solvedAt === ip.solvedAt &&
    kept.length === ip.reports.length &&
    kept.every((r, i) => r === ip.reports[i])
  )
    return ip
  return {
    ...ip,
    reports: kept,
    startedAt,
    ...(solvedAt ? { solvedAt } : {}),
  }
}

/** Статус по актуальному набору проверок, а не по сохранённому флагу решения. */
export function incidentStatusFor(
  def: IncidentDef,
  p: UserProgress,
  now = Date.now(),
): IncidentStatus {
  if (confirmedIncident(def, p, now)) return 'solved'
  const ip = p.incidents[def.id]
  return ip && (ip.startedAt || ip.reports.length || ip.hintsShown) ? 'in_progress' : 'not_started'
}

export const latestReport = (ip: IncidentProgress | undefined): IncidentReport | undefined =>
  ip?.reports.at(-1)

/** Инциденты по темам в порядке первого появления (у MLOps темы нет — одна группа ''). */
export function groupByTopic(defs: readonly IncidentDef[]): [string, IncidentDef[]][] {
  const groups = new Map<string, IncidentDef[]>()
  for (const d of defs) {
    const key = d.topic ?? ''
    groups.set(key, [...(groups.get(key) ?? []), d])
  }
  return [...groups]
}

/** Домены CKA по убыванию веса в экзамене */
export const CKA_DOMAIN_ORDER: CkaDomain[] = [
  'troubleshooting',
  'cluster',
  'networking',
  'workloads',
  'storage',
]

export interface CkaCoverage {
  domain: CkaDomain
  total: number
  solved: number
}

/** Сколько инцидентов тренирует каждый домен CKA и сколько из них решено — видно, где пробелы. */
export function ckaCoverage(defs: readonly IncidentDef[], progress: UserProgress): CkaCoverage[] {
  return CKA_DOMAIN_ORDER.map((domain) => {
    const related = defs.filter((d) => d.cka?.includes(domain))
    return {
      domain,
      total: related.length,
      solved: related.filter((d) => incidentStatusFor(d, progress) === 'solved').length,
    }
  })
}

export interface IncidentSummary {
  total: number
  solved: number
  solvedWithDebrief: number
  inProgress: number
}

export function summarizeIncidents(
  defs: readonly IncidentDef[],
  progress: UserProgress,
): IncidentSummary {
  let solved = 0
  let withDebrief = 0
  let inProgress = 0
  for (const d of defs) {
    const s = incidentStatusFor(d, progress)
    if (s === 'solved') {
      solved++
      if (!confirmedIncident(d, progress)?.independent) withDebrief++
    } else if (s === 'in_progress') inProgress++
  }
  return { total: defs.length, solved, solvedWithDebrief: withDebrief, inProgress }
}
