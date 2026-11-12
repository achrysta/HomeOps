import type { Curriculum } from '../types'
import { tasks, tracks } from './curriculum'
import { drills } from './drills'
import { exerciseSets } from './exercises'
import { gyms } from './gyms'
import { incidents } from './incidents'
import { interviewTopics } from './interview'
import { labSteps } from './labSteps'
import { quizzes } from './quizzes'
import { resources } from './resources'
import { designAspects, designCases } from './systemDesign'
import { skills, vacancies } from './skills'

/** Увеличивайте при изменении seed-данных. Сохраняется в user progress для диагностики. */
export const CURRICULUM_VERSION = '2026.11.12.6'

export const curriculum: Curriculum = {
  version: CURRICULUM_VERSION,
  skills,
  tracks: [...tracks].sort((a, b) => a.order - b.order),
  tasks: tasks.map((t) => (labSteps[t.id] ? { ...t, steps: labSteps[t.id] } : t)),
  resources,
  interviewTopics,
  designAspects,
  designCases,
  vacancies,
  quizzes,
  drills,
  exercises: exerciseSets,
  gyms,
  incidents,
}
