import { exerciseSets } from '../data/exercises'
import { designCases } from '../data/systemDesign'
import { packs } from '../data/packs'
import type { Curriculum } from '../types'
import { buildIndex } from './progress'

const cache = new WeakMap<Curriculum, { curriculum: Curriculum; idx: ReturnType<typeof buildIndex> }>()

/** Полные тексты поверх startup-каталога. Прогресс и определения критериев не меняются. */
export function detailedCatalog(base: Curriculum) {
  const existing = cache.get(base)
  if (existing) return existing
  const replace = <T extends { id: string }>(items: T[], full: T[]): T[] => {
    const byId = new Map(full.map((item) => [item.id, item]))
    return items.map((item) => ({ ...item, ...byId.get(item.id) }))
  }
  const questions = new Map(packs.flatMap((p) => [
    ...(p.interviewTopics ?? []).flatMap((t) => t.questions),
    ...Object.values(p.interviewExtras ?? {}).flatMap((e) => e.questions ?? []),
  ]).map((q) => [q.id, q]))
  const curriculum: Curriculum = {
    ...base,
    exercises: exerciseSets,
    designCases,
    tracks: replace(base.tracks, packs.flatMap((p) => p.tracks ?? [])),
    tasks: replace(base.tasks, packs.flatMap((p) => p.tasks ?? [])),
    skills: replace(base.skills, packs.flatMap((p) => p.skills ?? [])),
    resources: replace(base.resources, packs.flatMap((p) => p.resources ?? [])),
    interviewTopics: base.interviewTopics.map((topic) => ({ ...topic, questions: topic.questions.map((q) => ({ ...q, ...questions.get(q.id) })) })),
  }
  const result = { curriculum, idx: buildIndex(curriculum) }
  cache.set(base, result)
  return result
}
