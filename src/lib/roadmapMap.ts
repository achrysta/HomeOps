import type { CurriculumIndex } from './progress'
import { summarize, tasksForTrackProgress, trackDependencies } from './progress'
import type { Track, UserProgress } from '../types'

export function roadmapTrack(track: Track, index: CurriculumIndex, progress: UserProgress) {
  const tasks = tasksForTrackProgress(track, index)
  return { total: tasks.length, summary: summarize(tasks, progress), dependencies: trackDependencies(track, index) }
}
