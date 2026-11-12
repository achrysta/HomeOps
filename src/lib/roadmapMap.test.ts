import { describe, expect, it } from 'vitest'
import { curriculum } from '../data'
import { buildIndex } from './progress'
import { roadmapTrack } from './roadmapMap'
import { createEmptyProgress } from './storage'

const index = buildIndex(curriculum)
describe('roadmap map', () => {
  it('provides a short work problem and entry requirements for every track', () => {
    for (const track of curriculum.tracks) {
      expect(track.workProblem?.trim().length, track.id).toBeGreaterThan(20)
      expect(track.workProblem?.match(/[.!?]/g)?.length, track.id).toBe(1)
      expect(track.entryRequirements?.every((s) => s.trim().length > 0), track.id).toBe(true)
      expect(track.entryRequirements?.length, track.id).toBeGreaterThan(0)
    }
  })
  it('does not count a manually completed lab without evidence as verified', () => {
    const progress = createEmptyProgress(curriculum)
    const task = index.taskById.get('A1')!
    progress.tasks.A1 = { status: 'completed', criteriaDone: [...task.acceptanceCriteria], evidence: [], notes: '' }
    progress.tasks.A2 = { status: 'in_progress', criteriaDone: [], evidence: [], notes: '' }
    const result = roadmapTrack(index.trackById.get('python')!, index, progress)
    expect(result.summary.verified).toBe(0)
    expect(result.summary.inProgress).toBe(1)
  })
  it('keeps excluded GPU tasks in total while excluding them from the percentage denominator', () => {
    const progress = createEmptyProgress(curriculum)
    const task = curriculum.tasks.find((t) => t.trackId === 'gpu' && t.environmentDependency && !t.optional)!
    progress.tasks[task.id] = { status: 'blocked', criteriaDone: [], evidence: [], notes: '' }
    const result = roadmapTrack(index.trackById.get('gpu')!, index, progress)
    expect(result.total).toBe(result.summary.taskCount + 1)
    expect(result.summary.envSkipped).toBe(1)
    expect(result.summary.verified).toBe(0)
  })
  it('separates optional tasks from the required track counters', () => {
    const progress = createEmptyProgress(curriculum)
    const track = index.trackById.get('llm-serving')!
    expect(roadmapTrack(track, index, progress).total).toBe((index.tasksByTrack.get(track.id) ?? []).filter((t) => !t.optional).length)
  })
})
