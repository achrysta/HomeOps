import { describe, expect, it } from 'vitest'
import { curriculum } from '../data'
import type { UserProgress } from '../types'
import { buildIndex, computeInterviewReadiness, computeSkillLevels, getAvailability, missingPrerequisites } from './progress'
import { buildSkillCard, skillNextStep, type SkillTaskRow } from './skillCard'
import { createEmptyProgress, normalizeProgress } from './storage'

const idx = buildIndex(curriculum)
const vacancy = curriculum.vacancies[0]
const order = new Map(curriculum.tasks.map((t, i) => [t.id, i]))
const card = (p: UserProgress, skillId: string) => {
  const levels = computeSkillLevels(curriculum, p)
  return buildSkillCard(skillId, curriculum, idx, p, vacancy, levels, computeInterviewReadiness(curriculum, p))!
}
const verify = (p: UserProgress, taskId: string) => {
  const task = idx.taskById.get(taskId)!
  p.tasks[taskId] = {
    status: 'completed',
    criteriaDone: [...task.acceptanceCriteria],
    notes: '',
    evidence: task.kind === 'reading' || task.kind === 'quiz' ? [] : [{ id: 'e', type: 'commit', value: 'abc', createdAt: '2026-10-08T10:00:00Z' }],
    // тест засчитывается только сданной попыткой
    ...(task.kind === 'quiz' ? { quizAttempts: [{ id: 'q', at: '2026-10-08T10:00:00Z', correct: 20, total: 20, passed: true, wrongIds: [] }] } : {}),
  }
}

describe('skill card', () => {
  it('collects tasks, outcomes, incidents and interview topics of a skill', () => {
    const c = card(createEmptyProgress(curriculum), 'kubernetes')
    expect(c.skill.id).toBe('kubernetes')
    expect(c.requirement?.skillId).toBe('kubernetes')
    // задачи — по возрастанию уровня, который они подтверждают
    expect(c.tasks.map((r) => r.grants)).toEqual([...c.tasks.map((r) => r.grants)].sort((a, b) => a - b))
    expect(c.incidents.map((i) => i.def.id)).toEqual(expect.arrayContaining(['k8s-crashloop', 'k8s-rollout']))
    expect(c.topics.map((t) => t.topic.id)).toContain('iv-k8s')
    expect(c.questions).toEqual({ total: curriculum.interviewTopics.find((t) => t.id === 'iv-k8s')!.questions.length, rated: 0 })
    expect(c.outcomes.every((o) => !o.done)).toBe(true)
    expect(new Set(c.outcomes.map((o) => o.text)).size).toBe(c.outcomes.length)
  })

  it('suggests the nearest practice that raises the confirmed level', () => {
    const p = createEmptyProgress(curriculum)
    const c = card(p, 'vllm')
    expect(c.next.kind === 'task' || c.next.kind === 'prerequisite').toBe(true)
    if (c.next.kind === 'task') {
      expect(c.next.to).toBeGreaterThan(c.info.earned)
      expect(getAvailability(c.next.task, idx, p)).toBe('ready')
    }
  })

  it('asks to finish a task marked done before suggesting new ones', () => {
    const p = createEmptyProgress(curriculum)
    const target = card(p, 'vllm').tasks.find((r) => r.grants > 0)!
    p.tasks[target.task.id] = { status: 'completed', criteriaDone: [], notes: '', evidence: [] }
    expect(card(p, 'vllm').next).toMatchObject({ kind: 'verify', task: { id: target.task.id } })
  })

  it('leads through a prerequisite when the needed practice is locked', () => {
    const p = createEmptyProgress(curriculum)
    const locked = curriculum.tasks.find((t) => t.kind === 'lab' && missingPrerequisites(t, idx, p).length > 0)!
    const rows: SkillTaskRow[] = [{ task: locked, grants: 2, availability: 'locked', status: 'not_started', verified: false }]
    const info = { ...computeSkillLevels(curriculum, p).get(locked.vacancyRequirementIds[0])!, earned: 0 as const }
    const next = skillNextStep(rows, info, idx, p, order)
    expect(next.kind).toBe('prerequisite')
    if (next.kind === 'prerequisite') {
      expect(next.unlocks.id).toBe(locked.id)
      expect(getAvailability(next.task, idx, p)).toBe('ready')
    }
  })

  it('says that only production experience remains when every task is verified', () => {
    const p = createEmptyProgress(curriculum)
    for (const r of card(p, 'vllm').tasks) verify(p, r.task.id)
    const c = card(p, 'vllm')
    expect(c.tasks.every((r) => r.verified)).toBe(true)
    expect(c.next).toEqual({ kind: 'production' })
    expect(c.outcomes.every((o) => o.done)).toBe(true)
    const info = computeSkillLevels(curriculum, p).get('vllm')!
    expect(skillNextStep([], info, idx, p, order)).toEqual({ kind: 'none' })
  })

  it('suggests a stand of the skill when no task raises the level', () => {
    // у навыка linux нет задач программы, есть серверные стенды
    let p = createEmptyProgress(curriculum)
    p.meta.createdAt = '2026-10-08T10:00:00.000Z'
    const first = card(p, 'linux').next
    expect(first).toMatchObject({ kind: 'incident', to: 2 })
    if (first.kind !== 'incident') return
    const def = first.def
    p = normalizeProgress({ ...p, incidents: { [def.id]: { hintsShown: 0, startedAt: p.meta.createdAt,
      reports: [{ id: 'r', at: '2026-10-08T11:00:00.000Z', passed: true, source: 'auto', checks: def.checks.map((x) => ({ id: x.id, ok: true, message: 'OK' })) }] } } }, curriculum)
    expect(card(p, 'linux').info.earned).toBe(2)
    expect(card(p, 'linux').next).toEqual({ kind: 'none' })
  })
})
