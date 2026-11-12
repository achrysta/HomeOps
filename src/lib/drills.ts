import { DRILL_AREAS, DRILL_GROUPS } from '../data/drills/areas'
import type { Drill, DrillGroup } from '../types'

/** Группа банка повторения: MLOps-база или DevOps-база (по разделу area). */
export function drillGroup(drill: Pick<Drill, 'area'>): DrillGroup {
  return DRILL_AREAS.find((a) => a.id === drill.area)?.group ?? 'devops'
}

export function drillGroupTitle(group: DrillGroup): string {
  return DRILL_GROUPS.find((g) => g.id === group)?.title ?? group
}

/** Подпись темы банка: «MLOps-база · Serving» */
export const drillLabel = (drill: Pick<Drill, 'area' | 'title'>) => `${drillGroupTitle(drillGroup(drill))} · ${drill.title}`
