import { CKA_EXAM_POLICY } from '../config/learning'
import { validExamReport } from './ckaExam'
import { fetchIncidentReports, runLabAction, type LabAction } from './labs'
import type { IncidentDef, IncidentReport } from '../types'

export async function bounded<T>(promise: Promise<T>, timeout: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Ответ задержался. Проверьте сервис стендов; действие на сервере могло продолжиться. Дождитесь его окончания и повторите.')), timeout)
    })])
  } finally { clearTimeout(timer) }
}

export interface ExamService {
  action: typeof runLabAction
  reports: typeof fetchIncidentReports
  now: () => string
}
const defaultService: ExamService = { action: runLabAction, reports: fetchIncidentReports, now: () => new Date().toISOString() }

async function action(def: IncidentDef, kind: LabAction, log: (text: string) => void, service: ExamService) {
  log(`\n${def.id} · ${kind}\n`)
  let listening = true
  try { return await bounded(service.action(def.id, kind, undefined, (text) => { if (listening) log(text) }), CKA_EXAM_POLICY.actionTimeoutMs) }
  finally { listening = false }
}

export async function prepareExam(stands: readonly IncidentDef[], log: (text: string) => void, service = defaultService): Promise<void> {
  for (const def of stands) {
    for (const kind of ['reset', 'up'] as const) {
      if (await action(def, kind, log, service) !== 0) throw new Error(`${def.title}: ${kind === 'reset' ? 'сброс' : 'запуск'} не завершён. Проверьте вывод и повторите подготовку.`)
    }
  }
}

export async function verifyExam(stands: readonly IncidentDef[], startedAt: string, log: (text: string) => void, service = defaultService): Promise<Record<string, IncidentReport>> {
  const reports: Record<string, IncidentReport> = {}
  for (const def of stands) {
    const requestedAt = service.now()
    const code = await action(def, 'verify', log, service)
    if (code !== 0 && code !== 1) throw new Error(`${def.title}: проверка не завершилась. Повторите сдачу после восстановления сервиса.`)
    const inbox = await bounded(service.reports(stands), CKA_EXAM_POLICY.reportTimeoutMs)
    const candidates = (inbox?.[def.id] ?? []).map((raw) => validExamReport(raw, def, requestedAt > startedAt ? requestedAt : startedAt, service.now())).filter((r) => r !== null)
    const report = candidates.sort((a, b) => b.at.localeCompare(a.at))[0]
    if (!report) throw new Error(`${def.title}: нет свежего полного отчёта автопроверки. Старые и живые проверки не учитываются. Повторите сдачу.`)
    reports[def.id] = report
  }
  return reports
}

export async function stopExam(stands: readonly IncidentDef[], log: (text: string) => void, service = defaultService): Promise<void> {
  const failed: string[] = []
  for (const def of stands) {
    try { if (await action(def, 'down', log, service) !== 0) failed.push(def.title) }
    catch { failed.push(def.title) }
  }
  if (failed.length) throw new Error(`Не удалось остановить: ${failed.join(', ')}. Повторите остановку.`)
}
