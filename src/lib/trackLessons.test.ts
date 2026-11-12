import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { curriculum } from '../data'
import { cheatsheets } from '../data/cheatsheets'
import { LESSON_CATALOG } from '../data/trackLessonFormat'
import { trackLessons } from '../data/trackLessons'
import { TrackLesson } from '../components/TrackLesson'
import { StoreContext, type Store } from '../state/context'
import { createEmptyProgress } from './storage'
import { buildIndex, computeInterviewReadiness, computeSkillLevels, computeVacancyMatch, summarize } from './progress'

describe('track lessons A–J', () => {
  it('links every section to existing learning/practice and keeps the light catalog consistent', () => {
    expect(trackLessons.map((l) => l.code)).toEqual(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'])
    const exercises = curriculum.exercises.flatMap((s) => s.exercises)
    for (const lesson of trackLessons) {
      expect(LESSON_CATALOG.find((l) => l.code === lesson.code)).toEqual({ code: lesson.code, trackId: lesson.trackId, minutes: lesson.minutes })
      expect(curriculum.tracks.find((t) => t.id === lesson.trackId)?.code).toBe(lesson.code)
      expect(lesson.minutes).toBeGreaterThanOrEqual(10); expect(lesson.minutes).toBeLessThanOrEqual(15)
      expect(lesson.sections.length).toBeGreaterThanOrEqual(4)
      for (const s of lesson.sections) {
        expect(s.taskIds.length).toBeGreaterThan(0)
        for (const [ids, entities, kind] of [
          [s.taskIds, curriculum.tasks, 'задача'], [s.incidentIds ?? [], curriculum.incidents, 'инцидент'],
          [s.exerciseIds ?? [], exercises, 'упражнение'], [s.cheatsheetIds ?? [], cheatsheets, 'шпаргалка'],
        ] as const) for (const id of ids) expect(entities.some((e) => e.id === id), `${lesson.code}, ${s.title}: ${kind} ${id}`).toBe(true)
      }
    }
  })
  it('renders every lesson using read-only progress, with working reference text and copy controls', () => {
    const progress = createEmptyProgress(curriculum), idx = buildIndex(curriculum)
    const levels = computeSkillLevels(curriculum, progress), vacancy = curriculum.vacancies[0], stats = summarize(curriculum.tasks, progress)
    const store: Store = { curriculum, idx, progress, levels, vacancy, match: computeVacancyMatch(vacancy, levels, idx), learning: stats, labs: stats, tests: stats, interview: computeInterviewReadiness(curriculum, progress), saveError: false, dispatch: () => { throw new Error('Чтение не должно записывать прогресс') } }
    const before = JSON.stringify(progress)
    for (const lesson of trackLessons) {
      const html = renderToStaticMarkup(createElement(StoreContext.Provider, { value: store }, createElement(TrackLesson, { code: lesson.code })))
      expect(html).toContain(lesson.title)
      expect(html).toContain('Копировать')
      expect(html).not.toContain('undefined')
    }
    expect(JSON.stringify(progress)).toBe(before)
  })
})
