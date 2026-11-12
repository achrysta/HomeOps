// Карточка навыка: что подтверждает навык, какой уровень подтверждён и одна следующая практика,
// которая его поднимет. Без React. Уровень дают засчитанные задачи, решённые стенды (INCIDENT_LEVEL)
// и самооценка с обоснованием; вопросы «Своими словами» показываются для повторения и уровень не поднимают.

import type {
  Curriculum,
  IncidentDef,
  Level,
  Skill,
  TaskDef,
  TaskStatus,
  UserProgress,
  Vacancy,
  VacancyRequirement,
} from '../types'
import { INCIDENT_LEVEL } from '../config/weights'
import { incidentStatusFor, confirmedIncident, type IncidentStatus } from './incidents'
import { questionSkills } from './interview'
import {
  getAvailability,
  getTaskProgress,
  getVerification,
  missingPrerequisites,
  taskGrantsLevel,
  type Availability,
  type CurriculumIndex,
  type InterviewReadiness,
  type SkillLevelInfo,
  type TopicReadiness,
} from './progress'

export interface SkillTaskRow {
  task: TaskDef
  /** Какой уровень навыка подтверждает задача */
  grants: Level
  availability: Availability
  status: TaskStatus
  verified: boolean
}

export type SkillNextStep =
  /** Задача отмечена «Выполнено», но не засчитана — довести до зачёта */
  | { kind: 'verify'; task: TaskDef; to: Level }
  /** Практика, которая поднимет подтверждённый уровень */
  | { kind: 'task'; task: TaskDef; to: Level }
  /** Нужная практика закрыта предыдущими задачами — сначала эта */
  | { kind: 'prerequisite'; task: TaskDef; unlocks: TaskDef; to: Level }
  /** Задач, которые поднимут уровень, нет — стенд навыка без разбора подтвердит уровень 2 */
  | { kind: 'incident'; def: IncidentDef; to: Level }
  /** Все задачи по навыку засчитаны: выше — только реальный production-опыт через самооценку */
  | { kind: 'production' }
  /** В программе нет задач по навыку */
  | { kind: 'none' }

export interface SkillCardData {
  skill: Skill
  requirement?: VacancyRequirement
  info: SkillLevelInfo
  tasks: SkillTaskRow[]
  incidents: { def: IncidentDef; status: IncidentStatus; withDebrief: boolean }[]
  topics: TopicReadiness[]
  /** Вопросы «Своими словами» по навыку — по всем темам */
  questions: { total: number; rated: number }
  /** Результаты практики: первый критерий приёмки каждой задачи по навыку; done — задача засчитана */
  outcomes: { text: string; taskId: string; done: boolean }[]
  next: SkillNextStep
}

/** Первая доступная задача в цепочке предыдущих, которая открывает task. */
function firstReadyPrerequisite(
  task: TaskDef,
  idx: CurriculumIndex,
  p: UserProgress,
  seen = new Set<string>(),
): TaskDef | null {
  for (const id of missingPrerequisites(task, idx, p)) {
    if (seen.has(id)) continue
    seen.add(id)
    const pre = idx.taskById.get(id)
    if (!pre) continue
    const availability = getAvailability(pre, idx, p)
    if (availability === 'ready') return pre
    if (availability === 'locked') {
      const deeper = firstReadyPrerequisite(pre, idx, p, seen)
      if (deeper) return deeper
    }
  }
  return null
}

export function skillNextStep(
  rows: readonly SkillTaskRow[],
  info: SkillLevelInfo,
  idx: CurriculumIndex,
  p: UserProgress,
  order: Map<string, number>,
  incidents: readonly IncidentDef[] = [],
): SkillNextStep {
  // стенд навыка, ещё не решённый самостоятельно, — когда задачи уровень уже не поднимут
  const stand = (): SkillNextStep | null => {
    if (info.earned >= INCIDENT_LEVEL.independent) return null
    const def = incidents.find((d) => !confirmedIncident(d, p)?.independent)
    return def ? { kind: 'incident', def, to: INCIDENT_LEVEL.independent } : null
  }
  if (!rows.length) return stand() ?? { kind: 'none' }
  // Кандидаты — незасчитанные задачи, которые поднимут подтверждённый уровень
  const candidates = rows
    .filter(
      (r) =>
        !r.verified &&
        r.grants > info.earned &&
        r.availability !== 'env_skipped' &&
        r.availability !== 'blocked',
    )
    .sort(
      (a, b) =>
        a.grants - b.grants ||
        Number(b.status === 'completed') - Number(a.status === 'completed') ||
        Number(b.status === 'in_progress') - Number(a.status === 'in_progress') ||
        (order.get(a.task.id) ?? 0) - (order.get(b.task.id) ?? 0),
    )
  const almost = candidates.find((r) => r.status === 'completed')
  if (almost) return { kind: 'verify', task: almost.task, to: almost.grants }
  for (const r of candidates) {
    if (r.availability === 'ready') return { kind: 'task', task: r.task, to: r.grants }
    const pre = firstReadyPrerequisite(r.task, idx, p)
    if (pre) return { kind: 'prerequisite', task: pre, unlocks: r.task, to: r.grants }
  }
  return stand() ?? { kind: 'production' }
}

export function buildSkillCard(
  skillId: string,
  c: Curriculum,
  idx: CurriculumIndex,
  p: UserProgress,
  vacancy: Vacancy,
  levels: Map<string, SkillLevelInfo>,
  interview: InterviewReadiness,
): SkillCardData | null {
  const skill = idx.skillById.get(skillId)
  const info = levels.get(skillId)
  if (!skill || !info) return null
  const order = new Map(c.tasks.map((t, i) => [t.id, i]))
  const tasks = c.tasks
    .filter((t) => t.vacancyRequirementIds.includes(skillId))
    .map((task): SkillTaskRow => {
      const tp = getTaskProgress(p, task.id)
      return {
        task,
        grants: taskGrantsLevel(task),
        availability: getAvailability(task, idx, p),
        status: tp.status,
        verified: getVerification(task, tp) === 'verified',
      }
    })
    .sort(
      (a, b) => a.grants - b.grants || (order.get(a.task.id) ?? 0) - (order.get(b.task.id) ?? 0),
    )
  const questionIds = c.interviewTopics.flatMap((t) =>
    t.questions.filter((q) => questionSkills(t, q).includes(skillId)).map((q) => q.id),
  )
  const seen = new Set<string>()
  const outcomes = tasks
    .filter((r) => r.task.kind !== 'quiz' && r.task.acceptanceCriteria.length > 0)
    .flatMap((r) => {
      const text = r.task.acceptanceCriteria[0]
      if (seen.has(text)) return []
      seen.add(text)
      return [{ text, taskId: r.task.id, done: r.verified }]
    })
  return {
    skill,
    requirement: vacancy.requirements.find((r) => r.skillId === skillId),
    info,
    tasks,
    incidents: c.incidents
      .filter((d) => d.skillIds.includes(skillId))
      .map((def) => ({
        def,
        status: incidentStatusFor(def, p),
        withDebrief: confirmedIncident(def, p)?.independent === false,
      })),
    topics: interview.topics.filter((t) => t.topic.skillIds.includes(skillId)),
    questions: {
      total: questionIds.length,
      rated: questionIds.filter((id) => p.interview.answers[id]).length,
    },
    outcomes,
    next: skillNextStep(tasks, info, idx, p, order, c.incidents.filter((d) => d.skillIds.includes(skillId))),
  }
}
