import { describe, expect, it } from 'vitest'
import { curriculum } from '../data'

const ids = <T extends { id: string }>(xs: T[]) => xs.map((x) => x.id)
const dupes = (xs: string[]) => xs.filter((x, i) => xs.indexOf(x) !== i)

describe('curriculum integrity', () => {
  it('has unique ids', () => {
    expect(dupes(ids(curriculum.tasks))).toEqual([])
    expect(dupes(ids(curriculum.tracks))).toEqual([])
    expect(dupes(ids(curriculum.skills))).toEqual([])
    expect(dupes(ids(curriculum.resources))).toEqual([])
    expect(dupes(curriculum.interviewTopics.flatMap((t) => ids(t.questions)))).toEqual([])
  })

  it('references only existing entities', () => {
    const tasks = new Set(ids(curriculum.tasks))
    const tracks = new Set(ids(curriculum.tracks))
    const skills = new Set(ids(curriculum.skills))
    const resources = new Set(ids(curriculum.resources))
    for (const t of curriculum.tasks) {
      expect(tracks.has(t.trackId), `${t.id}.trackId`).toBe(true)
      for (const p of t.prerequisites) expect(tasks.has(p), `${t.id} prereq ${p}`).toBe(true)
      for (const r of t.resourceIds) expect(resources.has(r), `${t.id} resource ${r}`).toBe(true)
      for (const s of t.vacancyRequirementIds) expect(skills.has(s), `${t.id} skill ${s}`).toBe(true)
      expect(t.acceptanceCriteria.length, `${t.id} criteria`).toBeGreaterThan(0)
    }
    for (const v of curriculum.vacancies) {
      for (const r of v.requirements) expect(skills.has(r.skillId), `${v.id} → ${r.skillId}`).toBe(true)
    }
    for (const topic of curriculum.interviewTopics) {
      for (const s of topic.skillIds) expect(skills.has(s), `${topic.id} skill ${s}`).toBe(true)
      for (const tr of topic.trackIds) expect(tracks.has(tr), `${topic.id} track ${tr}`).toBe(true)
    }
  })

  it('has an acyclic dependency graph', () => {
    const byId = new Map(curriculum.tasks.map((t) => [t.id, t]))
    const state = new Map<string, 'visiting' | 'done'>()
    const visit = (id: string, path: string[]) => {
      if (state.get(id) === 'done') return
      if (state.get(id) === 'visiting') throw new Error(`cycle: ${[...path, id].join(' → ')}`)
      state.set(id, 'visiting')
      for (const p of byId.get(id)!.prerequisites) visit(p, [...path, id])
      state.set(id, 'done')
    }
    expect(() => curriculum.tasks.forEach((t) => visit(t.id, []))).not.toThrow()
  })

  it('never makes the fundamentals book or advanced tasks a prerequisite of core work', () => {
    const nonCore = new Set(
      curriculum.tasks
        .filter((t) => curriculum.tracks.find((tr) => tr.id === t.trackId)?.kind !== 'core')
        .map((t) => t.id),
    )
    for (const t of curriculum.tasks) {
      for (const p of t.prerequisites) {
        if (nonCore.has(p)) expect(nonCore.has(t.id), `${t.id} depends on ${p}`).toBe(true)
      }
    }
  })

  it('keeps advanced skills out of non-advanced requirement categories', () => {
    for (const v of curriculum.vacancies) {
      for (const r of v.requirements) {
        if (r.skillId.startsWith('adv-')) expect(r.importance).toBe('advanced')
      }
    }
  })

  it('uses https links for all resources', () => {
    for (const r of curriculum.resources) {
      expect(r.url, r.id).toMatch(/^https:\/\//)
      if (r.ru) expect(r.ru.url, `${r.id}.ru`).toMatch(/^https:\/\//)
    }
  })

  it('gives every core task at least one material in Russian', () => {
    const byId = new Map(curriculum.resources.map((r) => [r.id, r]))
    const core = curriculum.tasks.filter((t) => curriculum.tracks.find((tr) => tr.id === t.trackId)?.kind === 'core' && !t.optional)
    const missing = core.filter((t) => !t.resourceIds.some((id) => byId.get(id)?.language === 'ru' || byId.get(id)?.ru))
    expect(missing.map((t) => t.id)).toEqual([])
  })

  it('gives every core practical task a step-by-step plan', () => {
    const practical = curriculum.tasks.filter(
      (t) => curriculum.tracks.find((tr) => tr.id === t.trackId)?.kind === 'core' && ['exercise', 'lab', 'integration'].includes(t.kind),
    )
    expect(practical.filter((t) => !t.steps?.length).map((t) => t.id)).toEqual([])
    for (const t of practical) expect(t.steps!.length, t.id).toBeGreaterThanOrEqual(4)
  })

  it('has no step plans for unknown tasks', async () => {
    const { labSteps } = await import('../data/labSteps')
    const ids = new Set(curriculum.tasks.map((t) => t.id))
    expect(Object.keys(labSteps).filter((id) => !ids.has(id))).toEqual([])
  })

  it('covers every core track with at least one lab', () => {
    for (const track of curriculum.tracks.filter((t) => t.kind === 'core')) {
      const labs = curriculum.tasks.filter((t) => t.trackId === track.id && (t.kind === 'lab' || t.kind === 'integration'))
      expect(labs.length, track.id).toBeGreaterThan(0)
    }
  })
})
