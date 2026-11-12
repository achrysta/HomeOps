import type { ContentIssue } from './issues'
import type { BackupInfo } from './sync'
import { readApiJson } from './apiResource'

export async function readBackups(signal: AbortSignal): Promise<{ dir: string; backups: BackupInfo[] }> {
  const body = await readApiJson<{ dir?: unknown; backups?: unknown }>('/api/backups', signal)
  if (!body || typeof body.dir !== 'string' || !Array.isArray(body.backups) || !body.backups.every((b: Partial<BackupInfo> | null) => b && typeof b.name === 'string' && typeof b.modifiedAt === 'string' && typeof b.size === 'number')) throw new Error('Не удалось прочитать список снимков')
  return { dir: body.dir, backups: body.backups as BackupInfo[] }
}

export async function readIssues(signal: AbortSignal): Promise<ContentIssue[]> {
  const body = await readApiJson<{ issues?: unknown }>('/api/issues', signal)
  if (!body || !Array.isArray(body.issues)) throw new Error('Не удалось прочитать список замечаний')
  return body.issues as ContentIssue[]
}

export async function readBackupText(name: string, signal: AbortSignal): Promise<string> {
  const response = await fetch(`/api/backups/${encodeURIComponent(name)}`, { signal })
  if (!response.ok) throw new Error(`Сервер вернул HTTP ${response.status}`)
  return response.text()
}
