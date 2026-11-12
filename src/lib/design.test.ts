import { describe, expect, it } from 'vitest'
import { DESIGN_MIN_CHARS } from '../config/weights'
import { curriculum } from '../data'
import { reducer } from '../state/reducer'
import { canCheckDesign, designCoverage, designStatus, summarizeDesigns } from './design'
import { search } from './search'
import { createEmptyProgress, normalizeProgress } from './storage'

describe('system design cases', () => {
  it('cover every aspect with a reference outline and point to existing skills and incidents', () => {
    const aspectIds = curriculum.designAspects.map((a) => a.id)
    expect(new Set(aspectIds).size).toBe(aspectIds.length)
    const skills = new Set(curriculum.skills.map((s) => s.id))
    const incidents = new Set(curriculum.incidents.map((d) => d.id))
    const ids = curriculum.designCases.map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const c of curriculum.designCases) {
      expect(c.brief.length, c.id).toBeGreaterThan(60)
      expect(c.givens.length, c.id).toBeGreaterThanOrEqual(3)
      expect(c.pitfalls.length, c.id).toBeGreaterThanOrEqual(2)
      expect(Object.keys(c.outline).sort(), `${c.id}: разбор по всем аспектам и только по ним`).toEqual([...aspectIds].sort())
      for (const id of aspectIds) expect(c.outline[id].length, `${c.id}/${id}`).toBeGreaterThanOrEqual(3)
      for (const s of c.skillIds) expect(skills.has(s), `${c.id} skill ${s}`).toBe(true)
      for (const d of c.incidentIds) expect(incidents.has(d), `${c.id} incident ${d}`).toBe(true)
    }
  })
  it('links every case to its own «Собери архитектуру» exercise', () => {
    const arch = new Map(curriculum.exercises.flatMap((set) => set.exercises).filter((e) => e.kind === 'arch').map((e) => [e.id, e]))
    const used = curriculum.designCases.map((c) => c.exerciseId)
    for (const c of curriculum.designCases) expect(arch.has(c.exerciseId ?? ''), `${c.id}: упражнение-схема`).toBe(true)
    expect(new Set(used).size, 'у кейсов разные упражнения').toBe(used.length)
  })
})

describe('system design answers', () => {
  const caseId = 'sd-gateway'
  const longText = 'x'.repeat(DESIGN_MIN_CHARS)

  it('opens the reference only after an own answer and freezes the blind marks', () => {
    let p = createEmptyProgress(curriculum)
    expect(designStatus(p.interview.designs[caseId])).toBe('new')
    p = reducer(p, { type: 'design/text', caseId, text: 'коротко' })
    expect(designStatus(p.interview.designs[caseId])).toBe('draft')
    expect(canCheckDesign(p.interview.designs[caseId])).toBe(false)

    p = reducer(p, { type: 'design/aspect', caseId, aspectId: 'requirements', covered: true })
    p = reducer(p, { type: 'design/aspect', caseId, aspectId: 'scaling', covered: true })
    p = reducer(p, { type: 'design/aspect', caseId, aspectId: 'scaling', covered: false })
    p = reducer(p, { type: 'design/aspect', caseId, aspectId: 'cost', covered: true })
    p = reducer(p, { type: 'design/text', caseId, text: longText })
    expect(p.interview.designs[caseId].covered).toEqual(['requirements', 'cost'])
    expect(canCheckDesign(p.interview.designs[caseId])).toBe(true)

    p = reducer(p, { type: 'design/check', caseId })
    const checked = p.interview.designs[caseId]
    expect(designStatus(checked)).toBe('checked')
    expect(checked.coveredAfter).toEqual(['requirements', 'cost'])
    // после сверки меняется только оценка «после», отметки вслепую остаются
    p = reducer(p, { type: 'design/aspect', caseId, aspectId: 'cost', covered: false })
    p = reducer(p, { type: 'design/aspect', caseId, aspectId: 'failures', covered: true })
    expect(p.interview.designs[caseId].covered).toEqual(['requirements', 'cost'])
    expect(p.interview.designs[caseId].coveredAfter).toEqual(['requirements', 'failures'])
    expect(designCoverage(p.interview.designs[caseId], curriculum.designAspects.length)).toEqual({ before: 2, after: 2, total: curriculum.designAspects.length })
    // повторная сверка не сбрасывает оценку «после»
    expect(reducer(p, { type: 'design/check', caseId })).toBe(p)
    expect(summarizeDesigns(curriculum.designCases, p.interview.designs)).toEqual({ checked: 1, drafts: 0, total: curriculum.designCases.length })
  })

  it('finds own design answers in the local search', () => {
    const p = reducer(createEmptyProgress(curriculum), { type: 'design/text', caseId, text: 'Квоты храним в Redis, fail-open при отказе' })
    const hit = search('fail-open', curriculum, p).notes.find((n) => n.kind === 'design')
    expect(hit).toMatchObject({ designId: caseId })
  })

  it('normalizes design answers from a file and drops empty or broken ones', () => {
    const p = normalizeProgress(
      {
        interview: {
          designs: {
            a: { text: 'мой дизайн', covered: ['requirements', 'requirements', 7], coveredAfter: ['cost'], checkedAt: '2026-10-08T10:00:00Z', updatedAt: '2026-10-08T10:00:00Z' },
            b: { text: '', covered: [] },
            c: 'junk',
          },
        },
      },
      curriculum,
    )
    expect(p.interview.designs).toEqual({
      a: { text: 'мой дизайн', covered: ['requirements'], coveredAfter: ['cost'], checkedAt: '2026-10-08T10:00:00Z', updatedAt: '2026-10-08T10:00:00Z' },
    })
    expect(normalizeProgress({}, curriculum).interview.designs).toEqual({})
  })
})
