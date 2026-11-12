import { describe, expect, it } from 'vitest'
import { curriculum } from '../data'
import type { Exercise } from '../types'
import { archZone, exerciseLayout, exerciseSolution, initialAnswer, isComplete, isExerciseCorrect, matchOptions, moveStep } from './exercises'
import { todayReviews } from './today'
import { createEmptyProgress } from './storage'

const all = curriculum.exercises.flatMap((s) => s.exercises.map((e) => ({ set: s.id, e })))

describe('exercise sets', () => {
  it('use unique ids that do not collide with quiz and drill questions', () => {
    const ids = [...curriculum.quizzes.flatMap((q) => q.questions.map((x) => x.id)), ...curriculum.drills.flatMap((d) => d.questions.map((x) => x.id)), ...all.map((x) => x.e.id)]
    expect(new Set(ids).size).toBe(ids.length)
    for (const { set, e } of all) expect(e.id.startsWith(`${set}-`), e.id).toBe(true)
    expect(new Set(curriculum.exercises.map((s) => s.id)).size).toBe(curriculum.exercises.length)
  })

  it('have all four kinds, a task text and an explanation of why', () => {
    expect(new Set(all.map((x) => x.e.kind))).toEqual(new Set(['order', 'match', 'error', 'arch']))
    for (const { e } of all) {
      expect(e.text.trim().length, e.id).toBeGreaterThan(20)
      expect(e.explanation.trim().length, e.id).toBeGreaterThan(80)
    }
  })

  it('keep each format answerable in exactly one way', () => {
    for (const { e } of all) {
      if (e.kind === 'order') {
        expect(e.steps.length, e.id).toBeGreaterThanOrEqual(4)
        expect(e.steps.length, e.id).toBeLessThanOrEqual(8)
        expect(new Set(e.steps).size, `${e.id}: шаги не повторяются`).toBe(e.steps.length)
      }
      if (e.kind === 'match') {
        expect(e.pairs.length, e.id).toBeGreaterThanOrEqual(3)
        expect(new Set(e.pairs.map((p) => p[0])).size, e.id).toBe(e.pairs.length)
        // лишний вариант справа: последнюю пару нельзя угадать методом исключения
        expect(e.extra?.length ?? 0, `${e.id}: нужен лишний вариант`).toBeGreaterThan(0)
        expect(new Set(matchOptions(e)).size, `${e.id}: варианты справа не повторяются`).toBe(matchOptions(e).length)
      }
      if (e.kind === 'error') {
        expect(e.lines.length, e.id).toBeGreaterThanOrEqual(4)
        expect(e.errors.length, e.id).toBeGreaterThan(0)
        expect(e.errors.length, `${e.id}: ошибочны не все строки`).toBeLessThan(e.lines.length)
        expect(new Set(e.errors).size, e.id).toBe(e.errors.length)
        for (const i of e.errors) expect(e.lines[i]?.trim(), `${e.id}: строка ${i}`).toBeTruthy()
        for (const line of e.lines) expect(line.trim().length, `${e.id}: пустая строка`).toBeGreaterThan(0)
        expect(e.fix.trim().length, e.id).toBeGreaterThan(15)
      }
      if (e.kind === 'arch') {
        expect(e.zones.length, e.id).toBeGreaterThanOrEqual(2)
        expect(new Set(e.zones).size, e.id).toBe(e.zones.length)
        expect(new Set(e.blocks.map((b) => b.title)).size, e.id).toBe(e.blocks.length)
        expect(e.blocks.some((b) => b.zone === null), `${e.id}: нужны лишние блоки`).toBe(true)
        for (const b of e.blocks) {
          expect(b.title.trim().length, e.id).toBeGreaterThan(0)
          expect(b.note.trim().length, `${e.id}: разбор блока ${b.title}`).toBeGreaterThan(20)
          if (b.zone !== null) {
            expect(Number.isInteger(b.zone), e.id).toBe(true)
            expect(b.zone, e.id).toBeGreaterThanOrEqual(0)
            expect(b.zone, e.id).toBeLessThan(e.zones.length)
          }
        }
        for (let i = 0; i < e.zones.length; i++) expect(e.blocks.some((b) => b.zone === i), `${e.id}: пустой слой`).toBe(true)
        // схема помещается на экран и решается рассуждением, а не перебором
        expect(e.zones.length, e.id).toBeLessThanOrEqual(5)
        expect(e.blocks.length, e.id).toBeGreaterThanOrEqual(8)
        expect(e.blocks.length, e.id).toBeLessThanOrEqual(14)
        const extra = e.blocks.filter((b) => b.zone === null)
        expect(extra.length, `${e.id}: 2–4 лишних блока`).toBeGreaterThanOrEqual(2)
        expect(extra.length, `${e.id}: 2–4 лишних блока`).toBeLessThanOrEqual(4)
        // лишний блок не выдаёт себя длиной названия
        const avg = (xs: { title: string }[]) => xs.reduce((n, b) => n + b.title.length, 0) / xs.length
        const ratio = avg(extra) / avg(e.blocks.filter((b) => b.zone !== null))
        expect(ratio, `${e.id}: длина названий лишних блоков`).toBeGreaterThan(0.75)
        expect(ratio, `${e.id}: длина названий лишних блоков`).toBeLessThan(1.3)
      }
    }
  })
})

const order: Exercise = { kind: 'order', id: 't-order', text: '', steps: ['a', 'b', 'c', 'd'], explanation: '' }
const match: Exercise = { kind: 'match', id: 't-match', text: '', pairs: [['1', 'one'], ['2', 'two'], ['3', 'three']], extra: ['four'], explanation: '' }
const err: Exercise = { kind: 'error', id: 't-error', text: '', lines: ['a', 'b', 'c', 'd'], errors: [1, 3], fix: '', explanation: '' }
const arch: Extract<Exercise, { kind: 'arch' }> = {
  kind: 'arch', id: 't-arch', text: '', zones: ['Вход', 'Модель'],
  blocks: [{ title: 'Квоты', zone: 0, note: '' }, { title: 'Serving', zone: 1, note: '' }, { title: 'Лишнее', zone: null, note: '' }], explanation: '',
}

describe('exercise answers', () => {
  it('waits for every architectural block, including the distractor', () => {
    expect(isComplete(initialAnswer(arch))).toBe(false)
    expect(isComplete({ kind: 'arch', picks: [0, 1, -1] })).toBe(false)
    expect(isComplete({ kind: 'arch', picks: [0, 1, 2] })).toBe(true)
  })

  it('rejects a missing, misplaced or retained distractor block', () => {
    expect(isExerciseCorrect(arch, { kind: 'arch', picks: [0, 1, 2] })).toBe(true)
    for (const picks of [[0, 1], [1, 0, 2], [0, 1, 0], [0, 1, 3]]) expect(isExerciseCorrect(arch, { kind: 'arch', picks })).toBe(false)
    expect(isExerciseCorrect(arch, { kind: 'match', picks: [0, 1, 2] })).toBe(false)
    expect(archZone(arch, 2)).toBe(arch.zones.length)
    expect(exerciseSolution(arch)).toContain('лишнее: Лишнее')
  })

  it('shuffles architectural blocks without moving their answer keys', () => {
    const before = JSON.stringify(arch)
    const layout = exerciseLayout(arch, () => 0)
    expect([...layout].sort()).toEqual([0, 1, 2])
    expect(layout).not.toEqual([0, 1, 2])
    expect(JSON.stringify(arch)).toBe(before)
    expect(exerciseLayout(match, () => 0)).toHaveLength(4)
  })

  it('never starts an ordering exercise already solved', () => {
    const identity = () => 0.999 // shuffle с таким rnd оставляет порядок как есть
    const a = initialAnswer(order, identity)
    expect(a.kind === 'order' && a.order).not.toEqual([0, 1, 2, 3])
    expect(isExerciseCorrect(order, a)).toBe(false)
  })

  it('accepts only the exact order', () => {
    expect(isExerciseCorrect(order, { kind: 'order', order: [0, 1, 2, 3] })).toBe(true)
    expect(isExerciseCorrect(order, { kind: 'order', order: [0, 2, 1, 3] })).toBe(false)
    expect(moveStep([0, 1, 2], 0, -1)).toEqual([0, 1, 2])
    expect(moveStep([0, 1, 2], 0, 1)).toEqual([1, 0, 2])
    expect(moveStep([0, 1, 2], 2, 1)).toEqual([0, 1, 2])
  })

  it('counts a match only when every pair is right, and waits until all are picked', () => {
    const start = initialAnswer(match)
    expect(isComplete(start)).toBe(false)
    expect(isExerciseCorrect(match, { kind: 'match', picks: [0, 1, 2] })).toBe(true)
    expect(isExerciseCorrect(match, { kind: 'match', picks: [0, 1, 3] })).toBe(false)
    expect(isComplete({ kind: 'match', picks: [0, 1, 3] })).toBe(true)
  })

  it('needs exactly the wrong lines: missing or extra lines are a mistake', () => {
    expect(isComplete(initialAnswer(err))).toBe(false)
    expect(isExerciseCorrect(err, { kind: 'error', lines: [3, 1] })).toBe(true)
    expect(isExerciseCorrect(err, { kind: 'error', lines: [1] })).toBe(false)
    expect(isExerciseCorrect(err, { kind: 'error', lines: [1, 2, 3] })).toBe(false)
    expect(exerciseSolution(err)).toContain('строка 2')
  })

  it('brings exercises due for review into the «Today» counter', () => {
    const p = createEmptyProgress(curriculum)
    const id = all[0].e.id
    const before = todayReviews(curriculum, p, Date.now()).practice
    const withMistake = { ...p, practice: { [id]: { seen: 1, correct: 0, streak: 0, lastCorrect: false, lastAt: new Date().toISOString() } } }
    expect(todayReviews(curriculum, withMistake, Date.now()).practice).toBe(before + 1)
  })
})
