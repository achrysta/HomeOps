import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { packs } from '../src/data/packs'
import { readCatalogData, packMetadata, readPack } from './packMetadata'
import { needsFullContent } from './taskCatalogPlugin'

describe('startup pack catalog', () => {
  it.each(packs)('$id: parses data without losing constructor defaults or verification fields', (pack) => {
    const source = readFileSync(new URL(`../src/data/packs/${pack.id}/pack.ts`, import.meta.url), 'utf8')
    expect(readPack(source)).toEqual(pack)
    const meta = packMetadata(pack)
    expect(meta.requirements).toEqual(pack.requirements)
    expect(meta.taskEstimates).toEqual(pack.taskEstimates)
    for (const task of meta.tasks ?? []) {
      const full = pack.tasks!.find((t) => t.id === task.id)!
      expect({ ...task, description: full.description }).toEqual(full)
    }
    for (const topic of meta.interviewTopics ?? []) {
      const full = pack.interviewTopics!.find((t) => t.id === topic.id)!
      expect(topic.questions.map((q) => ({ ...q, points: full.questions.find((f) => f.id === q.id)!.points, pitfall: full.questions.find((f) => f.id === q.id)!.pitfall }))).toEqual(full.questions)
    }
  })
  it('parses exercise and design literals without changing the schema', async () => {
    const { exerciseSets } = await import('../src/data/exercises')
    const { designAspects, designCases } = await import('../src/data/systemDesign')
    const read = (file: string) => readFileSync(new URL(`../src/data/${file}.ts`, import.meta.url), 'utf8')
    expect(readCatalogData(read('exercises'), 'exerciseSets')).toEqual(exerciseSets)
    expect(readCatalogData(read('systemDesign'), 'designCases')).toEqual(designCases)
    expect(readCatalogData(read('systemDesign'), 'designAspects')).toEqual(designAspects)
  })
  it('refuses execution of arbitrary expressions and preserves lazy boundaries', () => {
    expect(() => readPack('export const pack = fetch("https://example.com")')).toThrow('неподдерживаемое')
    expect(needsFullContent('/app/src/pages/InterviewPage.tsx')).toBe(true)
    expect(needsFullContent('/app/src/components/TaskDrawer.tsx')).toBe(true)
    for (const path of ['pages/DashboardPage', 'components/Layout', 'components/TodayPlan', 'components/ProgressAvailability']) expect(needsFullContent(`/app/src/${path}.tsx`)).toBe(false)
  })
})
