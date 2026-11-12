// Входящие отчёты автопроверки инцидентов (incidents/*/checks.py → verify.py → POST сюда).
// Хранятся отдельно от progress.json: у файла прогресса один писатель — браузер (ревизии, конфликты).
// Дашборд забирает отсюда новые отчёты и сам переносит их в прогресс.

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'

export const REPORTS_FILE = 'incident-reports.json'
export const REPORTS_FORMAT = 'homeops-incident-reports'
export const REPORT_FORMAT = 'homeops-incident-report'
export const MAX_STORED_REPORTS = 300
const MAX_CHECKS = 50

export interface StoredCheck {
  id: string
  title: string
  ok: boolean
  message: string
}

export interface StoredReport {
  id: string
  incidentId: string
  at: string
  receivedAt: string
  passed: boolean
  checks: StoredCheck[]
  arch?: string
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)
const clip = (v: unknown, max: number): string => (typeof v === 'string' ? v.slice(0, max) : '')

/** Проверка и очистка отчёта из verify.py. Возвращает текст ошибки, если отчёт не годится. */
export function sanitizeReport(raw: unknown, now = new Date()): StoredReport | string {
  if (!isObj(raw)) return 'Ожидается JSON-объект отчёта'
  if (raw.format !== REPORT_FORMAT) return `Поле format должно быть "${REPORT_FORMAT}"`
  const id = clip(raw.id, 64)
  if (!/^[A-Za-z0-9-]{8,64}$/.test(id)) return 'Некорректный id отчёта'
  const incidentId = clip(raw.incidentId, 64)
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(incidentId)) return 'Некорректный incidentId'
  const at = clip(raw.at, 40)
  if (!at || !Number.isFinite(Date.parse(at)) || Date.parse(at) > now.getTime())
    return 'Некорректное время отчёта (at)'
  if (!Array.isArray(raw.checks) || raw.checks.length === 0) return 'В отчёте нет проверок'
  if (raw.checks.length > MAX_CHECKS) return 'Слишком много проверок'
  const checks: StoredCheck[] = []
  for (const c of raw.checks.slice(0, MAX_CHECKS)) {
    if (!isObj(c) || typeof c.ok !== 'boolean') return 'Некорректная запись проверки'
    const checkId = clip(c.id, 64)
    if (!checkId) return 'У проверки нет id'
    if (checks.some((c) => c.id === checkId)) return 'Повторяется id проверки'
    checks.push({ id: checkId, title: clip(c.title, 200), ok: c.ok, message: clip(c.message, 600) })
  }
  const env = isObj(raw.env) ? raw.env : {}
  const arch = clip(env.arch, 32)
  return {
    id,
    incidentId,
    at: new Date(at).toISOString(),
    receivedAt: now.toISOString(),
    passed: checks.every((c) => c.ok),
    checks,
    ...(arch ? { arch } : {}),
  }
}

export async function readReports(dataDir: string): Promise<StoredReport[]> {
  try {
    const data: unknown = JSON.parse(await readFile(path.join(dataDir, REPORTS_FILE), 'utf8'))
    if (isObj(data) && Array.isArray(data.reports))
      return data.reports.filter((r): r is StoredReport => isObj(r) && typeof r.id === 'string')
  } catch {
    // файла ещё нет или он повреждён — отчёты не критичны, начинаем заново
  }
  return []
}

/** Добавить отчёт (повторная отправка того же id ничего не меняет). Хранятся последние MAX_STORED_REPORTS. */
export async function appendReport(dataDir: string, report: StoredReport): Promise<void> {
  const reports = await readReports(dataDir)
  if (reports.some((r) => r.id === report.id)) return
  const next = [...reports, report].slice(-MAX_STORED_REPORTS)
  await mkdir(dataDir, { recursive: true })
  const file = path.join(dataDir, REPORTS_FILE)
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`
  await writeFile(
    tmp,
    `${JSON.stringify({ format: REPORTS_FORMAT, reports: next }, null, 2)}\n`,
    'utf8',
  )
  await rename(tmp, file)
}
