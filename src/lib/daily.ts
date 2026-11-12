// Набор на сегодня: по одной короткой практике разного формата — задание тренажёра, вопрос
// «Своими словами», инцидент, зал. Без React. Ничего не хранит: «сделано» видно по настоящим результатам
// в прогрессе (ответ сегодня, оценка сегодня, решение сегодня). Очков и серий нет.
// Выбор стабилен в течение дня: сделанное сегодня остаётся в наборе первым, остальное —
// по сроку повторения, затем новое; ничьи решает хеш даты и id, поэтому перезагрузка набор не меняет.

import type { Curriculum, UserProgress } from '../types'
import { drillLabel } from './drills'
import { gymDueAt, gymState, isFullSession } from './gyms'
import { confirmedIncident, incidentStatusFor } from './incidents'
import { interviewDueAt, isInterviewDue } from './interview'
import { isDue, reviewDueAt } from './quiz'

export type DailyKind = 'trainer' | 'interview' | 'incident' | 'gym'
export type DailyStatus = 'done' | 'due' | 'in_progress' | 'new'

export interface DailyItem {
  kind: DailyKind
  id: string
  title: string
  /** Тема для «скрыть тему»: трек или банк тренажёра, тема «Своими словами», тема инцидентов */
  topic: string
  topicTitle: string
  status: DailyStatus
  link: { page: 'trainer' | 'interview' | 'incidents' | 'gyms'; params: Record<string, string> }
}

export interface DailyPrefs {
  /** Пропущенные сегодня id (по дню: вчерашние пропуски не действуют) */
  skipped: { day: string; ids: string[] }
  /** Скрытые темы — не попадают в набор, пока их не вернут */
  hidden: string[]
}

export const EMPTY_DAILY_PREFS: DailyPrefs = { skipped: { day: '', ids: [] }, hidden: [] }

/** Локальная дата YYYY-MM-DD: набор меняется в полночь по часам пользователя. */
export function dayKey(now: number): string {
  const d = new Date(now)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const isToday = (at: string | undefined, now: number) =>
  !!at && !Number.isNaN(Date.parse(at)) && dayKey(Date.parse(at)) === dayKey(now)

/** FNV-1a: детерминированный «случайный» порядок внутри одного дня. */
function hash(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

interface Candidate extends DailyItem {
  /** Меньше — раньше: 0 — сделано сегодня, дальше по формату */
  tier: number
  /** Внутри уровня: срок повторения или иной порядок, ничьи — хеш */
  order: number
}

function pick(candidates: Candidate[], prefs: DailyPrefs, day: string): DailyItem | null {
  const skipped = prefs.skipped.day === day ? prefs.skipped.ids : []
  const best = candidates
    .filter(
      (c) => !prefs.hidden.includes(c.topic) && (c.status === 'done' || !skipped.includes(c.id)),
    )
    .sort((a, b) => a.tier - b.tier || a.order - b.order || hash(day + a.id) - hash(day + b.id))[0]
  if (!best) return null
  return {
    kind: best.kind,
    id: best.id,
    title: best.title,
    topic: best.topic,
    topicTitle: best.topicTitle,
    status: best.status,
    link: best.link,
  }
}

function trainerCandidates(c: Curriculum, p: UserProgress, now: number): Candidate[] {
  const trackTitle = new Map(c.tracks.map((t) => [t.id, `${t.code} · ${t.title}`]))
  const groups = [
    ...c.exercises.map((set) => ({
      topic: set.id,
      topicTitle: `Упражнения · ${set.title}`,
      items: set.exercises.map((e) => ({ id: e.id, text: e.text })),
      fresh: 2,
    })),
    ...c.drills.map((d) => ({
      topic: d.id,
      topicTitle: drillLabel(d),
      items: d.questions.map((q) => ({ id: q.id, text: q.text })),
      fresh: 3,
    })),
    ...c.quizzes.map((qz) => ({
      topic: qz.trackId,
      topicTitle: trackTitle.get(qz.trackId) ?? qz.trackId,
      items: qz.questions.map((q) => ({ id: q.id, text: q.text })),
      fresh: 3,
    })),
  ]
  return groups.flatMap((g) =>
    g.items.flatMap((item): Candidate[] => {
      const s = p.practice[item.id]
      const base = {
        kind: 'trainer' as const,
        id: item.id,
        title: item.text,
        topic: g.topic,
        topicTitle: g.topicTitle,
        link: { page: 'trainer' as const, params: { item: item.id } },
      }
      if (s && isToday(s.lastAt, now)) return [{ ...base, status: 'done', tier: 0, order: 0 }]
      if (s && isDue(s, now))
        return [{ ...base, status: 'due', tier: 1, order: reviewDueAt(s) ?? 0 }]
      // новое: сначала упражнения, затем вопросы
      if (!s) return [{ ...base, status: 'new', tier: g.fresh, order: 0 }]
      return []
    }),
  )
}

function interviewCandidates(c: Curriculum, p: UserProgress, now: number): Candidate[] {
  return c.interviewTopics.flatMap((t) => {
    const rated = t.questions.filter((q) => p.interview.answers[q.id]).length
    return t.questions.flatMap((q): Candidate[] => {
      const a = p.interview.answers[q.id]
      const link = { page: 'interview' as const, params: { view: 'topics', q: q.id } }
      const base = {
        kind: 'interview' as const,
        id: q.id,
        title: q.text,
        topic: t.id,
        topicTitle: t.title,
        link,
      }
      if (a && isToday(a.ratedAt ?? a.checkedAt ?? a.updatedAt, now))
        return [{ ...base, status: 'done', tier: 0, order: 0 }]
      if (a && isInterviewDue(a, now))
        return [{ ...base, status: 'due', tier: 1, order: interviewDueAt(a) }]
      // новое — из тем, где оценено меньше всего
      if (!a) return [{ ...base, status: 'new', tier: 2, order: rated / t.questions.length }]
      return []
    })
  })
}

const LEVEL_ORDER = { start: 0, practice: 1, challenge: 2 } as const

function incidentCandidates(c: Curriculum, p: UserProgress, now: number): Candidate[] {
  const topicOf = (d: Curriculum['incidents'][number]) =>
    d.topic ?? c.tracks.find((t) => t.id === d.trackId)?.title ?? 'MLOps'
  const solvedIn = (topic: string) =>
    c.incidents.filter((d) => topicOf(d) === topic && incidentStatusFor(d, p) === 'solved').length
  return c.incidents.flatMap((d): Candidate[] => {
    const ip = p.incidents[d.id]
    const status = incidentStatusFor(d, p, now)
    const topic = topicOf(d)
    const base = {
      kind: 'incident' as const,
      id: d.id,
      title: d.title,
      topic: `incident:${topic}`,
      topicTitle: `Инциденты · ${topic}`,
      link: { page: 'incidents' as const, params: { id: d.id } },
    }
    if (status === 'solved')
      return isToday(confirmedIncident(d, p, now)?.report.at, now)
        ? [{ ...base, status: 'done', tier: 0, order: 0 }]
        : []
    if (status === 'in_progress') {
      const last = Math.max(
        0,
        ...[ip?.startedAt, ...(ip?.reports ?? []).map((r) => r.at)].map((at) =>
          at ? Date.parse(at) || 0 : 0,
        ),
      )
      return [{ ...base, status: 'in_progress', tier: 1, order: -last }]
    }
    // новое: сначала простые уровни и темы, где решено меньше
    return [{ ...base, status: 'new', tier: 2 + LEVEL_ORDER[d.level], order: solvedIn(topic) }]
  })
}

function gymCandidates(c: Curriculum, p: UserProgress, now: number): Candidate[] {
  return c.gyms.flatMap((g): Candidate[] => {
    const gp = p.gyms[g.id]
    const base = {
      kind: 'gym' as const,
      id: g.id,
      title: g.title,
      topic: `gym:${g.topic}`,
      topicTitle: `Залы · ${g.topic}`,
      link: { page: 'gyms' as const, params: { id: g.id } },
    }
    const last = gp?.sessions.at(-1)
    if (last?.finishedAt && isFullSession(g, last) && isToday(last.finishedAt, now))
      return [{ ...base, status: 'done', tier: 0, order: 0 }]
    const state = gymState(g, gp, now)
    if (state === 'active') return [{ ...base, status: 'in_progress', tier: 1, order: 0 }]
    if (state === 'due') return [{ ...base, status: 'due', tier: 1, order: gymDueAt(g, gp) ?? 0 }]
    if (state === 'new') return [{ ...base, status: 'new', tier: 2, order: 0 }]
    return []
  })
}

/** Набор на сегодня: задание тренажёра, вопрос «Своими словами», инцидент, зал — что найдётся. */
export function dailySet(
  c: Curriculum,
  p: UserProgress,
  now: number,
  prefs: DailyPrefs = EMPTY_DAILY_PREFS,
): DailyItem[] {
  const day = dayKey(now)
  return [
    pick(trainerCandidates(c, p, now), prefs, day),
    pick(interviewCandidates(c, p, now), prefs, day),
    pick(incidentCandidates(c, p, now), prefs, day),
    pick(gymCandidates(c, p, now), prefs, day),
  ].filter((x): x is DailyItem => x !== null)
}

/** Темы, которые можно скрыть или вернуть: название по ключу. */
export function dailyTopicTitle(c: Curriculum, key: string): string {
  if (key.startsWith('incident:')) return `Инциденты · ${key.slice('incident:'.length)}`
  if (key.startsWith('gym:')) return `Залы · ${key.slice('gym:'.length)}`
  const set = c.exercises.find((x) => x.id === key)
  if (set) return `Упражнения · ${set.title}`
  const drill = c.drills.find((d) => d.id === key)
  if (drill) return drillLabel(drill)
  const track = c.tracks.find((t) => t.id === key)
  if (track) return `${track.code} · ${track.title}`
  return c.interviewTopics.find((t) => t.id === key)?.title ?? key
}

export const dailyDoneCount = (items: readonly DailyItem[]) =>
  items.filter((i) => i.status === 'done').length

/** Один дополнительный формат из набора: сначала повторение/продолжение, затем новое.
 * Сделанные форматы остаются в наборе для честного счётчика, но не рекомендуются снова.
 * При неизменном прогрессе и настройках ничьи разрешаются одинаково весь локальный день.
 */
export function recommendedDailyItem(items: readonly DailyItem[], now: number): DailyItem | undefined {
  const day = dayKey(now)
  const rank = (item: DailyItem) => item.status === 'new' ? 1 : 0
  return items
    .filter((item) => item.status !== 'done')
    .sort((a, b) => rank(a) - rank(b) || hash(day + a.kind) - hash(day + b.kind))[0]
}
