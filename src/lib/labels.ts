import type { CkaDomain, EvidenceType, Importance, IncidentLevel, InterviewRating, Level, Priority, ResourceType, TaskKind, TaskStatus } from '../types'
import type { IncidentStatus } from './incidents'
import type { DailyKind } from './daily'
import type { Availability } from './progress'

export type Tone = 'neutral' | 'accent' | 'ok' | 'warn' | 'bad' | 'info' | 'violet'

export const TONE_TEXT: Record<Tone, string> = {
  neutral: 'text-fg',
  accent: 'text-accent',
  ok: 'text-ok',
  warn: 'text-warn',
  bad: 'text-bad',
  info: 'text-info',
  violet: 'text-violet',
}

export function toneForPct(v: number): Tone {
  if (v >= 0.8) return 'ok'
  if (v >= 0.5) return 'warn'
  return 'bad'
}

export const STATUS_LABEL: Record<TaskStatus, string> = {
  not_started: 'Не начато',
  in_progress: 'В работе',
  completed: 'Выполнено',
  blocked: 'Заблокировано',
}
export const STATUS_TONE: Record<TaskStatus, Tone> = {
  not_started: 'neutral',
  in_progress: 'info',
  completed: 'ok',
  blocked: 'bad',
}

export const IMPORTANCE_LABEL: Record<Importance, string> = {
  required: 'Обязательное',
  important: 'Важное',
  bonus: 'Желательное',
  advanced: 'Продвинутое',
}
export const IMPORTANCE_TONE: Record<Importance, Tone> = {
  required: 'bad',
  important: 'warn',
  bonus: 'info',
  advanced: 'violet',
}

export const KIND_LABEL: Record<TaskKind, string> = {
  reading: 'Чтение',
  exercise: 'Упражнение',
  lab: 'Лабораторная',
  integration: 'Интеграция',
  quiz: 'Тест',
}

export const PRIORITY_TONE: Record<Priority, Tone> = { P0: 'bad', P1: 'warn', P2: 'info', P3: 'neutral' }

export const LEVEL_LABEL: Record<Level, string> = {
  0: 'нет опыта',
  1: 'базовое понимание',
  2: 'делал локально',
  3: 'проект, близкий к production',
  4: 'опыт в production',
}

export const RESOURCE_TYPE_LABEL: Record<ResourceType, string> = {
  docs: 'Документация',
  video: 'Видео',
  book: 'Книга',
  article: 'Статья',
  lab: 'Практика',
}

export const EVIDENCE_TYPE_LABEL: Record<EvidenceType, string> = {
  commit: 'Коммит',
  repo: 'Репозиторий / путь',
  screenshot: 'Скриншот (путь к файлу)',
  url: 'Ссылка',
  note: 'Текстовая заметка',
}

export const AVAILABILITY_LABEL: Record<Availability, string> = {
  done: 'Засчитано',
  ready: 'Можно начинать',
  locked: 'Ждёт предыдущих задач',
  blocked: 'Заблокировано',
  env_skipped: 'Пропущено: окружение',
}

/** Название цели: у обобщённой роли — только роль, у конкретной вакансии — «компания — роль». */
export function targetName(v: { company?: string; title: string }): string {
  return v.company ? `${v.company} — ${v.title}` : v.title
}

export function pct(n: number): string {
  return `${Math.round(n * 100)}%`
}

export function isUrl(value: string): boolean {
  return /^https?:\/\//i.test(value.trim())
}

export const INCIDENT_LEVEL_LABEL: Record<IncidentLevel, string> = { start: 'Старт', practice: 'Практика', challenge: 'Вызов' }
export const INCIDENT_LEVEL_TONE: Record<IncidentLevel, Tone> = { start: 'ok', practice: 'info', challenge: 'violet' }
export const INCIDENT_STATUS_LABEL: Record<IncidentStatus, string> = { not_started: 'Не начат', in_progress: 'В работе', solved: 'Решён' }
export const INCIDENT_STATUS_TONE: Record<IncidentStatus, Tone> = { not_started: 'neutral', in_progress: 'info', solved: 'ok' }
/** Домены CKA и их вес в экзамене (cncf/curriculum, v1.35) */
export const CKA_DOMAIN_LABEL: Record<CkaDomain, { title: string; weight: number }> = {
  troubleshooting: { title: 'Troubleshooting', weight: 30 },
  cluster: { title: 'Кластер: установка и настройка', weight: 25 },
  networking: { title: 'Сеть', weight: 20 },
  workloads: { title: 'Workloads и планирование', weight: 15 },
  storage: { title: 'Хранилище', weight: 10 },
}
/** aarch64 — Mac на Apple Silicon, x86_64 — Windows/Linux */
export const archLabel = (arch?: string) => (arch === 'aarch64' || arch === 'arm64' ? 'Mac (arm64)' : arch === 'x86_64' ? 'Windows/Linux (x86_64)' : arch ?? '')

/** Цвета оценок «Своими словами» (3 — старая оценка, читается как 2) */
export const INTERVIEW_RATING_TONE: Record<InterviewRating, Tone> = { 0: 'bad', 1: 'warn', 2: 'ok', 3: 'ok' }

/** Число со словом в нужной форме: «1 инцидент», «3 инцидента», «11 инцидентов». */
export function plural(n: number, one: string, few: string, many: string): string {
  const n10 = Math.abs(n) % 10
  const n100 = Math.abs(n) % 100
  if (n10 === 1 && n100 !== 11) return `${n} ${one}`
  if (n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14)) return `${n} ${few}`
  return `${n} ${many}`
}

/** Цвет формата практики — одинаковый на всех экранах: тренажёр, «Своими словами», инцидент, зал */
export const FORMAT_TONE: Record<DailyKind, Tone> = { trainer: 'accent', interview: 'violet', incident: 'warn', gym: 'ok' }
export const FORMAT_LABEL: Record<DailyKind, string> = { trainer: 'Тренажёр', interview: 'Своими словами', incident: 'Инцидент', gym: 'Зал' }


