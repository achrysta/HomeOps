import {
  IMPORTANCE_ACTION_WEIGHT,
  INCIDENT_LEVEL,
  IMPORTANCE_SHARE,
  PRIORITY_SCORE,
  QUIZ_SIZE,
  TASK_KIND_LEVEL,
  TASK_KIND_WEIGHT,
  TRACK_ORDER_PENALTY,
} from '../config/weights'
import { explainRating, overrated } from './interview'
import { confirmedIncident } from './incidents'
import { attemptPasses } from './quiz'
import type {
  Curriculum,
  Importance,
  InterviewTopic,
  Level,
  Resource,
  Skill,
  TaskDef,
  TaskProgress,
  Track,
  UserProgress,
  Vacancy,
  VacancyRequirement,
} from '../types'

export const IMPORTANCE_ORDER: Importance[] = ['required', 'important', 'bonus', 'advanced']

// ─────────────────────────────────────────────────────────────────────────────
// Index
// ─────────────────────────────────────────────────────────────────────────────

export interface CurriculumIndex {
  taskById: Map<string, TaskDef>
  trackById: Map<string, Track>
  skillById: Map<string, Skill>
  resourceById: Map<string, Resource>
  /** taskId → задачи, для которых она является prerequisite */
  dependents: Map<string, string[]>
  tasksByTrack: Map<string, TaskDef[]>
}

export function buildIndex(c: Curriculum): CurriculumIndex {
  const dependents = new Map<string, string[]>()
  const tasksByTrack = new Map<string, TaskDef[]>()
  for (const task of c.tasks) {
    for (const pre of task.prerequisites) {
      dependents.set(pre, [...(dependents.get(pre) ?? []), task.id])
    }
    tasksByTrack.set(task.trackId, [...(tasksByTrack.get(task.trackId) ?? []), task])
  }
  return {
    taskById: new Map(c.tasks.map((t) => [t.id, t])),
    trackById: new Map(c.tracks.map((t) => [t.id, t])),
    skillById: new Map(c.skills.map((s) => [s.id, s])),
    resourceById: new Map(c.resources.map((r) => [r.id, r])),
    dependents,
    tasksByTrack,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Task state
// ─────────────────────────────────────────────────────────────────────────────

const EMPTY_TASK_PROGRESS: TaskProgress = Object.freeze({
  status: 'not_started',
  evidence: [],
  notes: '',
  criteriaDone: [],
}) as TaskProgress

export function getTaskProgress(p: UserProgress, taskId: string): TaskProgress {
  return p.tasks[taskId] ?? EMPTY_TASK_PROGRESS
}

/**
 * verified — задача засчитана: статус Completed, все acceptance criteria отмечены
 * и (кроме чтения) приложен хотя бы один evidence.
 */
export type Verification = 'verified' | 'needs_evidence' | 'needs_criteria' | 'needs_both' | 'open'

export function requiresEvidence(task: TaskDef): boolean {
  return task.kind !== 'reading' && task.kind !== 'quiz'
}

export function getVerification(task: TaskDef, tp: TaskProgress): Verification {
  // Тест засчитывается только по факту сдачи, ручной статус не влияет. Сдача — по счёту полной попытки,
  // а не по флагу passed: флаг из файла или импорта мог не совпадать со счётом
  if (task.kind === 'quiz')
    return (tp.quizAttempts ?? []).some(quizAttemptPasses) ? 'verified' : 'open'
  if (tp.status !== 'completed') return 'open'
  const criteriaOk = task.acceptanceCriteria.every((c) => tp.criteriaDone.includes(c))
  const evidenceOk =
    !requiresEvidence(task) ||
    tp.evidence.some((e) => typeof e.value === 'string' && !!e.value.trim())
  if (criteriaOk && evidenceOk) return 'verified'
  if (!criteriaOk && !evidenceOk) return 'needs_both'
  return evidenceOk ? 'needs_criteria' : 'needs_evidence'
}

/** Полная попытка контрольного теста (QUIZ_SIZE вопросов) с результатом не ниже проходного балла. */
export function quizAttemptPasses(a: { correct: number; total: number }): boolean {
  return attemptPasses(a, QUIZ_SIZE)
}

export function isVerified(task: TaskDef, tp: TaskProgress): boolean {
  return getVerification(task, tp) === 'verified'
}

/** Environment-dependent задача, отмеченная Blocked: не штрафует прогресс и не блокирует зависимые. */
export function isEnvSkipped(task: TaskDef, tp: TaskProgress): boolean {
  return task.environmentDependency && tp.status === 'blocked'
}

export function missingPrerequisites(
  task: TaskDef,
  idx: CurriculumIndex,
  p: UserProgress,
): string[] {
  return task.prerequisites.filter((id) => {
    const pre = idx.taskById.get(id)
    if (!pre) return false
    const pp = getTaskProgress(p, id)
    return !(isVerified(pre, pp) || isEnvSkipped(pre, pp))
  })
}

export type Availability = 'done' | 'ready' | 'locked' | 'blocked' | 'env_skipped'

export function getAvailability(
  task: TaskDef,
  idx: CurriculumIndex,
  p: UserProgress,
): Availability {
  const tp = getTaskProgress(p, task.id)
  if (isVerified(task, tp)) return 'done'
  if (isEnvSkipped(task, tp)) return 'env_skipped'
  if (tp.status === 'blocked') return 'blocked'
  return missingPrerequisites(task, idx, p).length === 0 ? 'ready' : 'locked'
}

export function taskWeight(task: TaskDef): number {
  return TASK_KIND_WEIGHT[task.kind]
}

export function taskGrantsLevel(task: TaskDef): Level {
  return task.grantsLevel ?? TASK_KIND_LEVEL[task.kind]
}

// ─────────────────────────────────────────────────────────────────────────────
// Learning progress (weighted, evidence-based)
// ─────────────────────────────────────────────────────────────────────────────

export interface ProgressSummary {
  earned: number
  total: number
  pct: number
  taskCount: number
  verified: number
  completedUnverified: number
  inProgress: number
  blocked: number
  envSkipped: number
}

export function summarize(tasks: TaskDef[], p: UserProgress): ProgressSummary {
  const s: ProgressSummary = {
    earned: 0,
    total: 0,
    pct: 0,
    taskCount: 0,
    verified: 0,
    completedUnverified: 0,
    inProgress: 0,
    blocked: 0,
    envSkipped: 0,
  }
  for (const task of tasks) {
    const tp = getTaskProgress(p, task.id)
    if (isEnvSkipped(task, tp)) {
      s.envSkipped++
      continue
    }
    s.taskCount++
    const w = taskWeight(task)
    s.total += w
    const v = getVerification(task, tp)
    if (v === 'verified') {
      s.earned += w
      s.verified++
    } else if (tp.status === 'completed') {
      s.completedUnverified++
    } else if (tp.status === 'in_progress') {
      s.inProgress++
    } else if (tp.status === 'blocked') {
      s.blocked++
    }
  }
  s.pct = s.total > 0 ? s.earned / s.total : 0
  return s
}

/** Задачи, входящие в основной Learning Progress: core tracks, без optional. */
export function coreTasks(c: Curriculum, idx: CurriculumIndex): TaskDef[] {
  return c.tasks.filter((t) => idx.trackById.get(t.trackId)?.kind === 'core' && !t.optional)
}

export function tasksForTrackProgress(track: Track, idx: CurriculumIndex): TaskDef[] {
  const all = idx.tasksByTrack.get(track.id) ?? []
  return track.kind === 'core' ? all.filter((t) => !t.optional) : all
}

/** Лабораторные в узком смысле — для счётчика «Лабораторные X/Y». */
export function isLabTask(task: TaskDef): boolean {
  return task.kind === 'lab' || task.kind === 'integration'
}

/** Практическая задача: упражнение, лабораторная или интеграция — засчитывается по критериям и подтверждениям. */
export function isPracticeTask(task: TaskDef): boolean {
  return task.kind === 'exercise' || isLabTask(task)
}

// ─────────────────────────────────────────────────────────────────────────────
// Skill levels
// ─────────────────────────────────────────────────────────────────────────────

export interface SkillLevelInfo {
  skillId: string
  current: Level
  /** Максимальный уровень, подтверждённый verified-задачами и решёнными стендами */
  earned: Level
  /** Заявленный уровень (самооценка или baseline профиля) */
  claimed: Level
  claimSource: 'baseline' | 'self'
  claimNote: string
  /** Заявленный уровень учитывается, только если есть обоснование */
  claimCounts: boolean
  linkedTaskIds: string[]
  verifiedTaskIds: string[]
  evidenceCount: number
  /** Стенды навыка, решённые с текущими проверками: самостоятельно (уровень 2) или после разбора (уровень 1) */
  solvedIncidentIds: string[]
}

export function computeSkillLevels(c: Curriculum, p: UserProgress): Map<string, SkillLevelInfo> {
  const result = new Map<string, SkillLevelInfo>()
  for (const skill of c.skills) {
    const sp = p.skills[skill.id]
    const hasSelf = sp?.selfLevel !== undefined
    const claimed: Level = hasSelf ? (sp!.selfLevel as Level) : skill.baselineLevel
    const claimNote = (hasSelf ? sp?.note : skill.baselineEvidence)?.trim() ?? ''
    result.set(skill.id, {
      skillId: skill.id,
      current: 0,
      earned: 0,
      claimed,
      claimSource: hasSelf ? 'self' : 'baseline',
      claimNote,
      claimCounts: claimed === 0 || claimNote.length > 0,
      linkedTaskIds: [],
      verifiedTaskIds: [],
      evidenceCount: 0,
      solvedIncidentIds: [],
    })
  }
  for (const task of c.tasks) {
    const tp = getTaskProgress(p, task.id)
    const verified = isVerified(task, tp)
    for (const skillId of task.vacancyRequirementIds) {
      const info = result.get(skillId)
      if (!info) continue
      info.linkedTaskIds.push(task.id)
      if (verified) {
        info.verifiedTaskIds.push(task.id)
        info.evidenceCount += tp.evidence.length
        const lvl = taskGrantsLevel(task)
        if (lvl > info.earned) info.earned = lvl
      }
    }
  }
  for (const def of c.incidents) {
    const solved = def.skillIds.length ? confirmedIncident(def, p) : null
    if (!solved) continue
    const lvl = solved.independent ? INCIDENT_LEVEL.independent : INCIDENT_LEVEL.withDebrief
    for (const skillId of def.skillIds) {
      const info = result.get(skillId)
      if (!info) continue
      info.solvedIncidentIds.push(def.id)
      if (lvl > info.earned) info.earned = lvl
    }
  }
  for (const info of result.values()) {
    const claim = info.claimCounts ? info.claimed : 0
    info.current = Math.max(info.earned, claim) as Level
  }
  return result
}

// ─────────────────────────────────────────────────────────────────────────────
// Vacancy match
// ─────────────────────────────────────────────────────────────────────────────

export interface RequirementRow {
  req: VacancyRequirement
  skill: Skill
  info: SkillLevelInfo
  current: Level
  target: Level
  gap: number
  match: number
}

export interface CategoryMatch {
  importance: Importance
  pct: number
  count: number
  met: number
  share: number
}

export interface VacancyMatch {
  overall: number
  categories: Record<Importance, CategoryMatch>
  rows: RequirementRow[]
}

export function computeVacancyMatch(
  vacancy: Vacancy,
  levels: Map<string, SkillLevelInfo>,
  idx: CurriculumIndex,
): VacancyMatch {
  const rows: RequirementRow[] = []
  for (const req of vacancy.requirements) {
    const skill = idx.skillById.get(req.skillId)
    const info = levels.get(req.skillId)
    if (!skill || !info) continue
    const current = info.current
    const target = req.targetLevel
    rows.push({
      req,
      skill,
      info,
      current,
      target,
      gap: Math.max(0, target - current),
      match: target === 0 ? 1 : Math.min(current, target) / target,
    })
  }

  const categories = {} as Record<Importance, CategoryMatch>
  for (const imp of IMPORTANCE_ORDER) {
    const catRows = rows.filter((r) => r.req.importance === imp)
    categories[imp] = {
      importance: imp,
      count: catRows.length,
      met: catRows.filter((r) => r.gap === 0).length,
      pct: catRows.length ? catRows.reduce((a, r) => a + r.match, 0) / catRows.length : 0,
      share: IMPORTANCE_SHARE[imp],
    }
  }

  let weighted = 0
  let shares = 0
  for (const imp of IMPORTANCE_ORDER) {
    const cat = categories[imp]
    if (cat.count === 0 || cat.share === 0) continue
    weighted += cat.share * cat.pct
    shares += cat.share
  }
  const overall = shares > 0 ? weighted / shares : 0


  return { overall, categories, rows }
}

export interface MatchOrigin {
  /** Часть общей оценки, которую дают засчитанные задачи (лабораторные, интеграции, тесты) */
  practice: number
  /** Часть, которую даёт исходный опыт из профиля (с обоснованием) */
  baseline: number
  /** Часть, которую даёт самооценка (с обоснованием) */
  self: number
}

/**
 * Откуда берётся соответствие роли: оценка каждого требования раскладывается на уровень,
 * подтверждённый задачами, и добавку от заявленного уровня (профиль или самооценка).
 * Сумма частей равна match.overall.
 */
export function matchOrigin(match: VacancyMatch): MatchOrigin {
  const origin: MatchOrigin = { practice: 0, baseline: 0, self: 0 }
  let shares = 0
  for (const imp of IMPORTANCE_ORDER) {
    const cat = match.categories[imp]
    if (cat.count > 0 && cat.share > 0) shares += cat.share
  }
  if (shares === 0) return origin
  for (const row of match.rows) {
    const cat = match.categories[row.req.importance]
    if (cat.count === 0 || cat.share === 0) continue
    const k = cat.share / shares / cat.count
    if (row.target === 0) {
      origin.baseline += k * row.match
      continue
    }
    const earned = Math.min(row.info.earned, row.target) / row.target
    origin.practice += k * earned
    origin[row.info.claimSource] += k * Math.max(0, row.match - earned)
  }
  return origin
}

/** Наивысшая важность задачи для роли (по связанным навыкам). */
export function taskImportance(
  task: TaskDef,
  vacancy: Vacancy,
  idx: CurriculumIndex,
): Importance | null {
  if (idx.trackById.get(task.trackId)?.kind === 'advanced') return 'advanced'
  let best: Importance | null = null
  for (const skillId of task.vacancyRequirementIds) {
    const req = vacancy.requirements.find((r) => r.skillId === skillId)
    if (!req) continue
    if (
      best === null ||
      IMPORTANCE_ORDER.indexOf(req.importance) < IMPORTANCE_ORDER.indexOf(best)
    ) {
      best = req.importance
    }
  }
  return best
}

// ─────────────────────────────────────────────────────────────────────────────
// Next actions
// ─────────────────────────────────────────────────────────────────────────────

export interface NextAction {
  task: TaskDef
  type: 'verify' | 'continue' | 'start'
  score: number
  reason: string
  why?: string
}

export function nextActions(
  c: Curriculum,
  idx: CurriculumIndex,
  p: UserProgress,
  vacancy: Vacancy,
  levels: Map<string, SkillLevelInfo>,
  limit = 3,
): NextAction[] {
  const actions: NextAction[] = []
  for (const task of coreTasks(c, idx)) {
    const tp = getTaskProgress(p, task.id)
    const v = getVerification(task, tp)
    if (v === 'verified' || tp.status === 'blocked') continue
    const track = idx.trackById.get(task.trackId)
    const priority = PRIORITY_SCORE[task.priority]

    if (tp.status === 'completed') {
      const what =
        v === 'needs_evidence'
          ? 'подтверждение'
          : v === 'needs_criteria'
            ? 'отметить критерии приёмки'
            : 'подтверждение и критерии приёмки'
      actions.push({
        task,
        type: 'verify',
        score: 1000 + priority,
        reason: `Отмечено «Выполнено», но не засчитано: нужно ${what}`,
      })
      continue
    }
    if (missingPrerequisites(task, idx, p).length > 0) continue

    const grant = taskGrantsLevel(task)
    let gapBoost = 0
    const closes: string[] = []
    for (const skillId of task.vacancyRequirementIds) {
      const req = vacancy.requirements.find((r) => r.skillId === skillId)
      const info = levels.get(skillId)
      if (!req || !info) continue
      const reachable = Math.min(grant, req.targetLevel) - info.current
      if (reachable > 0) {
        gapBoost += IMPORTANCE_ACTION_WEIGHT[req.importance] * reachable * 5
        closes.push(
          `${idx.skillById.get(skillId)?.title ?? skillId} (${info.current}→${Math.min(grant, req.targetLevel)})`,
        )
      }
    }
    const inProgress = tp.status === 'in_progress'
    const score =
      priority + (inProgress ? 60 : 0) + Math.min(gapBoost, 90) - (track?.order ?? 0) * TRACK_ORDER_PENALTY
    const reason = inProgress
      ? 'В работе — довести до подтверждения'
      : closes.length
        ? `Поднимает: ${closes.slice(0, 2).join(', ')}`
        : 'Следующий шаг по дорожной карте'
    const why = inProgress
      ? 'Начатая задача получает приоритет, чтобы довести её до зачёта.'
      : closes.length
        ? 'Шаг закрывает разрыв в навыках роли. Учитываются приоритет задачи и порядок треков.' +
          (task.kind === 'reading' && task.prerequisites.length === 0
            ? ' Это чтение не требует предыдущих задач: его можно проходить параллельно текущему треку.'
            : ' Условия по предыдущим задачам позволяют начать этот шаг.')
        : 'Приоритет задачи и рекомендуемый порядок треков определяют следующий доступный шаг.'
    actions.push({ task, type: inProgress ? 'continue' : 'start', score, reason, why })
  }
  return actions.sort((a, b) => b.score - a.score).slice(0, limit)
}

// ─────────────────────────────────────────────────────────────────────────────
// «Своими словами»: самопроверка ответом вслух
// ─────────────────────────────────────────────────────────────────────────────

export interface TopicReadiness {
  topic: InterviewTopic
  /** Доля от максимума шкалы: «Объясню самостоятельно» по всем вопросам темы — 100% */
  pct: number
  answered: number
  /** Сколько ответов с оценкой 0, 1 и 2 (старая оценка 3 считается как 2) */
  counts: [number, number, number]
  /** Ответы, сверенные с ключевыми тезисами */
  checked: number
  /** Вслепую оценил себя выше, чем после сверки */
  overrated: number
}

export interface InterviewReadiness {
  pct: number
  answered: number
  total: number
  checked: number
  overrated: number
  topics: TopicReadiness[]
}

/** Сводка самопроверки по темам. Только читает оценки: на обучение, навыки и роль не влияет. */
export function computeInterviewReadiness(c: Curriculum, p: UserProgress): InterviewReadiness {
  const MAX = 2
  let sum = 0
  let total = 0
  let answered = 0
  let checked = 0
  let overratedTotal = 0
  const topics = c.interviewTopics.map((topic): TopicReadiness => {
    const counts: [number, number, number] = [0, 0, 0]
    let tSum = 0
    let tAnswered = 0
    let tChecked = 0
    let tOverrated = 0
    for (const q of topic.questions) {
      const a = p.interview.answers[q.id]
      total++
      if (!a) continue
      const r = explainRating(a.rating)
      counts[r]++
      tSum += r
      tAnswered++
      if (a.checkedAt) tChecked++
      if (overrated(a)) tOverrated++
    }
    sum += tSum
    answered += tAnswered
    checked += tChecked
    overratedTotal += tOverrated
    return {
      topic,
      pct: topic.questions.length ? tSum / (MAX * topic.questions.length) : 0,
      answered: tAnswered,
      counts,
      checked: tChecked,
      overrated: tOverrated,
    }
  })
  return { pct: total ? sum / (MAX * total) : 0, answered, total, checked, overrated: overratedTotal, topics }
}

// ─────────────────────────────────────────────────────────────────────────────
// Track dependencies (для обзора roadmap)
// ─────────────────────────────────────────────────────────────────────────────

export function trackDependencies(track: Track, idx: CurriculumIndex): string[] {
  const deps = new Set<string>()
  for (const task of idx.tasksByTrack.get(track.id) ?? []) {
    if (task.optional) continue
    for (const pre of task.prerequisites) {
      const other = idx.taskById.get(pre)?.trackId
      if (other && other !== track.id) deps.add(other)
    }
  }
  return [...deps].sort(
    (a, b) => (idx.trackById.get(a)?.order ?? 0) - (idx.trackById.get(b)?.order ?? 0),
  )
}
