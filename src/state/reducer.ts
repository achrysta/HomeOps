import { MAX_QUIZ_ATTEMPTS, MAX_SAVED } from '../config/weights'
import { EMPTY_GYM, finishSession, recordRep, startSession } from '../lib/gyms'
import { emptyIncident, mergeIncidentReports, parseIncidentReport } from '../lib/incidents'
import { quizAttemptPasses } from '../lib/progress'
import { attemptPasses, trimAttempts, validAttemptScore } from '../lib/quiz'
import { uid } from '../lib/storage'
import { tasks } from '../data/curriculum'
import { recordTiming } from '../lib/timing'
import { normalizeMeasurement } from '../lib/measurements'
import { normalizeCkaExam } from '../lib/ckaExam'
import { incidents } from '../data/incidents'
import type { CkaExamAttempt } from '../types'
import type { Measurement } from '../types'
import type {
  Evidence,
  GymDef,
  IncidentProgress,
  IncidentReport,
  InterviewRating,
  Level,
  QuizAttempt,
  SavedItem,
  TaskProgress,
  TaskStatus,
  UserProgress,
} from '../types'

export type Action =
  | { type: 'cka-exam/upsert'; attempt: CkaExamAttempt }
  | { type: 'measurement/upsert'; measurement: Omit<Measurement, 'id'>; id?: string }
  | { type: 'measurement/remove'; id: string }
  | { type: 'task/status'; id: string; status: TaskStatus }
  | { type: 'task/criterion'; id: string; criterion: string; done: boolean }
  | { type: 'task/evidence/add'; id: string; evidence: Omit<Evidence, 'id' | 'createdAt'> }
  | { type: 'task/evidence/remove'; id: string; evidenceId: string }
  | { type: 'task/notes'; id: string; notes: string }
  | { type: 'resource/toggle'; id: string }
  | { type: 'skill/self'; id: string; selfLevel: Level | null; note: string }
  | { type: 'interview/rating'; questionId: string; rating: InterviewRating | null }
  /** Открыты ключевые тезисы: дальнейшие изменения оценки — уже не вслепую */
  | { type: 'interview/check'; questionId: string }
  | { type: 'saved/toggle'; kind: SavedItem['kind']; id: string }
  | { type: 'design/text'; caseId: string; text: string }
  /** Отметить аспект: до сверки — в оценке вслепую, после — в оценке после разбора */
  | { type: 'design/aspect'; caseId: string; aspectId: string; covered: boolean }
  /** Открыть разбор: отметки вслепую фиксируются, дальше меняется оценка после сверки */
  | { type: 'design/check'; caseId: string }
  | { type: 'interview/note'; questionId: string; note: string }
  | { type: 'quiz/attempt'; id: string; attempt: Omit<QuizAttempt, 'id' | 'at'> }
  | { type: 'exam/attempt'; attempt: Omit<QuizAttempt, 'id' | 'at'> }
  /** Результаты ответов для статистики тренажёра (из тренажёра и из тестов) */
  | { type: 'practice/record'; results: { questionId: string; correct: boolean }[] }
  /** Инциденты: начать, открыть следующую подсказку (не больше max), открыть разбор, принять отчёты автопроверки */
  | { type: 'incident/start'; id: string }
  | { type: 'incident/hint'; id: string; max: number }
  | { type: 'incident/debrief'; id: string }
  | { type: 'incident/reports'; reports: Record<string, IncidentReport[]> }
  /** Залы: начать сессию (прежняя незавершённая закрывается), засчитать текущий подход по живой проверке, завершить, пауза */
  | { type: 'gym/start'; gymId: string }
  | { type: 'gym/rep'; def: GymDef; sessionId: string; repId: string }
  | { type: 'gym/finish'; gymId: string; sessionId: string }
  | { type: 'gym/pause'; gymId: string; paused: boolean }
  | { type: 'vacancy/active'; id: string }
  /** touch: пометить как свежее изменение (импорт/сброс), чтобы оно не проиграло более старому файлу */
  | { type: 'replace'; progress: UserProgress; touch?: boolean }

const emptyTask = (): TaskProgress => ({
  status: 'not_started',
  evidence: [],
  notes: '',
  criteriaDone: [],
})

function patchTask(
  p: UserProgress,
  id: string,
  fn: (tp: TaskProgress) => TaskProgress,
  now: string,
): UserProgress {
  const current = p.tasks[id] ?? emptyTask()
  const next = recordTiming(
    tasks.find((t) => t.id === id),
    current,
    fn(current),
    now,
  )
  return { ...p, tasks: { ...p.tasks, [id]: { ...next, updatedAt: now } } }
}

function patchIncident(
  p: UserProgress,
  id: string,
  fn: (ip: IncidentProgress) => IncidentProgress,
): UserProgress {
  const current = p.incidents[id] ?? emptyIncident()
  const next = fn(current)
  return next === current ? p : { ...p, incidents: { ...p.incidents, [id]: next } }
}

function apply(p: UserProgress, action: Action, now: string): UserProgress {
  switch (action.type) {
    case 'task/status':
      return patchTask(
        p,
        action.id,
        (tp) => {
          const next: TaskProgress = { ...tp, status: action.status }
          if (action.status === 'completed') next.completedAt = tp.completedAt ?? now
          else delete next.completedAt
          return next
        },
        now,
      )

    case 'task/criterion':
      return patchTask(
        p,
        action.id,
        (tp) => {
          const set = new Set(tp.criteriaDone)
          if (action.done) set.add(action.criterion)
          else set.delete(action.criterion)
          return { ...tp, criteriaDone: [...set] }
        },
        now,
      )

    case 'task/evidence/add': {
      const value = action.evidence.value.trim()
      if (!value) return p
      const description = action.evidence.description?.trim()
      const ev: Evidence = {
        id: uid(),
        type: action.evidence.type,
        value,
        ...(description ? { description } : {}),
        createdAt: now,
      }
      return patchTask(p, action.id, (tp) => ({ ...tp, evidence: [...tp.evidence, ev] }), now)
    }

    case 'task/evidence/remove':
      return patchTask(
        p,
        action.id,
        (tp) => ({ ...tp, evidence: tp.evidence.filter((e) => e.id !== action.evidenceId) }),
        now,
      )

    case 'task/notes':
      return patchTask(p, action.id, (tp) => ({ ...tp, notes: action.notes }), now)

    case 'resource/toggle': {
      const completed = !p.resources[action.id]?.completed
      return {
        ...p,
        resources: {
          ...p.resources,
          [action.id]: completed ? { completed, completedAt: now } : { completed },
        },
      }
    }

    case 'skill/self': {
      const skills = { ...p.skills }
      const note = action.note.trim()
      if (action.selfLevel === null && !note) delete skills[action.id]
      else
        skills[action.id] = {
          ...(action.selfLevel !== null ? { selfLevel: action.selfLevel } : {}),
          ...(note ? { note: action.note } : {}),
        }
      return { ...p, skills }
    }

    case 'interview/rating': {
      const answers = { ...p.interview.answers }
      if (action.rating === null) delete answers[action.questionId]
      else {
        const prev = answers[action.questionId]
        // пока тезисы не открыты, оценка остаётся «вслепую»
        answers[action.questionId] = {
          ...prev,
          rating: action.rating,
          ...(prev?.checkedAt ? {} : { blindRating: action.rating }),
          ratedAt: now,
          updatedAt: now,
        }
      }
      return { ...p, interview: { ...p.interview, answers } }
    }

    case 'interview/check': {
      const prev = p.interview.answers[action.questionId]
      if (!prev || prev.checkedAt) return p
      return {
        ...p,
        interview: {
          ...p.interview,
          answers: { ...p.interview.answers, [action.questionId]: { ...prev, checkedAt: now } },
        },
      }
    }

    case 'saved/toggle': {
      const has = p.saved.some((s) => s.kind === action.kind && s.id === action.id)
      const saved = has
        ? p.saved.filter((s) => !(s.kind === action.kind && s.id === action.id))
        : [...p.saved, { kind: action.kind, id: action.id, at: now }].slice(-MAX_SAVED)
      return { ...p, saved }
    }

    case 'design/text': {
      const prev = p.interview.designs[action.caseId]
      const next = prev
        ? { ...prev, text: action.text, updatedAt: now }
        : { text: action.text, covered: [], updatedAt: now }
      return {
        ...p,
        interview: { ...p.interview, designs: { ...p.interview.designs, [action.caseId]: next } },
      }
    }

    case 'design/aspect': {
      const prev = p.interview.designs[action.caseId] ?? { text: '', covered: [], updatedAt: now }
      const toggle = (list: string[]) =>
        action.covered
          ? [...new Set([...list, action.aspectId])]
          : list.filter((id) => id !== action.aspectId)
      const next = prev.checkedAt
        ? { ...prev, coveredAfter: toggle(prev.coveredAfter ?? prev.covered), updatedAt: now }
        : { ...prev, covered: toggle(prev.covered), updatedAt: now }
      return {
        ...p,
        interview: { ...p.interview, designs: { ...p.interview.designs, [action.caseId]: next } },
      }
    }

    case 'design/check': {
      const prev = p.interview.designs[action.caseId]
      if (!prev || prev.checkedAt) return p
      const next = { ...prev, checkedAt: now, coveredAfter: [...prev.covered] }
      return {
        ...p,
        interview: { ...p.interview, designs: { ...p.interview.designs, [action.caseId]: next } },
      }
    }

    case 'interview/note': {
      const prev = p.interview.answers[action.questionId]
      if (!prev) return p
      return {
        ...p,
        interview: {
          ...p.interview,
          answers: {
            ...p.interview.answers,
            [action.questionId]: {
              ...prev,
              note: action.note,
              ratedAt: prev.ratedAt ?? prev.checkedAt ?? prev.updatedAt,
              updatedAt: now,
            },
          },
        },
      }
    }

    case 'quiz/attempt': {
      if (!validAttemptScore(action.attempt)) return p
      // «Сдано» — по счёту полной попытки, а не по флагу, который передал интерфейс
      const attempt: QuizAttempt = {
        ...action.attempt,
        passed: quizAttemptPasses(action.attempt),
        id: uid(),
        at: now,
      }
      return patchTask(
        p,
        action.id,
        (tp) => {
          const passedBefore = (tp.quizAttempts ?? []).some(quizAttemptPasses)
          const next: TaskProgress = {
            ...tp,
            quizAttempts: trimAttempts([...(tp.quizAttempts ?? []), attempt], MAX_QUIZ_ATTEMPTS),
          }
          if (attempt.passed || passedBefore) {
            next.status = 'completed'
            next.completedAt = tp.completedAt ?? now
          } else if (tp.status === 'not_started') {
            next.status = 'in_progress'
          }
          return next
        },
        now,
      )
    }

    case 'exam/attempt':
      if (!validAttemptScore(action.attempt)) return p
      return {
        ...p,
        finalExam: trimAttempts(
          [
            ...p.finalExam,
            { ...action.attempt, passed: attemptPasses(action.attempt), id: uid(), at: now },
          ],
          MAX_QUIZ_ATTEMPTS,
        ),
      }

    case 'practice/record': {
      if (!action.results.length) return p
      const practice = { ...p.practice }
      for (const { questionId, correct } of action.results) {
        const prev = practice[questionId]
        practice[questionId] = {
          seen: (prev?.seen ?? 0) + 1,
          correct: (prev?.correct ?? 0) + (correct ? 1 : 0),
          streak: correct ? (prev?.streak ?? 0) + 1 : 0,
          lastCorrect: correct,
          lastAt: now,
        }
      }
      return { ...p, practice }
    }

    case 'incident/start':
      return patchIncident(p, action.id, (ip) => (ip.startedAt ? ip : { ...ip, startedAt: now }))

    case 'incident/hint':
      return patchIncident(p, action.id, (ip) =>
        ip.hintsShown >= action.max
          ? ip
          : { ...ip, hintsShown: ip.hintsShown + 1, startedAt: ip.startedAt ?? now },
      )

    case 'incident/debrief':
      return patchIncident(p, action.id, (ip) =>
        ip.debriefOpenedAt ? ip : { ...ip, debriefOpenedAt: now },
      )

    case 'incident/reports': {
      let next = p
      for (const [id, reports] of Object.entries(action.reports)) {
        // отчёты, сделанные до создания или сброса прогресса, не принимаем
        const def = incidents.find((d) => d.id === id)
        if (!def) continue
        const checked = reports.flatMap((r) => {
          const parsed = parseIncidentReport({ ...r, incidentId: id }, [def], r.source)
          return 'report' in parsed ? [parsed.report] : []
        })
        next = patchIncident(next, id, (ip) => mergeIncidentReports(ip, checked, p.meta.createdAt))
      }
      return next
    }

    case 'cka-exam/upsert': {
      const attempt = normalizeCkaExam(action.attempt, incidents)
      if (!attempt) return p
      const list = p.ckaExams ?? []
      return {
        ...p,
        ckaExams: list.some((a) => a.id === attempt.id)
          ? list.map((a) => (a.id === attempt.id ? attempt : a))
          : [...list, attempt],
      }
    }

    case 'measurement/upsert': {
      const list = p.measurements ?? []
      if (action.id && !list.some((m) => m.id === action.id)) return p
      const m = normalizeMeasurement({ ...action.measurement, id: action.id ?? uid() })
      if (!m) return p
      return {
        ...p,
        measurements: action.id
          ? list.map((old) => (old.id === action.id ? m : old))
          : [...list, m],
      }
    }

    case 'measurement/remove':
      return { ...p, measurements: (p.measurements ?? []).filter((m) => m.id !== action.id) }

    case 'vacancy/active':
      return { ...p, activeVacancyId: action.id }

    case 'gym/start':
      return {
        ...p,
        gyms: { ...p.gyms, [action.gymId]: startSession(p.gyms[action.gymId], uid(), now) },
      }

    case 'gym/rep': {
      const prev = p.gyms[action.def.id]
      const next = recordRep(action.def, prev, action.sessionId, action.repId, now)
      return !next || next === prev ? p : { ...p, gyms: { ...p.gyms, [action.def.id]: next } }
    }

    case 'gym/finish': {
      const prev = p.gyms[action.gymId]
      const next = finishSession(prev, action.sessionId, now)
      return !next || next === prev ? p : { ...p, gyms: { ...p.gyms, [action.gymId]: next } }
    }

    case 'gym/pause':
      return {
        ...p,
        gyms: {
          ...p.gyms,
          [action.gymId]: { ...(p.gyms[action.gymId] ?? EMPTY_GYM), paused: action.paused },
        },
      }

    case 'replace':
      return action.touch
        ? { ...action.progress, meta: { ...action.progress.meta, updatedAt: now } }
        : action.progress
  }
}

export function reducer(p: UserProgress, action: Action): UserProgress {
  const now = new Date().toISOString()
  const next = apply(p, action, now)
  if (next === p || action.type === 'replace') return next
  return { ...next, meta: { ...next.meta, updatedAt: now } }
}
