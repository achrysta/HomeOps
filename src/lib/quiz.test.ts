import { describe, expect, it } from 'vitest'
import { FINAL_EXAM_PER_TRACK, MAX_QUIZ_ATTEMPTS, QUIZ_PASS_THRESHOLD } from '../config/weights'
import { curriculum } from '../data'
import { DRILL_AREAS } from '../data/drills'
import { reducer } from '../state/reducer'
import { CKA_DOMAIN_ORDER } from './incidents'
import { buildIndex, getAvailability, getVerification, summarize, coreTasks } from './progress'
import type { PracticeStat } from '../types'
import { isCorrect, isDue, isMastered, pickPracticeQuestions, practiceWeight, reviewDueAt, sampleFinalExam, scoreAttempt, shuffle } from './quiz'
import { createEmptyProgress, normalizeProgress } from './storage'

const idx = buildIndex(curriculum)

describe('quiz content', () => {
  it('has exactly one quiz per quiz task and per core track', () => {
    const quizTasks = curriculum.tasks.filter((t) => t.kind === 'quiz')
    expect(quizTasks.map((t) => t.id).sort()).toEqual(curriculum.quizzes.map((q) => q.id).sort())
    for (const quiz of curriculum.quizzes) {
      expect(idx.taskById.get(quiz.id)?.trackId, quiz.id).toBe(quiz.trackId)
    }
    const coreTracks = curriculum.tracks.filter((t) => t.kind === 'core').map((t) => t.id).sort()
    expect(curriculum.quizzes.map((q) => q.trackId).sort()).toEqual(coreTracks)
  })

  it('marks a CKA domain on every Kubernetes drill question, with every domain trainable', () => {
    const bank = curriculum.drills.find((d) => d.id === 'dv-k8s')!
    for (const question of bank.questions) expect(CKA_DOMAIN_ORDER, question.id).toContain(question.cka)
    for (const domain of CKA_DOMAIN_ORDER) expect(bank.questions.filter((x) => x.cka === domain).length, domain).toBeGreaterThanOrEqual(4)
    // домен — только у банка Kubernetes: в других темах фильтр по доменам не показывается
    expect(curriculum.drills.filter((d) => d.id !== bank.id).flatMap((d) => d.questions).filter((x) => x.cka)).toEqual([])
  })

  it('has well-formed drill banks with ids unique across all questions', () => {
    const ids = [...curriculum.quizzes.flatMap((q) => q.questions.map((x) => x.id)), ...curriculum.drills.flatMap((d) => d.questions.map((x) => x.id))]
    expect(new Set(ids).size).toBe(ids.length)
    expect(new Set(curriculum.drills.map((d) => d.id)).size).toBe(curriculum.drills.length)
    for (const drill of curriculum.drills) {
      // в каждой теме не меньше 40 вопросов: тренировать конкретный инструмент должно быть на чём
      expect(drill.questions.length, drill.id).toBeGreaterThanOrEqual(40)
      expect(DRILL_AREAS.map((a) => a.id), drill.id).toContain(drill.area)
      for (const question of drill.questions) {
        expect(question.id.startsWith(`${drill.id}-`), question.id).toBe(true)
        expect(question.options.length, question.id).toBeGreaterThanOrEqual(3)
        expect(new Set(question.options).size, question.id).toBe(question.options.length)
        expect(question.correct.length, question.id).toBeGreaterThan(0)
        expect(question.correct.length, question.id).toBeLessThan(question.options.length)
        for (const c of question.correct) expect(c >= 0 && c < question.options.length, question.id).toBe(true)
        expect(question.explanation.length, question.id).toBeGreaterThan(30)
        // разбор ошибок: пояснение у каждого неверного варианта, у правильных — пусто
        expect(question.optionNotes?.length, `${question.id}: optionNotes`).toBe(question.options.length)
        question.optionNotes!.forEach((note, i) =>
          expect(question.correct.includes(i) ? note === '' : note.length > 20, `${question.id}: пояснение к варианту ${i}`).toBe(true),
        )
      }
    }
  })

  it('has well-formed questions', () => {
    const ids = curriculum.quizzes.flatMap((q) => q.questions.map((x) => x.id))
    expect(new Set(ids).size).toBe(ids.length)
    for (const quiz of curriculum.quizzes) {
      expect(quiz.questions.length, quiz.id).toBeGreaterThanOrEqual(10)
      for (const question of quiz.questions) {
        expect(question.options.length, question.id).toBeGreaterThanOrEqual(3)
        expect(new Set(question.options).size, question.id).toBe(question.options.length)
        expect(question.correct.length, question.id).toBeGreaterThan(0)
        expect(new Set(question.correct).size, question.id).toBe(question.correct.length)
        for (const c of question.correct) expect(c >= 0 && c < question.options.length, question.id).toBe(true)
        expect(question.explanation.length, question.id).toBeGreaterThan(30)
      }
    }
  })

  it.each(curriculum.quizzes)('$id explains every incorrect option in its track', (quiz) => {
    for (const question of quiz.questions) {
      expect(question.optionNotes?.length, `${question.id}: optionNotes`).toBe(question.options.length)
      question.options.forEach((_, i) => {
        const note = question.optionNotes?.[i] ?? ''
        expect(question.correct.includes(i) ? note === '' : note.trim().length > 20, `${question.id}: пояснение к варианту ${i}`).toBe(true)
      })
    }
  })

  it.each([
    ['контрольные тесты', curriculum.quizzes.flatMap((qz) => qz.questions)],
    ['банки повторения', curriculum.drills.flatMap((d) => d.questions)],
  ])('does not give away the answer by option length: %s', (_name, questions) => {
    // Правильный ответ не должен узнаваться по длине: ни заметно длиннее неверных,
    // ни систематически самым длинным или самым коротким.
    const single = questions.filter((x) => x.correct.length === 1)
    let longest = 0
    let shortest = 0
    for (const question of single) {
      const c = question.options[question.correct[0]].length
      const d = question.options.filter((_, i) => i !== question.correct[0]).map((o) => o.length)
      expect(c, `${question.id}: правильный ответ заметно длиннее неверных`).toBeLessThanOrEqual(1.3 * Math.max(...d))
      if (c > Math.max(...d)) longest++
      if (c < Math.min(...d)) shortest++
    }
    expect(longest / single.length, 'правильный ответ слишком часто самый длинный').toBeLessThanOrEqual(0.35)
    expect(shortest / single.length, 'правильный ответ слишком часто самый короткий').toBeLessThanOrEqual(0.35)
  })

  it('has no throwaway distractors', () => {
    const weak = /^(ничем|это одно и то же|это не важно|не нужно|никогда|ничего|никак|не знаю|все варианты верны)\.?$/i
    for (const question of [...curriculum.quizzes.flatMap((qz) => qz.questions), ...curriculum.drills.flatMap((d) => d.questions)]) {
      for (const option of question.options) expect(weak.test(option.trim()), `${question.id}: «${option}»`).toBe(false)
    }
  })

  it('keeps "select all" questions honest — at least one option is wrong', () => {
    for (const question of curriculum.quizzes.flatMap((qz) => qz.questions)) {
      expect(question.correct.length, question.id).toBeLessThan(question.options.length)
    }
  })

  it('gates the key lab of every core track behind its quiz', () => {
    for (const quiz of curriculum.quizzes) {
      expect(idx.dependents.get(quiz.id)?.length ?? 0, quiz.id).toBeGreaterThan(0)
    }
  })
})

describe('quiz logic', () => {
  const q = { id: 'x', text: '', options: ['a', 'b', 'c', 'd'], correct: [0, 2], explanation: '' }

  it('requires the exact set of correct options', () => {
    expect(isCorrect(q, [2, 0])).toBe(true)
    expect(isCorrect(q, [0])).toBe(false)
    expect(isCorrect(q, [0, 1, 2])).toBe(false)
    expect(isCorrect(q, undefined)).toBe(false)
  })

  it('applies the pass threshold', () => {
    const quiz = curriculum.quizzes[0]
    const all = Object.fromEntries(quiz.questions.map((x) => [x.id, x.correct]))
    expect(scoreAttempt(quiz.questions, all, QUIZ_PASS_THRESHOLD)).toMatchObject({ correct: quiz.questions.length, passed: true })
    const wrongCount = Math.floor(quiz.questions.length * (1 - QUIZ_PASS_THRESHOLD)) + 1
    const someWrong = { ...all }
    for (const question of quiz.questions.slice(0, wrongCount)) someWrong[question.id] = []
    const res = scoreAttempt(quiz.questions, someWrong, QUIZ_PASS_THRESHOLD)
    expect(res.passed).toBe(false)
    expect(res.wrongIds).toHaveLength(wrongCount)
  })

  it('shuffles without losing items', () => {
    const items = [1, 2, 3, 4, 5, 6]
    expect(shuffle(items).sort()).toEqual(items)
  })

  it('samples the final exam evenly across tracks', () => {
    const exam = sampleFinalExam(curriculum.quizzes, FINAL_EXAM_PER_TRACK)
    expect(exam).toHaveLength(curriculum.quizzes.length * FINAL_EXAM_PER_TRACK)
    expect(new Set(exam.map((x) => x.id)).size).toBe(exam.length)
    for (const quiz of curriculum.quizzes) {
      expect(exam.filter((x) => quiz.questions.includes(x))).toHaveLength(FINAL_EXAM_PER_TRACK)
    }
  })
})

describe('quiz attempts cannot be passed by a flag', () => {
  const quiz = curriculum.tasks.find((t) => t.id === 'AQ')!

  it('recomputes «passed» from the score of a file or import, not the stored flag', () => {
    const raw = { tasks: { AQ: { status: 'completed', quizAttempts: [{ id: 'x', at: '2026-10-09T10:00:00Z', correct: 1, total: 20, passed: true, wrongIds: [] }] } } }
    const p = normalizeProgress(raw, curriculum)
    expect(p.tasks.AQ.quizAttempts?.[0].passed).toBe(false)
    expect(getVerification(quiz, p.tasks.AQ)).toBe('open')
  })

  it('counts only a full-size attempt, and the reducer ignores a passed flag from the UI', () => {
    const short = normalizeProgress({ tasks: { AQ: { quizAttempts: [{ id: 'y', at: '2026-10-09T10:00:00Z', correct: 1, total: 1, passed: true, wrongIds: [] }] } } }, curriculum)
    expect(getVerification(quiz, short.tasks.AQ)).toBe('open')
    const p = reducer(createEmptyProgress(curriculum), { type: 'quiz/attempt', id: 'AQ', attempt: { correct: 3, total: 20, passed: true, wrongIds: [] } })
    expect(p.tasks.AQ.quizAttempts?.[0].passed).toBe(false)
    expect(getVerification(quiz, p.tasks.AQ)).toBe('open')
  })
})

describe('quiz tasks in progress', () => {
  const quizTask = idx.taskById.get('AQ')!

  it('is verified only by a passed attempt, not by manual status', () => {
    let p = reducer(createEmptyProgress(curriculum), { type: 'task/status', id: 'AQ', status: 'completed' })
    expect(getVerification(quizTask, p.tasks.AQ)).toBe('open')

    p = reducer(p, { type: 'quiz/attempt', id: 'AQ', attempt: { correct: 10, total: 20, passed: false, wrongIds: [] } })
    expect(getVerification(quizTask, p.tasks.AQ)).toBe('open')

    p = reducer(p, { type: 'quiz/attempt', id: 'AQ', attempt: { correct: 18, total: 20, passed: true, wrongIds: ['aq-1'] } })
    expect(getVerification(quizTask, p.tasks.AQ)).toBe('verified')
    expect(p.tasks.AQ.status).toBe('completed')
    expect(p.tasks.AQ.quizAttempts).toHaveLength(2)
  })

  it('moves a failed first attempt to In Progress and keeps a pass after later failures', () => {
    let p = reducer(createEmptyProgress(curriculum), { type: 'quiz/attempt', id: 'BQ', attempt: { correct: 6, total: 20, passed: false, wrongIds: [] } })
    expect(p.tasks.BQ.status).toBe('in_progress')
    p = reducer(p, { type: 'quiz/attempt', id: 'BQ', attempt: { correct: 18, total: 20, passed: true, wrongIds: [] } })
    p = reducer(p, { type: 'quiz/attempt', id: 'BQ', attempt: { correct: 4, total: 20, passed: false, wrongIds: [] } })
    expect(p.tasks.BQ.status).toBe('completed')
    expect(getVerification(idx.taskById.get('BQ')!, p.tasks.BQ)).toBe('verified')
  })

  it('unlocks the gated lab and counts toward learning progress', () => {
    const core = coreTasks(curriculum, idx)
    let p = createEmptyProgress(curriculum)
    const before = summarize(core, p).earned
    p = reducer(p, { type: 'quiz/attempt', id: 'AQ', attempt: { correct: 20, total: 20, passed: true, wrongIds: [] } })
    expect(summarize(core, p).earned - before).toBe(2)
    // A4 всё ещё ждёт A3, но AQ больше не в списке недостающих
    expect(getAvailability(idx.taskById.get('A4')!, idx, p)).toBe('locked')
  })
})

describe('trainer', () => {
  const pool = curriculum.quizzes[0].questions
  const seeded = (seed: number) => () => {
    seed = (seed * 16807) % 2147483647
    return (seed - 1) / 2147483646
  }

  it('records practice stats with streaks', () => {
    let p = createEmptyProgress(curriculum)
    p = reducer(p, { type: 'practice/record', results: [{ questionId: 'aq-1', correct: true }, { questionId: 'aq-2', correct: false }] })
    p = reducer(p, { type: 'practice/record', results: [{ questionId: 'aq-1', correct: true }] })
    expect(p.practice['aq-1']).toMatchObject({ seen: 2, correct: 2, streak: 2, lastCorrect: true })
    expect(p.practice['aq-2']).toMatchObject({ seen: 1, correct: 0, streak: 0, lastCorrect: false })
    const now = Date.parse(p.practice['aq-1'].lastAt)
    expect(isMastered(p.practice['aq-1'], now)).toBe(true)
    expect(isMastered(p.practice['aq-2'], now)).toBe(false)
  })

  it('serves only last mistakes in mistakes mode', () => {
    const stats = {
      [pool[0].id]: { seen: 1, correct: 0, streak: 0, lastCorrect: false, lastAt: '' },
      [pool[1].id]: { seen: 3, correct: 3, streak: 3, lastCorrect: true, lastAt: '' },
    }
    expect(pickPracticeQuestions(pool, stats, 'mistakes', 10, Date.now()).map((q) => q.id)).toEqual([pool[0].id])
  })

  it('prefers mistakes and new questions over recently mastered ones in smart mode', () => {
    const now = Date.parse('2026-10-07T12:00:00Z')
    const recent = new Date(now - 3_600_000).toISOString()
    const stats: Record<string, PracticeStat> = {}
    for (const q of pool.slice(0, 6)) stats[q.id] = { seen: 5, correct: 5, streak: 5, lastCorrect: true, lastAt: recent }
    stats[pool[6].id] = { seen: 2, correct: 1, streak: 0, lastCorrect: false, lastAt: recent }
    const counts = new Map<string, number>()
    const rnd = seeded(42)
    for (let i = 0; i < 300; i++) {
      for (const q of pickPracticeQuestions(pool, stats, 'smart', 3, now, rnd)) counts.set(q.id, (counts.get(q.id) ?? 0) + 1)
    }
    const mastered = pool.slice(0, 6).reduce((a, q) => a + (counts.get(q.id) ?? 0), 0) / 6
    expect(counts.get(pool[6].id)!).toBeGreaterThan(mastered * 5)
    const picked = pickPracticeQuestions(pool, stats, 'smart', pool.length, now, rnd)
    expect(new Set(picked.map((q) => q.id)).size).toBe(pool.length)
  })

  it('schedules reviews by streak and brings mastered questions back when due', () => {
    const at = '2026-10-01T10:00:00.000Z'
    const t = Date.parse(at)
    const day = 86_400_000
    const stat = (streak: number, lastCorrect = true): PracticeStat => ({ seen: streak + 1, correct: streak, streak, lastCorrect, lastAt: at })
    expect(reviewDueAt(undefined)).toBeNull()
    expect(reviewDueAt(stat(0, false))).toBe(t) // ошибка — повторить сразу
    expect(reviewDueAt(stat(1))).toBe(t + day)
    expect(reviewDueAt(stat(2))).toBe(t + 3 * day)
    expect(reviewDueAt(stat(9))).toBe(t + 30 * day) // потолок интервала
    // освоен, пока срок не наступил; после — снова к повторению
    expect(isMastered(stat(2), t + 2 * day)).toBe(true)
    expect(isMastered(stat(2), t + 3 * day)).toBe(false)
    expect(isDue(stat(2), t + 3 * day)).toBe(true)
    // просроченный вопрос весит больше, чем вопрос с ненаступившим сроком, но меньше-равно ошибки
    expect(practiceWeight(stat(3), t + 10 * day)).toBeGreaterThan(practiceWeight(stat(3), t + day))
    expect(practiceWeight(stat(3), t + 100 * day)).toBeLessThanOrEqual(practiceWeight(stat(0, false), t))
  })

  it('serves due questions, most overdue first, in due mode', () => {
    const now = Date.parse('2026-10-20T00:00:00Z')
    const stats: Record<string, PracticeStat> = {
      [pool[0].id]: { seen: 3, correct: 3, streak: 3, lastCorrect: true, lastAt: '2026-10-01T00:00:00Z' }, // срок 8 окт
      [pool[1].id]: { seen: 2, correct: 2, streak: 2, lastCorrect: true, lastAt: '2026-10-19T00:00:00Z' }, // срок 22 окт — ещё не пора
      [pool[2].id]: { seen: 1, correct: 0, streak: 0, lastCorrect: false, lastAt: '2026-10-15T00:00:00Z' }, // ошибка 15 окт
    }
    expect(pickPracticeQuestions(pool, stats, 'due', 10, now).map((q) => q.id)).toEqual([pool[0].id, pool[2].id])
  })
})

describe('quiz attempt history', () => {
  it('keeps a passed attempt after many failed retakes', () => {
    const quiz = curriculum.tasks.find((t) => t.kind === 'quiz')!
    let p = reducer(createEmptyProgress(curriculum), { type: 'quiz/attempt', id: quiz.id, attempt: { correct: 18, total: 20, passed: true, wrongIds: [] } })
    for (let i = 0; i < MAX_QUIZ_ATTEMPTS + 5; i++) {
      p = reducer(p, { type: 'quiz/attempt', id: quiz.id, attempt: { correct: 5, total: 20, passed: false, wrongIds: [] } })
    }
    const attempts = p.tasks[quiz.id].quizAttempts!
    expect(attempts).toHaveLength(MAX_QUIZ_ATTEMPTS)
    expect(attempts[0].passed).toBe(true)
    expect(getVerification(quiz, p.tasks[quiz.id])).toBe('verified')
  })

  it('keeps a passed final exam the same way', () => {
    let p = reducer(createEmptyProgress(curriculum), { type: 'exam/attempt', attempt: { correct: 22, total: 24, passed: true, wrongIds: [] } })
    for (let i = 0; i < MAX_QUIZ_ATTEMPTS; i++) p = reducer(p, { type: 'exam/attempt', attempt: { correct: 3, total: 24, passed: false, wrongIds: [] } })
    expect(p.finalExam).toHaveLength(MAX_QUIZ_ATTEMPTS)
    expect(p.finalExam.some((a) => a.passed)).toBe(true)
  })
})
