// Упражнения тренажёра: упорядочить шаги, сопоставить пары, найти строку с ошибкой, собрать архитектуру. Без React.
// Засчитывается только полностью верный ответ — частично верный считается ошибкой, как и в тестах.

import type { Exercise } from '../types'
import { shuffle } from './quiz'

/**
 * Ответ: order — индексы шагов в выбранном порядке; match — для каждой левой части индекс правой (или -1);
 * error — выбранные строки; arch — для каждого блока слой (индекс в zones), zones.length — «не нужен», -1 — не выбрано.
 */
export type ExerciseAnswer = { kind: 'order'; order: number[] } | { kind: 'match'; picks: number[] } | { kind: 'error'; lines: number[] } | { kind: 'arch'; picks: number[] }

/** Правая колонка сопоставления: верные ответы (индексы 0..n-1) и лишние (n..). */
export const matchOptions = (ex: Extract<Exercise, { kind: 'match' }>): string[] => [...ex.pairs.map((p) => p[1]), ...(ex.extra ?? [])]

/** Варианты сопоставления и блоки архитектуры перемешаны: их порядок не раскрывает ответ. */
export function exerciseLayout(ex: Exercise, rnd: () => number = Math.random): number[] {
  if (ex.kind === 'match') return shuffle(matchOptions(ex).map((_, i) => i), rnd)
  if (ex.kind === 'arch') return shuffle(ex.blocks.map((_, i) => i), rnd)
  return []
}

/** Начальное состояние ответа. Шаги перемешаны так, чтобы порядок не совпадал с правильным. */
export function initialAnswer(ex: Exercise, rnd: () => number = Math.random): ExerciseAnswer {
  if (ex.kind === 'order') {
    const ids = ex.steps.map((_, i) => i)
    let order = shuffle(ids, rnd)
    for (let i = 0; i < 5 && order.every((x, j) => x === j); i++) order = shuffle(ids, rnd)
    if (order.every((x, j) => x === j)) order = [...ids.slice(1), ids[0]]
    return { kind: 'order', order }
  }
  if (ex.kind === 'match') return { kind: 'match', picks: ex.pairs.map(() => -1) }
  if (ex.kind === 'arch') return { kind: 'arch', picks: ex.blocks.map(() => -1) }
  return { kind: 'error', lines: [] }
}

/** Ответ готов к проверке: выбраны все пары/слои, в поиске ошибки — хотя бы одна строка. */
export function isComplete(a: ExerciseAnswer): boolean {
  if (a.kind === 'match' || a.kind === 'arch') return a.picks.every((x) => x >= 0)
  if (a.kind === 'error') return a.lines.length > 0
  return true
}

export function isExerciseCorrect(ex: Exercise, a: ExerciseAnswer): boolean {
  if (ex.kind === 'order' && a.kind === 'order') return a.order.length === ex.steps.length && a.order.every((x, i) => x === i)
  if (ex.kind === 'match' && a.kind === 'match') return a.picks.length === ex.pairs.length && a.picks.every((x, i) => x === i)
  if (ex.kind === 'error' && a.kind === 'error') return a.lines.length === ex.errors.length && ex.errors.every((i) => a.lines.includes(i))
  if (ex.kind === 'arch' && a.kind === 'arch') return a.picks.length === ex.blocks.length && ex.blocks.every((_, i) => a.picks[i] === archZone(ex, i))
  return false
}

/** Правильный выбор для блока архитектуры: индекс слоя или zones.length («не нужен»). */
export const archZone = (ex: Extract<Exercise, { kind: 'arch' }>, block: number): number => ex.blocks[block].zone ?? ex.zones.length

/** Переставить шаг на одну позицию вверх (-1) или вниз (+1). */
export function moveStep(order: readonly number[], pos: number, dir: -1 | 1): number[] {
  const to = pos + dir
  if (to < 0 || to >= order.length) return [...order]
  const next = [...order]
  ;[next[pos], next[to]] = [next[to], next[pos]]
  return next
}

/** Правильный ответ текстом — для разбора ошибок в итогах сессии. */
export function exerciseSolution(ex: Exercise): string {
  if (ex.kind === 'order') return ex.steps.map((s, i) => `${i + 1}. ${s}`).join(' → ')
  if (ex.kind === 'match') return ex.pairs.map(([l, r]) => `${l} — ${r}`).join('; ')
  if (ex.kind === 'arch')
    return [
      ...ex.zones.map((z, i) => `${z}: ${ex.blocks.filter((b) => b.zone === i).map((b) => b.title).join(', ')}`),
      `лишнее: ${ex.blocks.filter((b) => b.zone === null).map((b) => b.title).join(', ')}`,
    ].join(' · ')
  return `${ex.errors.map((i) => `строка ${i + 1}: ${ex.lines[i].trim()}`).join('; ')}. Как правильно: ${ex.fix}`
}

export const EXERCISE_KIND_LABEL: Record<Exercise['kind'], string> = { order: 'Упорядочь', match: 'Сопоставь', error: 'Найди ошибку', arch: 'Собери архитектуру' }
