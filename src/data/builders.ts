// Конструкторы записей программы. Общие для базовых файлов и пакетов контента (src/data/packs):
// пакет импортирует их отсюда, а не из базового файла, — так нет циклических импортов.
import type { InterviewQuestion, QuizQuestion, Resource, TaskDef } from '../types'

/** Вопрос теста или банка. notes — пояснения к неверным вариантам по порядку. */
export const quizQuestion = (id: string, text: string, options: string[], correct: number[], explanation: string, notes?: string[]): QuizQuestion => {
  let k = 0
  const optionNotes = notes ? options.map((_, i) => (correct.includes(i) ? '' : (notes[k++] ?? ''))) : undefined
  return { id, text, options, correct, explanation, ...(optionNotes ? { optionNotes } : {}) }
}

/** Вопрос «Своими словами»: тезисы, типичная ошибка и навыки роли, которые он проверяет. */
export const interviewQuestion = (id: string, text: string, points: string[], pitfall: string, skillIds?: string[]): InterviewQuestion => ({
  id,
  text,
  points,
  pitfall,
  ...(skillIds ? { skillIds } : {}),
})

/** Материал. language по умолчанию — en; официальный перевод — в поле ru того же ресурса. */
export const resource = (
  id: string,
  title: string,
  type: Resource['type'],
  url: string,
  note?: string,
  language: Resource['language'] = 'en',
): Resource => ({ id, title, type, url, language, ...(note ? { note } : {}) })

export type TaskInput = Omit<TaskDef, 'environmentDependency' | 'tags' | 'prerequisites' | 'resourceIds'> &
  Partial<Pick<TaskDef, 'environmentDependency' | 'tags' | 'prerequisites' | 'resourceIds'>>

/** Задача программы с пустыми значениями по умолчанию. */
export const task = (input: TaskInput): TaskDef => ({
  environmentDependency: false,
  tags: [],
  prerequisites: [],
  resourceIds: [],
  ...input,
})
