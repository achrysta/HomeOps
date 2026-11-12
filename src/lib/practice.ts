// Единая модель практики: практические задачи и инциденты — разные форматы одной практики
// с общими статусами, темами и закладками. Без React.
// «Засчитано» — только подтверждённое: задача — по критериям и подтверждению, инцидент — по автопроверке.

import type { Curriculum, SavedItem, UserProgress } from '../types'
import { incidentStatusFor } from './incidents'
import { getAvailability, getTaskProgress, isPracticeTask, type CurriculumIndex } from './progress'

export type PracticeFormat = 'task' | 'incident'
export type PracticeStatus = 'todo' | 'in_progress' | 'done'

export interface PracticeItem {
  format: PracticeFormat
  id: string
  title: string
  topicId: string
  status: PracticeStatus
  saved: boolean
  /** Задача закрыта незасчитанными предыдущими задачами */
  locked: boolean
  /** Заблокирована вручную или пропущена из-за окружения — в счёт темы не идёт */
  blocked: boolean
  optional: boolean
  minutes?: number
  skillIds: string[]
  /** Порядок в программе: треки по порядку, внутри — задачи, затем инциденты; DevOps-база — после треков */
  order: number
}

export interface PracticeTopic {
  id: string
  title: string
  code?: string
  done: number
  total: number
}

export const isSaved = (
  saved: readonly SavedItem[],
  kind: SavedItem['kind'],
  id: string,
): boolean => saved.some((s) => s.kind === kind && s.id === id)

/** Тема практики: трек программы для задач и MLOps-инцидентов, тема DevOps-базы для остальных инцидентов. */
const trackTopic = (trackId: string) => `track:${trackId}`
const devopsTopic = (topic: string) => `devops:${topic}`

export function practiceItems(
  c: Curriculum,
  idx: CurriculumIndex,
  p: UserProgress,
): PracticeItem[] {
  const trackOrder = (id: string) => idx.trackById.get(id)?.order ?? 0
  const taskIndex = new Map(c.tasks.map((t, i) => [t.id, i]))
  const tasks = c.tasks.filter(isPracticeTask).map((task): PracticeItem => {
    const tp = getTaskProgress(p, task.id)
    const availability = getAvailability(task, idx, p)
    const touched =
      tp.status === 'in_progress' ||
      tp.status === 'completed' ||
      tp.evidence.length > 0 ||
      tp.criteriaDone.length > 0
    return {
      format: 'task',
      id: task.id,
      title: task.title,
      topicId: trackTopic(task.trackId),
      status: availability === 'done' ? 'done' : touched ? 'in_progress' : 'todo',
      saved: isSaved(p.saved, 'task', task.id),
      locked: availability === 'locked',
      blocked: availability === 'blocked' || availability === 'env_skipped',
      optional: !!task.optional,
      skillIds: task.vacancyRequirementIds,
      order: trackOrder(task.trackId) * 1000 + (taskIndex.get(task.id) ?? 0),
    }
  })
  const devopsTopics = [
    ...new Set(c.incidents.filter((d) => !d.trackId).map((d) => d.topic ?? 'DevOps')),
  ]
  const incidents = c.incidents.map((def, i): PracticeItem => {
    const status = incidentStatusFor(def, p)
    return {
      format: 'incident',
      id: def.id,
      title: def.title,
      topicId: def.trackId ? trackTopic(def.trackId) : devopsTopic(def.topic ?? 'DevOps'),
      status: status === 'solved' ? 'done' : status === 'in_progress' ? 'in_progress' : 'todo',
      saved: isSaved(p.saved, 'incident', def.id),
      locked: false,
      blocked: false,
      optional: false,
      minutes: def.minutes,
      skillIds: def.skillIds,
      order: def.trackId
        ? trackOrder(def.trackId) * 1000 + 900 + i
        : 100_000 + devopsTopics.indexOf(def.topic ?? 'DevOps') * 1000 + i,
    }
  })
  return [...tasks, ...incidents].sort((a, b) => a.order - b.order)
}

/** Темы со счётом «засчитано N из M» (заблокированное в счёт не идёт), в порядке программы. */
export function practiceTopics(
  idx: CurriculumIndex,
  items: readonly PracticeItem[],
): PracticeTopic[] {
  const topics = new Map<string, PracticeTopic>()
  for (const item of items) {
    let topic = topics.get(item.topicId)
    if (!topic) {
      const [kind, key] = item.topicId.split(/:(.+)/)
      const track = kind === 'track' ? idx.trackById.get(key) : undefined
      topic = {
        id: item.topicId,
        title: track?.title ?? key,
        ...(track ? { code: track.code } : {}),
        done: 0,
        total: 0,
      }
      topics.set(item.topicId, topic)
    }
    if (item.blocked) continue
    topic.total++
    if (item.status === 'done') topic.done++
  }
  return [...topics.values()].filter((t) => t.total > 0)
}

/**
 * «Начни с этой»: первая доступная незасчитанная практика —
 * сначала то, что уже в работе, затем сохранённое, затем по порядку программы; необязательное — в конце.
 */
export function startHere(items: readonly PracticeItem[], topicId = ''): PracticeItem | undefined {
  return items
    .filter(
      (i) => i.status !== 'done' && !i.locked && !i.blocked && (!topicId || i.topicId === topicId),
    )
    .sort(
      (a, b) =>
        Number(b.status === 'in_progress') - Number(a.status === 'in_progress') ||
        Number(b.saved) - Number(a.saved) ||
        Number(a.optional) - Number(b.optional) ||
        a.order - b.order,
    )[0]
}

export interface PracticeFilters {
  status: 'all' | PracticeStatus | 'saved'
  format: 'all' | PracticeFormat
  topic: string
}

export const EMPTY_PRACTICE_FILTERS: PracticeFilters = { status: 'all', format: 'all', topic: '' }

export function filterPractice(items: readonly PracticeItem[], f: PracticeFilters): PracticeItem[] {
  return items.filter(
    (i) =>
      (f.format === 'all' || i.format === f.format) &&
      (!f.topic || i.topicId === f.topic) &&
      (f.status === 'all' || (f.status === 'saved' ? i.saved : i.status === f.status)),
  )
}
