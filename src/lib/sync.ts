// Синхронизация прогресса с файлом data/progress.json через локальный API.
//
// Источник истины — файл. localStorage — кэш на случай, когда сервер недоступен.
// Чтобы пустой или устаревший кэш браузера никогда не затёр файл, браузер помнит
// (ключ SYNC_META_KEY), с какой ревизией файла он синхронизировался и есть ли с тех пор
// несохранённые правки. Локальная версия записывается в файл, только если она содержит
// офлайн-правки поверх той же ревизии; при конфликте она сохраняется отдельным снимком.

import type { Curriculum, UserProgress } from '../types'
import { normalizeProgress } from './storage'
import { progressRequest } from './progressRequest'

export type SyncMode = 'connecting' | 'synced' | 'saving' | 'offline' | 'error'

export interface SyncStatus {
  mode: SyncMode
  revision: number
  savedAt?: string
  file?: string
  message?: string
  /** Разовое уведомление (конфликт, восстановление) */
  notice?: string
}

export interface BackupInfo {
  name: string
  size: number
  modifiedAt: string
}

interface SyncMeta {
  /** Ревизия файла, с которой совпадало локальное состояние */
  baseRevision: number
  /** Есть локальные правки, ещё не записанные в файл */
  dirty: boolean
}

export const SYNC_META_KEY = 'homeops.sync.v1'
const RETRY_MS = 15_000
const DEBOUNCE_MS = 400
const CONFLICT_NO_SNAPSHOT =
  'Файл прогресса изменён в другом месте, а сохранить снимок изменений этой вкладки не удалось. Запись в файл остановлена, чтобы ничего не потерять: экспортируйте прогресс на странице «Резервная копия» и перезагрузите страницу.'
const OFFLINE_MESSAGE =
  'Сервер хранения не ответил вовремя или недоступен. Изменения остаются в кэше браузера; проверьте запуск дашборда и повторите подключение. Автоматическая попытка записи — через 15 секунд. Перед закрытием вкладки скачайте локальную копию.'

let status: SyncStatus = { mode: 'connecting', revision: 0 }
const listeners = new Set<() => void>()

let curriculum: Curriculum | null = null
let applyRemote: ((p: UserProgress) => void) | null = null
let started = false
let ready = false
let revision = 0
let lastSynced: string | null = null
let pending: UserProgress | null = null
let inflight = false
let debounceTimer: ReturnType<typeof setTimeout> | undefined
let retryTimer: ReturnType<typeof setTimeout> | undefined

function setStatus(patch: Partial<SyncStatus>): void {
  status = { ...status, ...patch }
  listeners.forEach((l) => l())
}

export const subscribeSync = (cb: () => void) => {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}
export const getSyncStatus = (): SyncStatus => status
export const dismissSyncNotice = () => setStatus({ notice: undefined })

function readMeta(): SyncMeta | null {
  try {
    const raw = localStorage.getItem(SYNC_META_KEY)
    if (!raw) return null
    const m = JSON.parse(raw) as Partial<SyncMeta>
    return typeof m.baseRevision === 'number'
      ? { baseRevision: m.baseRevision, dirty: !!m.dirty }
      : null
  } catch {
    return null
  }
}

function writeMeta(meta: SyncMeta): void {
  try {
    localStorage.setItem(SYNC_META_KEY, JSON.stringify(meta))
  } catch {
    // без localStorage просто не будет офлайн-режима
  }
}

/** Пустой прогресс (например, после очистки данных браузера) — сохранять его снимком бессмысленно. */
function isPristine(p: UserProgress): boolean {
  return (
    Object.keys(p.tasks).length === 0 &&
    Object.keys(p.resources).length === 0 &&
    Object.keys(p.skills).length === 0 &&
    Object.keys(p.interview.answers).length === 0 &&
    Object.keys(p.interview.designs).length === 0 &&
    p.journal.length === 0 &&
    Object.keys(p.practice).length === 0 &&
    Object.keys(p.incidents).length === 0 &&
    p.saved.length === 0 &&
    Object.keys(p.gyms).length === 0 &&
    p.finalExam.length === 0 &&
    (p.measurements?.length ?? 0) === 0 &&
    (p.ckaExams?.length ?? 0) === 0
  )
}

/** Каноническое представление для сравнения: порядок ключей и дефолты нормализованы. */
function canonical(p: unknown): string {
  // Время изменения не считается содержимым: две вкладки, сделавшие одно и то же изменение
  // (например, обе приняли один отчёт автопроверки), не должны конфликтовать
  const n = normalizeProgress(p, curriculum!)
  return JSON.stringify({ ...n, meta: { ...n.meta, updatedAt: '' } })
}

async function requestJson(
  input: string,
  init?: RequestInit,
): Promise<{ status: number; body: Record<string, unknown> } | null> {
  return progressRequest(
    input,
    { ...init, headers: { 'Content-Type': 'application/json', ...init?.headers } },
    async (res) => {
      if (!(res.headers.get('content-type') ?? '').includes('application/json')) return null
      return { status: res.status, body: (await res.json()) as Record<string, unknown> }
    },
  )
}

export async function createSnapshot(
  reason: string,
  progress?: UserProgress,
): Promise<string | null> {
  const r = await requestJson('/api/backups', {
    method: 'POST',
    body: JSON.stringify({ reason, ...(progress ? { progress } : {}) }),
  })
  return r?.status === 201 ? String(r.body.name) : null
}

/**
 * Снимок самого свежего локального состояния. Пока шёл запрос, могли прийти новые правки
 * (queueSave кладёт их в pending) — тогда снимок делается и для них.
 */
async function snapshotLatest(reason: string, first: UserProgress): Promise<string | null> {
  let latest = first
  let name = await createSnapshot(reason, latest)
  while (name && pending && pending !== latest) {
    latest = pending
    name = await createSnapshot(reason, latest)
  }
  return name
}

/**
 * Первичная загрузка. StoreProvider вызывает queueSave(progress) до initSync,
 * поэтому pending уже содержит состояние из localStorage.
 */
export async function initSync(c: Curriculum, apply: (p: UserProgress) => void): Promise<void> {
  if (started) return
  started = true
  curriculum = c
  applyRemote = apply
  const meta = readMeta()
  revision = meta?.baseRevision ?? 0

  const r = await requestJson('/api/progress')
  // Локальное состояние берём ПОСЛЕ ответа сервера: пока шёл запрос, queueSave мог
  // вызываться ещё раз (например, повторный mount в React StrictMode). Всё, что пришло
  // до готовности, сверяется с файлом по общим правилам и не отправляется вслепую.
  const local = pending
  pending = null

  if (!r) {
    // Сервер недоступен: работаем на кэше, офлайн-правки помечаются dirty и уйдут позже
    lastSynced = local ? canonical(local) : null
    if (meta?.dirty && local) pending = local
    setStatus({ mode: 'offline', message: OFFLINE_MESSAGE })
  } else if (r.status === 404) {
    // Файла ещё нет: переносим в него текущее состояние браузера
    revision = 0
    setStatus({ file: r.body.file as string | undefined })
    pending = local
  } else if (r.status === 200) {
    const remoteRevision = Number(r.body.revision) || 0
    const remote = normalizeProgress(r.body.progress, c)
    revision = remoteRevision
    lastSynced = canonical(remote)
    setStatus({
      mode: 'synced',
      revision,
      savedAt: r.body.savedAt as string,
      file: r.body.file as string | undefined,
      message: undefined,
    })

    const localDiffers = !!local && canonical(local) !== lastSynced
    if (localDiffers && meta?.dirty && meta.baseRevision === remoteRevision) {
      // Офлайн-правки поверх актуальной ревизии — дописываем их в файл
      pending = local
    } else {
      if (localDiffers && local && !isPristine(local) && (meta?.dirty || !meta)) {
        // Локальная версия расходится с файлом и могла содержать что-то ценное — не выбрасываем её молча
        const name = await snapshotLatest(meta ? 'conflict-browser' : 'browser-cache', local)
        if (!name) {
          // Без снимка версию из файла не применяем: локальная осталась бы только в памяти вкладки
          setStatus({ mode: 'error', message: CONFLICT_NO_SNAPSHOT })
          ready = true
          return
        }
        pending = null
        if (meta?.dirty) {
          setStatus({
            notice: `Файл прогресса изменился, пока эта вкладка была без связи. Загружена версия из файла; локальные правки сохранены в снимке ${name}.`,
          })
        }
      }
      if (localDiffers) apply(remote)
      writeMeta({ baseRevision: remoteRevision, dirty: false })
    }
  } else {
    setStatus({
      mode: 'error',
      message: `${String(r.body.error ?? 'Ошибка чтения файла прогресса')}. Запись в файл приостановлена, чтобы ничего не затереть. Исправьте или удалите data/progress.json и перезагрузите страницу.`,
    })
    ready = true
    return
  }
  ready = true
  void flush()
}

/** Вызывается при каждом изменении прогресса. */
export function queueSave(p: UserProgress): void {
  if (!ready) {
    pending = p // состояние до первичной загрузки — сверим его с файлом в initSync
    return
  }
  if (status.mode === 'error') return
  if (lastSynced !== null && canonical(p) === lastSynced && !inflight) {
    pending = null
    clearTimeout(debounceTimer)
    writeMeta({ baseRevision: revision, dirty: false })
    return
  }
  pending = p
  writeMeta({ baseRevision: revision, dirty: true })
  clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => void flush(), DEBOUNCE_MS)
}

async function flush(): Promise<void> {
  if (inflight || !pending || !ready || status.mode === 'error') return
  inflight = true
  clearTimeout(retryTimer)
  const body = pending
  pending = null
  setStatus({ mode: 'saving' })

  const r = await requestJson('/api/progress', {
    method: 'PUT',
    body: JSON.stringify({
      progress: body,
      baseRevision: revision,
      curriculumVersion: curriculum?.version,
    }),
  })

  if (r?.status === 200) {
    revision = Number(r.body.revision)
    lastSynced = canonical(body)
    if (!pending) writeMeta({ baseRevision: revision, dirty: false })
    setStatus({ mode: 'synced', revision, savedAt: r.body.savedAt as string, message: undefined })
  } else if (
    r?.status === 409 &&
    r.body.progress &&
    canonical(pending ?? body) === canonical(r.body.progress)
  ) {
    // Файл изменили в другом месте, но так же, как здесь: снимок не нужен, просто берём его ревизию
    revision = Number(r.body.revision) || 0
    lastSynced = canonical(r.body.progress)
    pending = null
    writeMeta({ baseRevision: revision, dirty: false })
    setStatus({
      mode: 'synced',
      revision,
      savedAt: r.body.savedAt as string | undefined,
      message: undefined,
    })
  } else if (r?.status === 409) {
    // Файл изменили в другой вкладке/окне. Сначала снимком сохраняется самое свежее локальное
    // состояние (правки, сделанные во время запроса, лежат в pending), и только потом загружается
    // версия из файла. Без снимка ничего не заменяем и останавливаем запись.
    const name = await snapshotLatest('conflict-browser', pending ?? body)
    if (!name) {
      inflight = false
      setStatus({ mode: 'error', message: CONFLICT_NO_SNAPSHOT })
      return
    }
    revision = Number(r.body.revision) || 0
    if (r.body.progress) {
      const remote = normalizeProgress(r.body.progress, curriculum!)
      lastSynced = canonical(remote)
      applyRemote?.(remote)
    }
    pending = null
    writeMeta({ baseRevision: revision, dirty: false })
    setStatus({
      mode: 'synced',
      revision,
      savedAt: r.body.savedAt as string | undefined,
      message: undefined,
      notice: `Файл прогресса изменён в другой вкладке или окне — загружена актуальная версия. Изменения этой вкладки сохранены в снимке ${name}.`,
    })
  } else {
    pending = pending ?? body
    setStatus({
      mode: 'offline',
      message: r ? `Ошибка записи в файл: ${String(r.body.error ?? r.status)}` : OFFLINE_MESSAGE,
    })
    retryTimer = setTimeout(() => void flush(), RETRY_MS)
  }
  inflight = false
  if (pending && status.mode !== 'offline') void flush()
}

// При закрытии вкладки пытаемся дописать несохранённое (keepalive-запрос переживает выгрузку страницы).
// Если не получится — правки остаются в localStorage с флагом dirty и уйдут при следующем запуске.
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => {
    if (!pending || !ready || status.mode === 'error') return
    try {
      void fetch('/api/progress', {
        method: 'PUT',
        keepalive: true,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          progress: pending,
          baseRevision: revision,
          curriculumVersion: curriculum?.version,
        }),
      })
    } catch {
      // см. комментарий выше
    }
  })
}
