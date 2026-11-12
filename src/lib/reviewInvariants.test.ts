import { describe, expect, it } from 'vitest'
import { curriculum } from '../data'
import { QUIZ_SIZE } from '../config/weights'
import { reducer } from '../state/reducer'
import { confirmedTask } from './confirmedState'
import {
  TEST_AT,
  TEST_NOW,
  testProgress,
  solveIncident,
  verifyTask,
} from './confirmedState.fixtures'
import { normalizeProgress } from './storage'
import { hasPassed } from './quiz'
import {
  confirmedIncident,
  incidentStatusFor,
  parseIncidentReport,
  mergeIncidentReports,
  emptyIncident,
  summarizeIncidents,
} from './incidents'
import { computeSkillLevels, getVerification } from './progress'
import { recentPractice } from './today'
import { normalizeMeasurement } from './measurements'

describe('review: progress cannot be granted by derived flags or malformed scores', () => {
  const quiz = curriculum.tasks.find((t) => t.kind === 'quiz')!
  it.each([QUIZ_SIZE + 1, -1, 16.5, NaN, Infinity])(
    'rejects incorrect score %s on import and dispatch',
    (correct) => {
      const p = testProgress()
      const attempt = {
        id: 'bad',
        at: TEST_AT,
        total: QUIZ_SIZE,
        correct,
        passed: true,
        wrongIds: [],
      }
      p.tasks[quiz.id] = {
        status: 'completed',
        criteriaDone: quiz.acceptanceCriteria,
        notes: '',
        evidence: [],
        quizAttempts: [attempt],
      }
      const imported = normalizeProgress(p, curriculum)
      expect(confirmedTask(quiz, imported)).toBe(false)
      expect(hasPassed([attempt])).toBe(false)
      const clean = testProgress()
      expect(reducer(clean, { type: 'quiz/attempt', id: quiz.id, attempt })).toBe(clean)
    },
  )
  it('recomputes final exam flag and requires the full track quiz', () => {
    const p = testProgress()
    const attempt = { correct: 1, total: QUIZ_SIZE, passed: true, wrongIds: [] }
    const next = reducer(p, { type: 'exam/attempt', attempt })
    expect(next.finalExam[0].passed).toBe(false)
    expect(hasPassed([{ ...attempt, id: 'short', at: TEST_AT, total: 1 }])).toBe(false)
    expect(hasPassed([{ ...attempt, id: 'valid', at: TEST_AT, correct: 16, passed: false }])).toBe(
      true,
    )
  })
  it('revokes practice after evidence becomes empty', () => {
    const p = testProgress(),
      task = curriculum.tasks.find((t) => t.kind === 'lab')!
    verifyTask(p, task)
    expect(getVerification(task, p.tasks[task.id])).toBe('verified')
    p.tasks[task.id].evidence[0].value = '  '
    expect(getVerification(task, p.tasks[task.id])).not.toBe('verified')
    expect(
      computeSkillLevels(curriculum, p).get(task.vacancyRequirementIds[0])?.verifiedTaskIds,
    ).not.toContain(task.id)
  })
  it('revalidates incident examples and statuses when the program adds a check', () => {
    const p = testProgress(),
      def = curriculum.incidents[0]
    solveIncident(p, def)
    expect(confirmedIncident(def, p, TEST_NOW)).not.toBeNull()
    const changed = {
      ...def,
      checks: [...def.checks, { id: 'new-check', title: 'Новая проверка' }],
    }
    const c = { ...curriculum, incidents: [changed] }
    expect(confirmedIncident(changed, p, TEST_NOW)).toBeNull()
    expect(incidentStatusFor(changed, p, TEST_NOW)).toBe('in_progress')
    expect(summarizeIncidents([changed], p).solved).toBe(0)
    for (const s of changed.skillIds) expect(computeSkillLevels(c, p).get(s)?.solvedIncidentIds).toEqual([])
  })
  it('rejects duplicate check ids, future reports and raw passed flags', () => {
    const p = testProgress(),
      def = curriculum.incidents[0]
    solveIncident(p, def)
    const report = p.incidents[def.id].reports[0]
    expect(
      parseIncidentReport(
        { ...report, incidentId: def.id, checks: [...report.checks, report.checks[0]] },
        [def],
        'auto',
      ),
    ).toHaveProperty('error')
    const forged = { ...report, checks: report.checks.map((c) => ({ ...c, ok: false })) }
    const next = reducer(testProgress(), {
      type: 'incident/reports',
      reports: { [def.id]: [forged] },
    })
    expect(next.incidents[def.id].solvedAt).toBeUndefined()
    expect(reducer(next, { type: 'incident/reports', reports: { unknown: [report] } })).toBe(next)
    expect(
      mergeIncidentReports(emptyIncident(), [
        { ...report, at: new Date(Date.now() + 60_000).toISOString() },
      ]).reports,
    ).toEqual([])
  })
  it('compares reset/report times numerically across offsets', () => {
    const def = curriculum.incidents[0],
      p = testProgress()
    solveIncident(p, def)
    const r = p.incidents[def.id].reports[0]
    expect(
      mergeIncidentReports(
        emptyIncident(),
        [{ ...r, at: '2026-10-08T13:00:00+03:00' }],
        '2026-10-08T11:00:00Z',
      ).reports,
    ).toEqual([])
  })
  it('rejects a metric unit that bypasses recall bounds', () => {
    expect(
      normalizeMeasurement({
        id: 'm',
        taskId: 'A1',
        date: '2026-10-09',
        metric: 'recall',
        value: 120,
        unit: 'мс',
        model: 'model',
        hardware: 'cpu',
        conditions: 'test',
      }),
    ).toBeNull()
  })
  it('does not invent import dates for evidence, attempts, journal or practice answers', () => {
    const p = testProgress(),
      lab = curriculum.tasks.find((t) => t.kind === 'lab')!
    verifyTask(p, lab)
    verifyTask(p, quiz)
    p.tasks[lab.id].evidence[0].createdAt = ''
    p.tasks[quiz.id].quizAttempts![0].at = ''
    p.journal = [
      {
        id: 'j',
        date: '',
        did: 'Старая запись без даты',
        learned: '',
        unclear: '',
        evidenceUrl: '',
      },
    ]
    p.practice[curriculum.quizzes[0].questions[0].id] = {
      seen: 2,
      correct: 2,
      streak: 2,
      lastCorrect: true,
      lastAt: '',
    }
    const imported = normalizeProgress(p, curriculum)
    expect(confirmedTask(lab, imported)).toBe(true) // подтверждение сохранено
    expect(confirmedTask(quiz, imported)).toBe(true) // score сохранён
    expect(imported.journal).toMatchObject([{ id: 'j', date: '' }]) // старые записи дневника сохраняются как есть
    expect(recentPractice(curriculum, imported, Date.now())).toMatchObject({
      evidence: 0,
      quizzes: 0,
      questions: 0,
    })
  })
})
