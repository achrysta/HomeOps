// Замечания к программе («Есть проблема»): неверный ответ, битая ссылка, непонятная формулировка.
// Хранятся отдельно от progress.json (data/content-issues.json): дашборд только добавляет записи,
// а агент, разбирая их, меняет status и resolution — без конфликтов с синхронизацией прогресса.

import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'

export const ISSUES_FILE = 'content-issues.json'
export const ISSUES_FORMAT = 'homeops-content-issues'
export const MAX_ISSUES = 500

export const ISSUE_KINDS = ['task', 'incident', 'resource', 'question', 'exercise', 'interview', 'gym'] as const
export const ISSUE_TYPES = ['wrong', 'link', 'unclear', 'other'] as const
export type IssueKind = (typeof ISSUE_KINDS)[number]
export type IssueType = (typeof ISSUE_TYPES)[number]
export type IssueStatus = 'open' | 'fixed' | 'wontfix'

export interface ContentIssue {
  id: string
  at: string
  kind: IssueKind
  /** id сущности программы: задачи, инцидента, материала, вопроса */
  targetId: string
  /** Название на момент замечания — чтобы запись читалась и после переименования */
  targetTitle: string
  type: IssueType
  text: string
  status: IssueStatus
  /** Что сделано — пишет агент, разбирая замечание */
  resolution?: string
  resolvedAt?: string
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const clip = (v: unknown, max: number): string => (typeof v === 'string' ? v.trim().slice(0, max) : '')

/** Проверка и очистка нового замечания из браузера. Возвращает текст ошибки, если запись не годится. */
export function sanitizeIssue(raw: unknown, now = new Date()): ContentIssue | string {
  if (!isObj(raw)) return 'Ожидается объект замечания'
  const kind = ISSUE_KINDS.find((k) => k === raw.kind)
  if (!kind) return 'Неизвестный тип объекта'
  const type = ISSUE_TYPES.find((t) => t === raw.type)
  if (!type) return 'Неизвестный вид проблемы'
  const targetId = clip(raw.targetId, 120)
  if (!/^[\w.:-]+$/.test(targetId)) return 'Некорректный id объекта'
  const text = clip(raw.text, 2000)
  if (type === 'other' && !text) return 'Опишите проблему'
  return { id: randomUUID(), at: now.toISOString(), kind, targetId, targetTitle: clip(raw.targetTitle, 300), type, text, status: 'open' }
}

export async function readIssues(dataDir: string): Promise<ContentIssue[]> {
  try {
    const data: unknown = JSON.parse(await readFile(path.join(dataDir, ISSUES_FILE), 'utf8'))
    if (isObj(data) && Array.isArray(data.issues)) return data.issues.filter((x): x is ContentIssue => isObj(x) && typeof x.id === 'string' && typeof x.targetId === 'string')
  } catch {
    // файла ещё нет или он повреждён — начинаем заново
  }
  return []
}

/** Добавить замечание; хранятся последние MAX_ISSUES (сначала вытесняются разобранные). */
export async function appendIssue(dataDir: string, issue: ContentIssue): Promise<void> {
  const issues = [...(await readIssues(dataDir)), issue]
  while (issues.length > MAX_ISSUES) {
    const resolved = issues.findIndex((x) => x.status !== 'open')
    issues.splice(resolved >= 0 ? resolved : 0, 1)
  }
  await mkdir(dataDir, { recursive: true })
  const file = path.join(dataDir, ISSUES_FILE)
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`
  await writeFile(tmp, `${JSON.stringify({ format: ISSUES_FORMAT, issues }, null, 2)}\n`, 'utf8')
  await rename(tmp, file)
}
