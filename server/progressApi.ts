import { isAllowedRequest } from './requestGuards.ts'
// Файловое хранилище прогресса: data/progress.json + снимки в data/backups/.
// Без зависимостей — только встроенные модули Node. Используется и в dev (Vite middleware),
// и в production-сервере (server/serve.ts).

import {
  copyFile,
  mkdir,
  readFile,
  readdir,
  rename,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import path from 'node:path'
import { appendIssue, readIssues, sanitizeIssue } from './contentIssues.ts'
import { appendReport, readReports, sanitizeReport } from './incidentReports.ts'

export const PROGRESS_FILE = 'progress.json'
export const BACKUP_DIR = 'backups'
export const MAX_BACKUPS = 60
// формат data/progress.json: по нему узнаётся файл прогресса, менять нельзя
export const FILE_FORMAT = 'homeops-progress'
const MAX_BODY_BYTES = 10 * 1024 * 1024
const MAX_REPORT_BYTES = 256 * 1024
/** Замечание к программе — короткий текст */
const MAX_ISSUE_BYTES = 16 * 1024

/** Формат совпадает с export-файлом приложения, поэтому progress.json можно импортировать как backup. */
export interface StoredFile {
  format: string
  savedAt: string
  revision: number
  curriculumVersion?: string
  progress: Record<string, unknown>
}

export interface BackupInfo {
  name: string
  size: number
  modifiedAt: string
}

export type WriteResult =
  | { ok: true; revision: number; savedAt: string }
  | { ok: false; current: StoredFile | null; revision: number }

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

export class CorruptedFileError extends Error {}

export async function readStored(dataDir: string): Promise<StoredFile | null> {
  let text: string
  try {
    text = await readFile(path.join(dataDir, PROGRESS_FILE), 'utf8')
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw e
  }
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    throw new CorruptedFileError(`${PROGRESS_FILE} повреждён: невалидный JSON`)
  }
  if (!isObj(data) || !isObj(data.progress))
    throw new CorruptedFileError(`${PROGRESS_FILE} повреждён: нет поля progress`)
  return {
    format: typeof data.format === 'string' ? data.format : FILE_FORMAT,
    savedAt: typeof data.savedAt === 'string' ? data.savedAt : new Date(0).toISOString(),
    revision: typeof data.revision === 'number' ? data.revision : 1,
    ...(typeof data.curriculumVersion === 'string'
      ? { curriculumVersion: data.curriculumVersion }
      : {}),
    progress: data.progress,
  }
}

async function atomicWrite(file: string, content: string): Promise<void> {
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`
  await writeFile(tmp, content, 'utf8')
  await rename(tmp, file)
}

function localDate(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export async function listBackups(dataDir: string): Promise<BackupInfo[]> {
  const dir = path.join(dataDir, BACKUP_DIR)
  let names: string[]
  try {
    names = (await readdir(dir)).filter((n) => n.endsWith('.json'))
  } catch {
    return []
  }
  const items = await Promise.all(
    names.map(async (name) => {
      const s = await stat(path.join(dir, name))
      return { name, size: s.size, modifiedAt: s.mtime.toISOString() }
    }),
  )
  return items.sort(
    (a, b) => b.modifiedAt.localeCompare(a.modifiedAt) || b.name.localeCompare(a.name),
  )
}

async function pruneBackups(dataDir: string): Promise<void> {
  const items = await listBackups(dataDir)
  await Promise.all(
    items
      .slice(MAX_BACKUPS)
      .map((b) => unlink(path.join(dataDir, BACKUP_DIR, b.name)).catch(() => undefined)),
  )
}

/**
 * Снимок в backups/: копия текущего progress.json или, если передан content,
 * произвольное состояние (например, локальная версия из браузера при конфликте).
 * Возвращает имя файла или null, если сохранять нечего.
 */
export async function createSnapshot(
  dataDir: string,
  reason: string,
  content?: Record<string, unknown>,
): Promise<string | null> {
  const src = path.join(dataDir, PROGRESS_FILE)
  if (!content) {
    try {
      await stat(src)
    } catch {
      return null
    }
  }
  const safeReason =
    reason
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '')
      .slice(0, 32) || 'manual'
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 23)
  const name = `progress-${stamp}-${safeReason}.json`
  const target = path.join(dataDir, BACKUP_DIR, name)
  await mkdir(path.join(dataDir, BACKUP_DIR), { recursive: true })
  if (content) {
    const file: StoredFile = {
      format: FILE_FORMAT,
      savedAt: new Date().toISOString(),
      revision: 0,
      progress: content,
    }
    await writeFile(target, `${JSON.stringify(file, null, 2)}\n`, 'utf8')
  } else {
    await copyFile(src, target)
  }
  await pruneBackups(dataDir)
  return name
}

/** Имя файла снимка: только то, что создаёт createSnapshot/dailySnapshot, без путей. */
export const BACKUP_NAME_RE = /^progress-[A-Za-z0-9._-]+\.json$/

/** Содержимое снимка или null, если такого нет. */
export async function readBackup(dataDir: string, name: string): Promise<string | null> {
  if (!BACKUP_NAME_RE.test(name) || path.basename(name) !== name) return null
  try {
    return await readFile(path.join(dataDir, BACKUP_DIR, name), 'utf8')
  } catch {
    return null
  }
}

/** Ежедневный снимок: состояние на момент первой записи за день. */
async function dailySnapshot(dataDir: string): Promise<void> {
  const name = `progress-${localDate()}-daily.json`
  const target = path.join(dataDir, BACKUP_DIR, name)
  try {
    await stat(target)
    return
  } catch {
    // снимка за сегодня ещё нет
  }
  await mkdir(path.join(dataDir, BACKUP_DIR), { recursive: true })
  await copyFile(path.join(dataDir, PROGRESS_FILE), target)
  await pruneBackups(dataDir)
}

/**
 * Запись с optimistic concurrency: baseRevision должна совпасть с текущей ревизией файла.
 * Иначе (например, устаревшая вкладка) запись отклоняется и возвращается актуальное состояние.
 */
export async function writeStored(
  dataDir: string,
  progress: Record<string, unknown>,
  baseRevision: number,
  curriculumVersion?: string,
): Promise<WriteResult> {
  const current = await readStored(dataDir)
  const currentRevision = current?.revision ?? 0
  if (baseRevision !== currentRevision) return { ok: false, current, revision: currentRevision }

  await mkdir(dataDir, { recursive: true })
  if (current) await dailySnapshot(dataDir)
  const next: StoredFile = {
    format: FILE_FORMAT,
    savedAt: new Date().toISOString(),
    revision: currentRevision + 1,
    ...(curriculumVersion ? { curriculumVersion } : {}),
    progress,
  }
  await atomicWrite(path.join(dataDir, PROGRESS_FILE), `${JSON.stringify(next, null, 2)}\n`)
  return { ok: true, revision: next.revision, savedAt: next.savedAt }
}

// ─────────────────────────────────────────────────────────────────────────────
// HTTP
// ─────────────────────────────────────────────────────────────────────────────

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const data = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  })
  res.end(data)
}

async function readJsonBody(req: IncomingMessage, limit = MAX_BODY_BYTES): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    size += (chunk as Buffer).length
    if (size > limit) throw new Error('Слишком большой запрос')
    chunks.push(chunk as Buffer)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
}

export interface ProgressApiOptions {
  dataDir: string
  /** Как показать расположение данных пользователю (например, путь на хосте для Docker). */
  dataDirLabel?: string
}

/**
 * Обработчик /api/*. Возвращает true, если запрос обработан.
 * Совместим с connect-middleware (Vite): handler(req, res, next).
 */
export function createProgressApi({ dataDir, dataDirLabel }: ProgressApiOptions) {
  const label = dataDirLabel ?? dataDir
  // Все операции с файлами выполняются последовательно, чтобы параллельные PUT не перетёрли друг друга.
  let queue: Promise<unknown> = Promise.resolve()
  const serialized = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = queue.then(fn, fn)
    queue = run.catch(() => undefined)
    return run
  }

  return async function handle(
    req: IncomingMessage,
    res: ServerResponse,
    next?: () => void,
  ): Promise<boolean> {
    const url = new URL(req.url ?? '/', 'http://localhost')
    // /api/labs/* обслуживает сервис стендов (прокси в serve.ts и в Vite)
    if (!url.pathname.startsWith('/api/') || url.pathname.startsWith('/api/labs/')) {
      next?.()
      return false
    }
    try {
      // verify из контейнера использует host.docker.internal; браузер — только свой локальный origin.
      if (!isAllowedRequest(req.headers, ['host.docker.internal'])) {
        sendJson(res, 403, { error: 'Запрос не с этой машины или с чужого сайта' })
        return true
      }
      const route = `${req.method} ${url.pathname}`
      if (
        ['POST', 'PUT'].includes(req.method ?? '') &&
        (req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase() !==
          'application/json'
      ) {
        sendJson(res, 415, { error: 'Ожидается application/json' })
        return true
      }
      if (route === 'GET /api/health') {
        sendJson(res, 200, { ok: true, dataDir: label, file: path.join(label, PROGRESS_FILE) })
      } else if (route === 'GET /api/progress') {
        const stored = await serialized(() => readStored(dataDir))
        if (!stored) sendJson(res, 404, { revision: 0, file: path.join(label, PROGRESS_FILE) })
        else sendJson(res, 200, { ...stored, file: path.join(label, PROGRESS_FILE) })
      } else if (route === 'PUT /api/progress') {
        const body = await readJsonBody(req)
        if (!isObj(body) || !isObj(body.progress) || typeof body.baseRevision !== 'number') {
          sendJson(res, 400, { error: 'Ожидается { progress: object, baseRevision: number }' })
        } else {
          const progress = body.progress
          const baseRevision = body.baseRevision
          const cv = typeof body.curriculumVersion === 'string' ? body.curriculumVersion : undefined
          const result = await serialized(() => writeStored(dataDir, progress, baseRevision, cv))
          if (result.ok) sendJson(res, 200, { revision: result.revision, savedAt: result.savedAt })
          else
            sendJson(res, 409, {
              revision: result.revision,
              savedAt: result.current?.savedAt,
              progress: result.current?.progress ?? null,
            })
        }
      } else if (route === 'GET /api/backups') {
        sendJson(res, 200, {
          dir: path.join(label, BACKUP_DIR),
          backups: await listBackups(dataDir),
        })
      } else if (req.method === 'GET' && url.pathname.startsWith('/api/backups/')) {
        const content = await readBackup(
          dataDir,
          decodeURIComponent(url.pathname.slice('/api/backups/'.length)),
        )
        if (content === null) {
          sendJson(res, 404, { error: 'Снимок не найден' })
        } else {
          res.writeHead(200, {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'no-store',
          })
          res.end(content)
        }
      } else if (route === 'POST /api/backups') {
        const body = await readJsonBody(req)
        const reason = isObj(body) && typeof body.reason === 'string' ? body.reason : 'manual'
        const content = isObj(body) && isObj(body.progress) ? body.progress : undefined
        const name = await serialized(() => createSnapshot(dataDir, reason, content))
        if (name) sendJson(res, 201, { name })
        else sendJson(res, 404, { error: 'Файл прогресса ещё не создан' })
      } else if (route === 'GET /api/incidents/reports') {
        sendJson(res, 200, { reports: await serialized(() => readReports(dataDir)) })
      } else if (route === 'POST /api/incidents/reports') {
        const report = sanitizeReport(await readJsonBody(req, MAX_REPORT_BYTES))
        if (typeof report === 'string') {
          sendJson(res, 400, { error: report })
        } else {
          await serialized(() => appendReport(dataDir, report))
          sendJson(res, 201, { id: report.id, passed: report.passed })
        }
      } else if (route === 'GET /api/issues') {
        sendJson(res, 200, { issues: await serialized(() => readIssues(dataDir)) })
      } else if (route === 'POST /api/issues') {
        const issue = sanitizeIssue(await readJsonBody(req, MAX_ISSUE_BYTES))
        if (typeof issue === 'string') {
          sendJson(res, 400, { error: issue })
        } else {
          await serialized(() => appendIssue(dataDir, issue))
          sendJson(res, 201, { id: issue.id })
        }
      } else {
        sendJson(res, 404, { error: 'Not found' })
      }
    } catch (e) {
      const corrupted = e instanceof CorruptedFileError
      sendJson(res, corrupted ? 500 : e instanceof SyntaxError ? 400 : 500, {
        error: e instanceof Error ? e.message : 'Internal error',
        corrupted,
      })
    }
    return true
  }
}
