import { describe, expect, it } from 'vitest'
import { curriculum } from '../data'
import { packs } from '../data/packs'
import { designMetadata, exerciseMetadata, packMetadata } from '../../scripts/packMetadata'
import { detailedCatalog } from './contentCatalog'
import { buildIndex, computeSkillLevels, computeVacancyMatch, getTaskProgress, isVerified, summarize } from './progress'
import { createEmptyProgress } from './storage'

describe('lazy pack texts', () => {
  it('restores all full texts and keeps confirmed progress identical', () => {
    const metas = packs.map(packMetadata)
    const map = <T extends { id: string }>(items: T[], metadata: T[]): T[] => items.map((item) => metadata.find((m) => m.id === item.id) ?? item)
    const questions = metas.flatMap((p) => [...(p.interviewTopics ?? []).flatMap((t) => t.questions), ...Object.values(p.interviewExtras ?? {}).flatMap((e) => e.questions ?? [])])
    const base = { ...curriculum,
      exercises: exerciseMetadata(curriculum.exercises),
      designCases: designMetadata(curriculum.designCases),
      tasks: map(curriculum.tasks, metas.flatMap((p) => p.tasks ?? [])),
      tracks: map(curriculum.tracks, metas.flatMap((p) => p.tracks ?? [])),
      skills: map(curriculum.skills, metas.flatMap((p) => p.skills ?? [])),
      resources: map(curriculum.resources, metas.flatMap((p) => p.resources ?? [])),
      interviewTopics: curriculum.interviewTopics.map((t) => ({ ...t, questions: map(t.questions, questions) })),
    }
    const detailed = detailedCatalog(base)
    expect(detailedCatalog(base)).toBe(detailed)
    // Планы восстанавливаются своей lazy-карточкой, не дублируются в каталоге пакетов.
    expect(detailed.curriculum.tasks.map(({ steps: _steps, ...t }) => t)).toEqual(curriculum.tasks.map(({ steps: _steps, ...t }) => t))
    expect(detailed.curriculum.exercises).toEqual(curriculum.exercises)
    expect(detailed.curriculum.designCases).toEqual(curriculum.designCases)
    expect(detailed.curriculum.interviewTopics).toEqual(curriculum.interviewTopics)
    expect(detailed.curriculum.tracks).toEqual(curriculum.tracks)
    const p = createEmptyProgress(curriculum)
    for (const task of base.tasks.filter((t) => ['I1', 'J2', 'B7', 'G7'].includes(t.id))) {
      const tp = { ...getTaskProgress(p, task.id), criteriaDone: [], evidence: [] } as ReturnType<typeof getTaskProgress>
      p.tasks[task.id] = tp
      tp.status = 'completed'
      expect(isVerified(task, tp)).toBe(false)
      tp.criteriaDone = [...task.acceptanceCriteria]
      tp.evidence = [{ id: 'e', type: 'note', value: 'Подтверждение практики', createdAt: p.meta.createdAt }]
      expect(isVerified(task, tp)).toBe(true)
    }
    expect(summarize(base.tasks, p)).toEqual(summarize(detailed.curriculum.tasks, p))
    expect(computeSkillLevels(base, p)).toEqual(computeSkillLevels(detailed.curriculum, p))
    const match = (c: typeof base) => {
      const { rows, ...summary } = computeVacancyMatch(c.vacancies[0], computeSkillLevels(c, p), buildIndex(c))
      return { ...summary, rows: rows.map(({ skill, ...row }) => ({ ...row, skillId: skill.id })) }
    }
    expect(match(base)).toEqual(match(detailed.curriculum))
  })
})
