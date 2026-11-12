import type { CkaDomain, QuizQuestion } from '../../types'

/**
 * Вопрос банка повторения. notes — пояснения к НЕВЕРНЫМ вариантам по порядку их следования
 * (правильные варианты пропускаются): тренажёр показывает пояснение под выбранным неверным ответом.
 */
export function q(id: string, text: string, options: string[], correct: number[], explanation: string, notes?: string[]): QuizQuestion {
  let k = 0
  const optionNotes = notes ? options.map((_, i) => (correct.includes(i) ? '' : (notes[k++] ?? ''))) : undefined
  return { id, text, options, correct, explanation, ...(optionNotes ? { optionNotes } : {}) }
}

/** Вопрос по выводу терминала: коллега прислал вывод команд — что случилось? */
export function qo(id: string, text: string, output: string, options: string[], correct: number[], explanation: string, notes?: string[]): QuizQuestion {
  return { ...q(id, text, options, correct, explanation, notes), output }
}

/** Отметить домен CKA у вопросов банка по таблице id → домен (тест требует отметку у каждого вопроса банка «Kubernetes») */
export function withCka(questions: QuizQuestion[], domains: Record<string, CkaDomain>): QuizQuestion[] {
  return questions.map((x) => (domains[x.id] ? { ...x, cka: domains[x.id] } : x))
}
