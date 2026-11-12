export type LessonCode = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H' | 'I' | 'J'
export interface LessonSection {
  title: string
  rule: string
  choices: [string, string][]
  command: string
  scope?: string
  check: string
  mistakes: string[]
  taskIds: string[]
  incidentIds?: string[]
  exerciseIds?: string[]
  cheatsheetIds?: string[]
}
export interface TrackLesson {
  code: LessonCode
  trackId: string
  title: string
  minutes: number
  intro: string
  sections: LessonSection[]
}
/** Лёгкий каталог: полный текст загружается только при открытии конспекта. */
export const LESSON_CATALOG: { code: LessonCode; trackId: string; minutes: number }[] = [
  { code: 'A', trackId: 'python', minutes: 12 },
  { code: 'B', trackId: 'ml-lifecycle', minutes: 12 },
  { code: 'C', trackId: 'llm-serving', minutes: 15 },
  { code: 'D', trackId: 'observability', minutes: 12 },
  { code: 'E', trackId: 'rag', minutes: 12 },
  { code: 'F', trackId: 'llm-eval', minutes: 12 },
  { code: 'G', trackId: 'cicd', minutes: 12 },
  { code: 'H', trackId: 'gpu', minutes: 15 },
  { code: 'I', trackId: 'agents', minutes: 14 },
  { code: 'J', trackId: 'finetuning', minutes: 14 },
]
