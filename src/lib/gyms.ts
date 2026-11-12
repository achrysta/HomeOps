// Залы: сессии, текущий подход и расписание повторения. Без React.
// Подход засчитывается по живой проверке стенда; залы не входят в прогресс обучения и соответствие роли.

import { GYM_INTERVAL_DAYS, MAX_GYM_SESSIONS } from '../config/weights'
import type { GymDef, GymProgress, GymRep, GymSession } from '../types'

const DAY = 86_400_000

export const EMPTY_GYM: GymProgress = { sessions: [] }

/** Незавершённая сессия: последняя, у которой нет finishedAt. */
export const activeSession = (gp: GymProgress | undefined): GymSession | undefined => {
  const last = gp?.sessions.at(-1)
  return last && !last.finishedAt ? last : undefined
}

/** Текущий подход сессии — первый не засчитанный по порядку. */
export const currentRep = (def: GymDef, s: GymSession | undefined): GymRep | undefined => (s ? def.reps.find((r) => !s.reps[r.id]) : undefined)

export const isFullSession = (def: GymDef, s: GymSession): boolean => def.reps.every((r) => !!s.reps[r.id])

/** Длительность сессии в секундах (у незавершённой — до now). */
export function sessionSeconds(s: GymSession, now = Date.now()): number {
  const end = s.finishedAt ? Date.parse(s.finishedAt) : now
  return Math.max(0, Math.round((end - Date.parse(s.startedAt)) / 1000))
}

/** Полные сессии подряд в конце истории: незаконченная или прерванная сессия обнуляет серию. */
function trailingFull(def: GymDef, gp: GymProgress): GymSession[] {
  const finished = gp.sessions.filter((s) => s.finishedAt)
  const out: GymSession[] = []
  for (let i = finished.length - 1; i >= 0 && isFullSession(def, finished[i]); i--) out.unshift(finished[i])
  return out
}

/**
 * Когда зал снова пора пройти: после k-й полной сессии подряд — через GYM_INTERVAL_DAYS[k-1] дней
 * от её окончания. null — зал ещё не проходили, серия прервана без полной сессии или зал на паузе.
 */
export function gymDueAt(def: GymDef, gp: GymProgress | undefined): number | null {
  if (!gp || gp.paused) return null
  const full = trailingFull(def, gp)
  const last = full.at(-1)
  if (!last?.finishedAt) {
    // была попытка, но полной сессии в конце нет — вернуться завтра
    const tried = gp.sessions.filter((s) => s.finishedAt).at(-1)
    return tried?.finishedAt ? Date.parse(tried.finishedAt) + DAY : null
  }
  return Date.parse(last.finishedAt) + GYM_INTERVAL_DAYS[Math.min(full.length, GYM_INTERVAL_DAYS.length) - 1] * DAY
}

export type GymState = 'new' | 'active' | 'due' | 'scheduled' | 'paused'

export function gymState(def: GymDef, gp: GymProgress | undefined, now: number): GymState {
  if (gp?.paused) return 'paused'
  if (activeSession(gp)) return 'active'
  const due = gymDueAt(def, gp)
  if (due === null) return gp?.sessions.length ? 'due' : 'new'
  return due <= now ? 'due' : 'scheduled'
}

/** Лучшее время полной сессии, секунды. */
export function bestSeconds(def: GymDef, gp: GymProgress | undefined): number | null {
  const times = (gp?.sessions ?? []).filter((s) => s.finishedAt && isFullSession(def, s)).map((s) => sessionSeconds(s))
  return times.length ? Math.min(...times) : null
}

// ── Изменения (используются reducer) ─────────────────────────────────────────

/** Новая сессия; незавершённая прежняя закрывается как прерванная. */
export function startSession(gp: GymProgress | undefined, id: string, at: string): GymProgress {
  const sessions = (gp?.sessions ?? []).map((s) => (s.finishedAt ? s : { ...s, finishedAt: at }))
  return { ...(gp ?? EMPTY_GYM), sessions: [...sessions, { id, startedAt: at, reps: {} }].slice(-MAX_GYM_SESSIONS) }
}

/** Засчитать подход: только в незавершённой сессии, только текущий по порядку; последний подход завершает сессию. */
export function recordRep(def: GymDef, gp: GymProgress | undefined, sessionId: string, repId: string, at: string): GymProgress | undefined {
  const s = activeSession(gp)
  if (!gp || !s || s.id !== sessionId || currentRep(def, s)?.id !== repId) return gp
  const next: GymSession = { ...s, reps: { ...s.reps, [repId]: at } }
  if (isFullSession(def, next)) next.finishedAt = at
  return { ...gp, sessions: [...gp.sessions.slice(0, -1), next] }
}

export function finishSession(gp: GymProgress | undefined, sessionId: string, at: string): GymProgress | undefined {
  const s = activeSession(gp)
  if (!gp || !s || s.id !== sessionId) return gp
  return { ...gp, sessions: [...gp.sessions.slice(0, -1), { ...s, finishedAt: at }] }
}

/** 75 → «1:15», 3725 → «1:02:05». */
export function formatSeconds(total: number): string {
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const mm = h ? String(m).padStart(2, '0') : String(m)
  return `${h ? `${h}:` : ''}${mm}:${String(s).padStart(2, '0')}`
}

/**
 * Команды зала без сервиса стендов: запустить стенд, войти в терминал, посмотреть живую проверку.
 * Подходы так не засчитываются — зачёт ведёт дашборд через сервис стендов.
 */
export function gymCommands(def: GymDef): { label: string; cmd: string }[] {
  const dir = { label: 'Перейти в папку зала', cmd: `cd incidents/${def.id}` }
  if (def.topic === 'MLflow' || def.topic === 'Airflow' || def.topic === 'LLM API') {
    return [dir,
      { label: 'Подготовить сервисы и рабочее место', cmd: 'DASHBOARD_URL=off docker compose up -d --wait --force-recreate' },
      { label: 'Та же команда в PowerShell', cmd: '$env:DASHBOARD_URL="off"; docker compose up -d --wait --force-recreate' },
      { label: def.topic === 'Airflow' ? 'Терминал с Python, curl и Airflow CLI' : 'Терминал с curl, jq и Python', cmd: 'docker compose exec shell bash -l' },
      { label: 'Что из подходов уже готово', cmd: 'docker compose exec shell python /tools/verify.py --live' },
      { label: 'Остановить', cmd: 'docker compose down' },
    ]
  }
  if (def.topic === 'Linux') {
    return [
      dir,
      { label: 'Запустить сервер с исходным состоянием', cmd: 'docker compose up -d --build --force-recreate' },
      { label: 'Войти на сервер', cmd: 'docker compose exec server bash -l' },
      { label: 'Что из подходов уже готово', cmd: 'docker compose exec server verify --live' },
      { label: 'Остановить', cmd: 'docker compose down' },
    ]
  }
  const cluster = 'docker compose -f ../_shared/k8s/compose.yaml run --rm cluster'
  return [
    dir,
    { label: 'Создать кластер (один на все Kubernetes-стенды)', cmd: `${cluster} up` },
    { label: 'Подготовить зал с чистым namespace', cmd: 'docker compose up -d --wait --force-recreate' },
    { label: 'Терминал с kubectl', cmd: 'docker compose exec kubectl bash -l' },
    { label: 'Что из подходов уже готово', cmd: 'docker compose exec kubectl python /tools/verify.py --live' },
    { label: 'Убрать зал из кластера и остановить', cmd: 'docker compose exec kubectl homeops-level teardown && docker compose down' },
    { label: 'Удалить кластер и освободить память', cmd: `${cluster} down` },
  ]
}
