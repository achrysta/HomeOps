// Пакеты контента: блоки программы, которые добавляются отдельной папкой src/data/packs/<имя>/
// и подмешиваются в базовые файлы (curriculum, skills, resources, interview) одной строкой.
// Так два агента добавляют контент параллельно, не правя одни и те же файлы.
//
// Папка пакета:
//   pack.ts  — export const pack: ContentPack (треки, задачи, навыки, требования роли, материалы,
//              темы и вопросы «Своими словами», оценки времени);
//   quiz.ts  — контрольные тесты пакета (export const quizzes: Quiz[]) — подключаются в ./quizzes.ts,
//              попадают в чанк track-quizzes;
//   steps.ts — пошаговые планы (export const steps) и самопроверки шагов (export const checks, по одной
//              на шаг) — подключаются в ./steps.ts, грузятся лениво вместе с labSteps.
// Правила контента и инварианты — те же, что для базовых файлов (AGENTS.md).
import type { InterviewQuestion, InterviewTopic, Resource, Skill, TaskDef, Track, VacancyRequirement } from '../../types'
import type { TaskEstimate } from '../taskEstimates'
import { pack as finetuning } from './finetuning/pack'
import { pack as agents } from './agents/pack'
import { pack as pipelines } from './pipelines/pack'
import { pack as intl } from './intl/pack'
import { pack as platformIac } from './platform-iac/pack'

export interface ContentPack {
  id: string
  tracks?: Track[]
  tasks?: TaskDef[]
  skills?: Skill[]
  /** Требования профиля MLOps / AI Platform (исторически — основной профиль) */
  requirements?: VacancyRequirement[]
  /** Требования других профилей ролей: ключ — id профиля (например, platform-engineer) */
  roleRequirements?: Record<string, VacancyRequirement[]>
  resources?: Resource[]
  interviewTopics?: InterviewTopic[]
  /** Вопросы и инциденты для существующих тем «Своими словами»: ключ — id темы */
  interviewExtras?: Record<string, { questions?: InterviewQuestion[]; incidentIds?: string[]; skillIds?: string[] }>
  taskEstimates?: Record<string, TaskEstimate>
}

// Список пакетов: новый пакет — импорт и строка здесь (и в ./quizzes.ts, ./steps.ts, если есть).
export const packs: ContentPack[] = [agents, pipelines, intl, finetuning, platformIac]

export const packTracks = packs.flatMap((p) => p.tracks ?? [])
export const packTasks = packs.flatMap((p) => p.tasks ?? [])
export const packSkills = packs.flatMap((p) => p.skills ?? [])
export const packRequirements = packs.flatMap((p) => p.requirements ?? [])
export const packRoleRequirements = (roleId: string) => packs.flatMap((p) => p.roleRequirements?.[roleId] ?? [])
export const packResources = packs.flatMap((p) => p.resources ?? [])
export const packInterviewTopics = packs.flatMap((p) => p.interviewTopics ?? [])
export const packTaskEstimates: Record<string, TaskEstimate> = Object.assign({}, ...packs.map((p) => p.taskEstimates ?? {}))

/** Дополнения пакетов к существующей теме «Своими словами»: вопросы, связанные инциденты и навыки темы. */
export function mergeTopicExtras(topic: InterviewTopic): InterviewTopic {
  const extras = packs.map((p) => p.interviewExtras?.[topic.id]).filter((x) => x !== undefined)
  if (!extras.length) return topic
  return {
    ...topic,
    questions: [...topic.questions, ...extras.flatMap((x) => x.questions ?? [])],
    incidentIds: [...new Set([...topic.incidentIds, ...extras.flatMap((x) => x.incidentIds ?? [])])],
    skillIds: [...new Set([...topic.skillIds, ...extras.flatMap((x) => x.skillIds ?? [])])],
  }
}
