// Замечания к программе («Есть проблема»): клиент API /api/issues. Без React.
// Файл data/content-issues.json разбирает агент: исправляет программу и отмечает status и resolution.

export type IssueKind = 'task' | 'incident' | 'resource' | 'question' | 'exercise' | 'interview' | 'gym'
export type IssueType = 'wrong' | 'link' | 'unclear' | 'other'
export type IssueStatus = 'open' | 'fixed' | 'wontfix'

export interface ContentIssue {
  id: string
  at: string
  kind: IssueKind
  targetId: string
  targetTitle: string
  type: IssueType
  text: string
  status: IssueStatus
  resolution?: string
  resolvedAt?: string
}

export const ISSUE_TYPE_LABEL: Record<IssueType, string> = { wrong: 'Неверный ответ или разбор', link: 'Битая ссылка', unclear: 'Непонятно написано', other: 'Другое' }
export const ISSUE_KIND_LABEL: Record<IssueKind, string> = { task: 'Задача', incident: 'Инцидент', resource: 'Материал', question: 'Вопрос тренажёра', exercise: 'Упражнение', interview: 'Вопрос «Своими словами»', gym: 'Зал' }
export const ISSUE_STATUS_LABEL: Record<IssueStatus, string> = { open: 'Открыто', fixed: 'Исправлено', wontfix: 'Оставлено как есть' }

export async function postIssue(issue: { kind: IssueKind; targetId: string; targetTitle: string; type: IssueType; text: string }): Promise<string | null> {
  try {
    const res = await fetch('/api/issues', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(issue) })
    if (res.ok) return null
    const body = (await res.json().catch(() => ({}))) as { error?: string }
    return body.error ?? `HTTP ${res.status}`
  } catch {
    return 'Сервер дашборда недоступен'
  }
}
