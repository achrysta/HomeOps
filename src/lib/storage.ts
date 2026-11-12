import type {
  Curriculum,
  DesignAnswer,
  Evidence,
  EvidenceType,
  IncidentCheckResult,
  IncidentProgress,
  IncidentReport,
  InterviewAnswer,
  InterviewRating,
  JournalEntry,
  Level,
  PracticeStat,
  QuizAttempt,
  SavedItem,
  SkillProgress,
  TaskProgress,
  TaskStatus,
  UserProgress,
  GymProgress,
  GymSession,
} from '../types'
import {
  MAX_GYM_SESSIONS,
  MAX_SAVED,
  QUIZ_PASS_THRESHOLD,
} from '../config/weights'
import { DEFAULT_VACANCY_ID } from '../config/learning'
import { normalizeMeasurements } from './measurements'
import { normalizeCkaExams } from './ckaExam'
import { normalizeTiming } from './timing'
import { validAttemptScore } from './quiz'
import { mergeIncidentReports, parseIncidentReport } from './incidents'

export const STORAGE_KEY = 'homeops.progress.v1'
export const THEME_KEY = 'homeops.theme'
// формат файла экспорта: по нему узнаются резервные копии, менять нельзя
export const EXPORT_FORMAT = 'homeops-progress'

/** Локальная дата YYYY-MM-DD (toISOString дал бы UTC и «вчера» после полуночи). */
export function todayLocal(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function uid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

export function createEmptyProgress(c: Curriculum): UserProgress {
  const now = new Date().toISOString()
  return {
    schemaVersion: 1,
    activeVacancyId: (c.vacancies.find((v) => v.id === DEFAULT_VACANCY_ID) ?? c.vacancies[0])?.id ?? '',
    tasks: {},
    resources: {},
    skills: {},
    interview: {
      answers: {},
      designs: {},
    },
    journal: [],
    finalExam: [],
    practice: {},
    incidents: {},
    saved: [],
    gyms: {},
    meta: { createdAt: now, updatedAt: now, curriculumVersion: c.version },
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Normalization — защищает от битого localStorage и ручного редактирования JSON.
// Неизвестные id задач/ресурсов сохраняются: если они вернутся в curriculum,
// прогресс по ним восстановится.
// ─────────────────────────────────────────────────────────────────────────────

const TASK_STATUSES: TaskStatus[] = ['not_started', 'in_progress', 'completed', 'blocked']
const EVIDENCE_TYPES: EvidenceType[] = ['commit', 'repo', 'screenshot', 'url', 'note']

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback)
const isLevel = (v: unknown): v is Level => v === 0 || v === 1 || v === 2 || v === 3 || v === 4
const isRating = (v: unknown): v is InterviewRating => v === 0 || v === 1 || v === 2 || v === 3

function normEvidence(raw: unknown): Evidence | null {
  if (!isObj(raw)) return null
  const value = str(raw.value).trim()
  if (!value) return null
  const type = EVIDENCE_TYPES.includes(raw.type as EvidenceType)
    ? (raw.type as EvidenceType)
    : 'note'
  const description = str(raw.description).trim()
  return {
    id: str(raw.id) || uid(),
    type,
    value,
    ...(description ? { description } : {}),
    createdAt: isDate(raw.createdAt) ? new Date(raw.createdAt as string).toISOString() : '',
  }
}

function normAttempt(raw: unknown): QuizAttempt | null {
  if (
    !isObj(raw) ||
    typeof raw.correct !== 'number' ||
    typeof raw.total !== 'number' ||
    !validAttemptScore({ correct: raw.correct, total: raw.total as number })
  )
    return null
  return {
    id: str(raw.id) || uid(),
    at: isDate(raw.at) ? new Date(raw.at as string).toISOString() : '',
    correct: raw.correct,
    total: raw.total as number,
    // флаг из файла не доверяем: сдано — по счёту (не ниже проходного балла)
    passed: raw.correct / (raw.total as number) >= QUIZ_PASS_THRESHOLD,
    wrongIds: Array.isArray(raw.wrongIds)
      ? raw.wrongIds.filter((x): x is string => typeof x === 'string')
      : [],
  }
}

const normAttempts = (raw: unknown): QuizAttempt[] =>
  Array.isArray(raw) ? raw.map(normAttempt).filter((a): a is QuizAttempt => a !== null) : []

function normPractice(raw: unknown): PracticeStat | null {
  if (!isObj(raw) || typeof raw.seen !== 'number' || raw.seen <= 0) return null
  const num = (v: unknown) => (typeof v === 'number' && v >= 0 ? Math.floor(v) : 0)
  return {
    seen: Math.floor(raw.seen),
    correct: Math.min(num(raw.correct), Math.floor(raw.seen)),
    streak: num(raw.streak),
    lastCorrect: raw.lastCorrect === true,
    lastAt: isDate(raw.lastAt) ? new Date(raw.lastAt as string).toISOString() : '',
  }
}

function normTask(raw: unknown): TaskProgress | null {
  if (!isObj(raw)) return null
  const status = TASK_STATUSES.includes(raw.status as TaskStatus)
    ? (raw.status as TaskStatus)
    : 'not_started'
  const tp: TaskProgress = {
    status,
    evidence: Array.isArray(raw.evidence)
      ? raw.evidence.map(normEvidence).filter((e): e is Evidence => e !== null)
      : [],
    notes: str(raw.notes),
    criteriaDone: Array.isArray(raw.criteriaDone)
      ? raw.criteriaDone.filter((x): x is string => typeof x === 'string')
      : [],
  }
  if (typeof raw.updatedAt === 'string') tp.updatedAt = raw.updatedAt
  if (typeof raw.completedAt === 'string') tp.completedAt = raw.completedAt
  const timing = normalizeTiming(raw.timing)
  if (timing) tp.timing = timing
  const attempts = normAttempts(raw.quizAttempts)
  if (attempts.length) tp.quizAttempts = attempts
  return tp
}

function normRecord<T>(raw: unknown, fn: (v: unknown) => T | null): Record<string, T> {
  const out: Record<string, T> = {}
  if (!isObj(raw)) return out
  for (const [k, v] of Object.entries(raw)) {
    const n = fn(v)
    if (n !== null) out[k] = n
  }
  return out
}

function normSkill(raw: unknown): SkillProgress | null {
  if (!isObj(raw)) return null
  const sp: SkillProgress = {}
  if (isLevel(raw.selfLevel)) sp.selfLevel = raw.selfLevel
  if (typeof raw.note === 'string' && raw.note.trim()) sp.note = raw.note
  return Object.keys(sp).length ? sp : null
}

function normAnswer(raw: unknown): InterviewAnswer | null {
  if (!isObj(raw) || !isRating(raw.rating)) return null
  return {
    rating: raw.rating,
    ...(isRating(raw.blindRating) ? { blindRating: raw.blindRating } : {}),
    ...(str(raw.checkedAt) ? { checkedAt: str(raw.checkedAt) } : {}),
    ...(str(raw.ratedAt) ? { ratedAt: str(raw.ratedAt) } : {}),
    ...(typeof raw.note === 'string' && raw.note ? { note: raw.note } : {}),
    updatedAt: str(raw.updatedAt) || new Date().toISOString(),
  }
}

function normSaved(raw: unknown): SavedItem[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  return raw
    .flatMap((x): SavedItem[] => {
      if (
        !isObj(x) ||
        (x.kind !== 'task' && x.kind !== 'incident' && x.kind !== 'resource') ||
        !str(x.id)
      )
        return []
      const key = `${x.kind}:${str(x.id)}`
      if (seen.has(key)) return []
      seen.add(key)
      return [{ kind: x.kind, id: str(x.id), at: str(x.at) || new Date().toISOString() }]
    })
    .slice(-MAX_SAVED)
}

const isDate = (v: unknown): v is string => typeof v === 'string' && !Number.isNaN(Date.parse(v))

function normGym(raw: unknown): GymProgress | null {
  if (!isObj(raw)) return null
  const sessions = (Array.isArray(raw.sessions) ? raw.sessions : []).flatMap((x): GymSession[] => {
    if (!isObj(x) || !str(x.id) || !isDate(x.startedAt)) return []
    const reps = isObj(x.reps)
      ? Object.fromEntries(
          Object.entries(x.reps).filter((e): e is [string, string] => isDate(e[1])),
        )
      : {}
    return [
      {
        id: str(x.id),
        startedAt: x.startedAt,
        ...(isDate(x.finishedAt) ? { finishedAt: x.finishedAt } : {}),
        reps,
      },
    ]
  })
  return {
    sessions: sessions.slice(-MAX_GYM_SESSIONS),
    ...(raw.paused === true ? { paused: true } : {}),
  }
}

function normDesign(raw: unknown): DesignAnswer | null {
  if (!isObj(raw)) return null
  const ids = (v: unknown) =>
    Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === 'string'))] : []
  const text = typeof raw.text === 'string' ? raw.text : ''
  const covered = ids(raw.covered)
  if (!text && !covered.length) return null
  return {
    text,
    covered,
    ...(Array.isArray(raw.coveredAfter) ? { coveredAfter: ids(raw.coveredAfter) } : {}),
    ...(str(raw.checkedAt) ? { checkedAt: str(raw.checkedAt) } : {}),
    updatedAt: str(raw.updatedAt) || new Date().toISOString(),
  }
}

function normJournal(raw: unknown): JournalEntry | null {
  if (!isObj(raw)) return null
  const entry: JournalEntry = {
    id: str(raw.id) || uid(),
    date: str(raw.date),
    did: str(raw.did),
    learned: str(raw.learned),
    unclear: str(raw.unclear),
    evidenceUrl: str(raw.evidenceUrl),
  }
  if (typeof raw.taskId === 'string' && raw.taskId) entry.taskId = raw.taskId
  if (!entry.did && !entry.learned && !entry.unclear && !entry.evidenceUrl) return null
  return entry
}

function normCheckResult(raw: unknown): IncidentCheckResult | null {
  if (!isObj(raw) || typeof raw.id !== 'string' || !raw.id || typeof raw.ok !== 'boolean')
    return null
  return { id: raw.id, ok: raw.ok, message: str(raw.message) }
}

function normReport(raw: unknown): IncidentReport | null {
  if (!isObj(raw) || typeof raw.id !== 'string' || !raw.id || Number.isNaN(Date.parse(str(raw.at))))
    return null
  const checks = Array.isArray(raw.checks)
    ? raw.checks.map(normCheckResult).filter((x): x is IncidentCheckResult => x !== null)
    : []
  if (!checks.length) return null
  return {
    id: raw.id,
    at: str(raw.at),
    passed: raw.passed === true,
    checks,
    ...(typeof raw.arch === 'string' && raw.arch ? { arch: raw.arch } : {}),
    source: raw.source === 'upload' ? 'upload' : 'auto',
  }
}

function normIncident(
  raw: unknown,
  id: string,
  c: Curriculum,
  notBefore: string,
): IncidentProgress | null {
  if (!isObj(raw)) return null
  const ip: IncidentProgress = {
    hintsShown:
      typeof raw.hintsShown === 'number' && raw.hintsShown > 0 ? Math.floor(raw.hintsShown) : 0,
    reports: Array.isArray(raw.reports)
      ? raw.reports.map(normReport).filter((r): r is IncidentReport => r !== null)
      : [],
  }
  for (const key of ['startedAt', 'debriefOpenedAt', 'solvedAt'] as const) {
    if (typeof raw[key] === 'string' && raw[key]) ip[key] = raw[key]
  }
  // Неизвестные id сохраняем для будущей версии программы. Для известных инцидентов
  // импорт и загрузка файла используют те же проверки, что входящие отчёты verify.
  const def = c.incidents.find((d) => d.id === id)
  if (!def) return ip
  const reports = ip.reports.flatMap((r) => {
    const parsed = parseIncidentReport({ ...r, incidentId: id }, [def], r.source)
    return 'report' in parsed ? [parsed.report] : []
  })
  delete ip.solvedAt
  ip.reports = []
  return mergeIncidentReports(ip, reports, notBefore)
}

export function normalizeProgress(raw: unknown, c: Curriculum): UserProgress {
  const base = createEmptyProgress(c)
  if (!isObj(raw)) return base
  const interview = isObj(raw.interview) ? raw.interview : {}
  const meta = isObj(raw.meta) ? raw.meta : {}
  const createdAt = isDate(meta.createdAt)
    ? new Date(meta.createdAt).toISOString()
    : base.meta.createdAt
  const incidents: Record<string, IncidentProgress> = {}
  if (isObj(raw.incidents)) {
    for (const [id, value] of Object.entries(raw.incidents)) {
      const ip = normIncident(value, id, c, createdAt)
      if (ip) incidents[id] = ip
    }
  }
  const activeVacancyId = c.vacancies.some((v) => v.id === raw.activeVacancyId)
    ? (raw.activeVacancyId as string)
    : base.activeVacancyId
  return {
    schemaVersion: 1,
    activeVacancyId,
    ...(Array.isArray(raw.measurements)
      ? { measurements: normalizeMeasurements(raw.measurements) }
      : {}),
    ...(Array.isArray(raw.ckaExams)
      ? { ckaExams: normalizeCkaExams(raw.ckaExams, c.incidents) }
      : {}),
    tasks: normRecord(raw.tasks, normTask),
    resources: normRecord(raw.resources, (v) =>
      isObj(v) && typeof v.completed === 'boolean'
        ? {
            completed: v.completed,
            ...(typeof v.completedAt === 'string' ? { completedAt: v.completedAt } : {}),
          }
        : null,
    ),
    skills: normRecord(raw.skills, normSkill),
    interview: {
      answers: normRecord(interview.answers, normAnswer),
      designs: normRecord(interview.designs, normDesign),
    },
    journal: Array.isArray(raw.journal)
      ? raw.journal.map(normJournal).filter((e): e is JournalEntry => e !== null)
      : [],
    finalExam: normAttempts(raw.finalExam),
    practice: normRecord(raw.practice, normPractice),
    incidents,
    saved: normSaved(raw.saved),
    gyms: normRecord(raw.gyms, normGym),
    meta: {
      createdAt,
      updatedAt: str(meta.updatedAt) || base.meta.updatedAt,
      curriculumVersion: c.version,
    },
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// localStorage
// ─────────────────────────────────────────────────────────────────────────────

export function loadProgress(c: Curriculum): UserProgress {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return normalizeProgress(JSON.parse(raw), c)
  } catch {
    // битые данные или недоступный storage — стартуем с пустого прогресса
  }
  return createEmptyProgress(c)
}

let saveFailed = false
const saveListeners = new Set<() => void>()

/** Записать прогресс в localStorage. Статус последней записи доступен через useSyncExternalStore. */
export function saveProgress(p: UserProgress): boolean {
  let ok = true
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(p))
  } catch {
    ok = false
  }
  if (saveFailed === ok) {
    saveFailed = !ok
    saveListeners.forEach((l) => l())
  }
  return ok
}

export function subscribeSaveStatus(cb: () => void): () => void {
  saveListeners.add(cb)
  return () => saveListeners.delete(cb)
}

export const getSaveFailed = (): boolean => saveFailed

// ─────────────────────────────────────────────────────────────────────────────
// Export / import
// ─────────────────────────────────────────────────────────────────────────────

export interface ExportPayload {
  format: typeof EXPORT_FORMAT
  exportedAt: string
  curriculumVersion: string
  progress: UserProgress
}

export function buildExport(p: UserProgress, c: Curriculum): ExportPayload {
  return {
    format: EXPORT_FORMAT,
    exportedAt: new Date().toISOString(),
    curriculumVersion: c.version,
    progress: p,
  }
}

export type ImportResult =
  | { ok: true; progress: UserProgress; warnings: string[] }
  | { ok: false; error: string }

export function parseImport(text: string, c: Curriculum): ImportResult {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    return { ok: false, error: 'Файл не является валидным JSON' }
  }
  if (!isObj(data)) return { ok: false, error: 'Ожидался JSON-объект' }

  const warnings: string[] = []
  let raw: unknown = data
  if (data.format === EXPORT_FORMAT) {
    raw = data.progress
    if (typeof data.curriculumVersion === 'string' && data.curriculumVersion !== c.version) {
      warnings.push(
        `Резервная копия сделана для программы ${data.curriculumVersion}, текущая версия ${c.version}. Прогресс перенесён по id задач.`,
      )
    }
  } else if (!('tasks' in data) && !('journal' in data)) {
    return {
      ok: false,
      error: 'Не похоже на резервную копию этого дашборда: нет полей progress, tasks или journal',
    }
  }
  if (!isObj(raw)) return { ok: false, error: 'Поле progress отсутствует или повреждено' }

  const progress = normalizeProgress(raw, c)
  const rawIncidents = isObj(raw.incidents) ? raw.incidents : {}
  for (const def of c.incidents) {
    const ip = rawIncidents[def.id]
    if (isObj(ip) && ip.solvedAt && !progress.incidents[def.id]?.solvedAt) {
      warnings.push(
        `Зачёт инцидента «${def.title}» не перенесён: нет отчёта со всеми пройденными проверками текущей версии после начала прогресса.`,
      )
    }
  }
  const knownTasks = new Set(c.tasks.map((t) => t.id))
  const unknown = Object.keys(progress.tasks).filter((id) => !knownTasks.has(id))
  if (unknown.length) {
    warnings.push(
      `Задачи, которых нет в текущей программе, сохранены, но не отображаются: ${unknown.join(', ')}`,
    )
  }
  return { ok: true, progress, warnings }
}

export function downloadJSON(filename: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
