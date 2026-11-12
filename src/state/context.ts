import { createContext, useContext, type Dispatch } from 'react'
import type {
  CurriculumIndex,
  InterviewReadiness,
  ProgressSummary,
  SkillLevelInfo,
  VacancyMatch,
} from '../lib/progress'
import type { Curriculum, UserProgress, Vacancy } from '../types'
import type { Action } from './reducer'

export interface Store {
  curriculum: Curriculum
  idx: CurriculumIndex
  progress: UserProgress
  dispatch: Dispatch<Action>
  vacancy: Vacancy
  levels: Map<string, SkillLevelInfo>
  match: VacancyMatch
  learning: ProgressSummary
  labs: ProgressSummary
  tests: ProgressSummary
  interview: InterviewReadiness
  saveError: boolean
}

export const StoreContext = createContext<Store | null>(null)

export function useStore(): Store {
  const store = useContext(StoreContext)
  if (!store) throw new Error('useStore must be used inside <StoreProvider>')
  return store
}
