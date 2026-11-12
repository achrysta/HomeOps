import { describe, expect, it } from 'vitest'
import { curriculum } from '../data'
import { DRILL_AREAS, DRILL_GROUPS } from '../data/drills'
import { drillGroup, drillLabel } from './drills'

describe('drill groups', () => {
  it('splits banks into MLOps-база and DevOps-база by area', () => {
    expect(drillGroup({ area: 'ml' })).toBe('mlops')
    expect(drillGroup({ area: 'infra' })).toBe('devops')
    expect(drillLabel({ area: 'ml', title: 'Serving' })).toBe('MLOps-база · Serving')
    expect(drillLabel({ area: 'data', title: 'Kafka' })).toBe('DevOps-база · Kafka')
  })

  it('assigns every area to a known group and every bank to a known area', () => {
    const groups = DRILL_GROUPS.map((g) => g.id)
    for (const area of DRILL_AREAS) expect(groups).toContain(area.group)
    for (const drill of curriculum.drills) expect(DRILL_AREAS.map((a) => a.id)).toContain(drill.area)
  })
})
