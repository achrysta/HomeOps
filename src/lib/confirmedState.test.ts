import { describe, expect, it } from 'vitest'
import { FINAL_EXAM_PER_TRACK } from '../config/weights'
import { curriculum } from '../data'
import { confirmedExam, confirmedGym, confirmedIncident, confirmedReps, confirmedTask, completedTrack } from './confirmedState'
import { finishGym, solveIncident, TEST_AT, TEST_NOW, testProgress, verifyTask } from './confirmedState.fixtures'

describe('confirmed state for read-only summaries', () => {
  it('requires criteria and actual evidence for practice, and a passing score for quizzes', () => {
    const p = testProgress()
    const lab = curriculum.tasks.find((t) => t.kind === 'lab')!
    verifyTask(p, lab)
    expect(confirmedTask(lab, p)).toBe(true)
    p.tasks[lab.id].criteriaDone = []
    expect(confirmedTask(lab, p)).toBe(false)
    p.tasks[lab.id].criteriaDone = [...lab.acceptanceCriteria]
    p.tasks[lab.id].evidence[0].value = '  '
    expect(confirmedTask(lab, p)).toBe(false)
    const quiz = curriculum.tasks.find((t) => t.kind === 'quiz')!
    verifyTask(p, quiz)
    expect(confirmedTask(quiz, p)).toBe(true)
    p.tasks[quiz.id].quizAttempts![0].passed = false
    expect(confirmedTask(quiz, p)).toBe(true)
    p.tasks[quiz.id].quizAttempts![0].correct = 1
    expect(confirmedTask(quiz, p)).toBe(false)
    p.tasks[quiz.id].quizAttempts![0] = { id: 'short', at: TEST_AT, total: 1, correct: 1, passed: true, wrongIds: [] }
    expect(confirmedTask(quiz, p)).toBe(false)
    p.tasks[quiz.id].quizAttempts = []
    expect(confirmedTask(quiz, p)).toBe(false)
  })

  it('completes a track only by all mandatory tasks, independently of filters and optional tasks', () => {
    const p = testProgress()
    const track = curriculum.tracks.find((t) => t.id === 'llm-serving')!
    const required = curriculum.tasks.filter((t) => t.trackId === track.id && !t.optional)
    for (const task of required) verifyTask(p, task)
    expect(completedTrack(track, curriculum, p)).toBe(true)
    const env = required.find((t) => t.environmentDependency)!
    p.tasks[env.id].status = 'blocked'
    expect(completedTrack(track, curriculum, p)).toBe(false)
    verifyTask(p, env)
    expect(completedTrack(track, curriculum, p)).toBe(true)
    p.tasks[required.find((t) => t.kind === 'quiz')!.id].quizAttempts = []
    expect(completedTrack(track, curriculum, p)).toBe(false)
    expect(completedTrack({ ...track, id: 'unknown' }, curriculum, p)).toBe(false)
    expect(completedTrack(track, { ...curriculum, tasks: required.map((t) => ({ ...t, optional: true })) }, p)).toBe(false)
  })

  it('checks incident reports against current checks and reset date, disregarding flags', () => {
    const p = testProgress()
    const d = curriculum.incidents[0]
    solveIncident(p, d)
    expect(confirmedIncident(d, p, TEST_NOW)?.independent).toBe(true)
    p.incidents[d.id].reports[0].passed = false
    expect(confirmedIncident(d, p, TEST_NOW)?.independent).toBe(true)
    const changed = { ...d, checks: [...d.checks, { id: 'new-check', title: 'Новая проверка' }] }
    expect(confirmedIncident(changed, p, TEST_NOW)).toBe(null)
    p.incidents[d.id].reports[0].checks[0].ok = false
    p.incidents[d.id].reports[0].passed = true
    expect(confirmedIncident(d, p, TEST_NOW)).toBe(null)
    solveIncident(p, d)
    p.meta.createdAt = '2026-10-09T00:00:00.000Z'
    expect(confirmedIncident(d, p, TEST_NOW)).toBe(null)
    p.meta.createdAt = '2026-01-01T00:00:00.000Z'
    p.incidents[d.id].reports[0].at = '2026-10-10T00:00:00.000Z'
    expect(confirmedIncident(d, p, TEST_NOW)).toBe(null)
    p.incidents[d.id].reports = []
    expect(confirmedIncident(d, p, TEST_NOW)).toBe(null)
  })

  it('uses first actual passing report for the debrief boundary', () => {
    const p = testProgress()
    const d = curriculum.incidents[0]
    solveIncident(p, d)
    p.incidents[d.id].debriefOpenedAt = '2026-10-08T11:59:00.000Z'
    expect(confirmedIncident(d, p, TEST_NOW)?.independent).toBe(false)
    p.incidents[d.id].debriefOpenedAt = '2026-10-08T12:01:00.000Z'
    p.incidents[d.id].solvedAt = '2026-10-09T00:00:00.000Z'
    expect(confirmedIncident(d, p, TEST_NOW)?.independent).toBe(true)
    p.incidents[d.id].debriefOpenedAt = 'bad-date'
    expect(confirmedIncident(d, p, TEST_NOW)?.independent).toBe(false)
  })

  it('requires a complete dated gym session in the order of the current reps', () => {
    const p = testProgress()
    const d = curriculum.gyms[0]
    finishGym(p, d)
    expect(confirmedGym(d, p, TEST_NOW)).toBe(true)
    const s = p.gyms[d.id].sessions[0]
    delete s.finishedAt
    expect(confirmedGym(d, p, TEST_NOW)).toBe(false)
    s.finishedAt = TEST_AT
    delete s.reps[d.reps[0].id]
    expect(confirmedReps(d, s, TEST_NOW)).toEqual([])
    expect(confirmedGym(d, p, TEST_NOW)).toBe(false)
    finishGym(p, d)
    p.gyms[d.id].sessions[0].reps[d.reps[1].id] = '2026-10-08T10:00:00.000Z'
    expect(confirmedGym(d, p, TEST_NOW)).toBe(false)
    expect(confirmedGym({ ...d, reps: [] }, p, TEST_NOW)).toBe(false)
  })

  it('requires a full exam attempt and a real passing score', () => {
    const p = testProgress()
    const total = curriculum.quizzes.reduce((n, q) => n + Math.min(FINAL_EXAM_PER_TRACK, q.questions.length), 0)
    p.finalExam = [{ id: 'exam', at: TEST_AT, total, correct: total, passed: true, wrongIds: [] }]
    expect(confirmedExam(curriculum, p)).toBe(true)
    p.finalExam[0].total = 1
    p.finalExam[0].correct = 1
    expect(confirmedExam(curriculum, p)).toBe(false)
    p.finalExam[0].total = total
    expect(confirmedExam(curriculum, p)).toBe(false)
    expect(confirmedExam({ ...curriculum, quizzes: [] }, p)).toBe(false)
  })

  it('has short completion text for every track', () => {
    for (const track of curriculum.tracks) {
      expect(track.learned?.length, track.id).toBeGreaterThanOrEqual(3)
      expect(track.learned?.length, track.id).toBeLessThanOrEqual(4)
      expect(track.nextSteps?.length, track.id).toBeGreaterThanOrEqual(1)
      expect(track.nextSteps?.length, track.id).toBeLessThanOrEqual(2)
      expect([...track.learned!, ...track.nextSteps!].every((s) => s.trim().length > 0), track.id).toBe(true)
    }
  })
})
