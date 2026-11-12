import { describe, expect, it } from 'vitest'
import { curriculum } from '../data'
import { reducer } from '../state/reducer'
import type { UserProgress } from '../types'
import {
  EMPTY_PRACTICE_FILTERS,
  filterPractice,
  practiceItems,
  practiceTopics,
  startHere,
} from './practice'
import { buildIndex, getAvailability, isPracticeTask } from './progress'
import { createEmptyProgress, normalizeProgress } from './storage'

const idx = buildIndex(curriculum)
const items = (p: UserProgress) => practiceItems(curriculum, idx, p)
const solve = (p: UserProgress, id: string) => {
  p.meta.createdAt = '2026-10-08T10:00:00.000Z'
  const at = '2026-10-08T12:00:00.000Z'
  p.incidents[id] = {
    hintsShown: 0,
    startedAt: at,
    solvedAt: at,
    reports: [
      {
        id: 'r',
        at,
        passed: true,
        checks: curriculum.incidents
          .find((d) => d.id === id)!
          .checks.map((c) => ({ id: c.id, ok: true, message: '' })),
        source: 'auto',
      },
    ],
  }
}
const verifyTask = (p: UserProgress, id: string) => {
  const t = idx.taskById.get(id)!
  p.tasks[id] = {
    status: 'completed',
    criteriaDone: [...t.acceptanceCriteria],
    notes: '',
    evidence: [{ id: 'e', type: 'commit', value: 'abc', createdAt: '2026-10-08T10:00:00Z' }],
  }
}

describe('practice model', () => {
  it('joins practice tasks and incidents, without reading and quizzes', () => {
    const list = items(createEmptyProgress(curriculum))
    expect(list.filter((i) => i.format === 'task').length).toBe(
      curriculum.tasks.filter(isPracticeTask).length,
    )
    expect(list.filter((i) => i.format === 'incident').length).toBe(curriculum.incidents.length)
    expect(list.every((i) => i.status === 'todo' && !i.saved)).toBe(true)
  })

  it('marks only verified tasks and solved incidents as done', () => {
    const p = createEmptyProgress(curriculum)
    const ready = curriculum.tasks.find(
      (t) => isPracticeTask(t) && getAvailability(t, idx, p) === 'ready',
    )!
    p.tasks[ready.id] = { status: 'completed', criteriaDone: [], notes: '', evidence: [] }
    solve(p, 'k8s-rollout')
    p.incidents['k8s-probes'] = { hintsShown: 1, reports: [] }
    const byId = new Map(items(p).map((i) => [i.id, i]))
    // «Выполнено» без критериев и подтверждения — в работе, а не засчитано
    expect(byId.get(ready.id)!.status).toBe('in_progress')
    expect(byId.get('k8s-rollout')!.status).toBe('done')
    expect(byId.get('k8s-probes')!.status).toBe('in_progress')
    verifyTask(p, ready.id)
    expect(items(p).find((i) => i.id === ready.id)!.status).toBe('done')
  })

  it('counts done of total per topic, DevOps topics after the tracks', () => {
    const p = createEmptyProgress(curriculum)
    solve(p, 'k8s-rollout')
    const topics = practiceTopics(idx, items(p))
    const k8s = topics.find((t) => t.id === 'devops:Kubernetes')!
    expect(k8s).toMatchObject({
      title: 'Kubernetes',
      done: 1,
      total: curriculum.incidents.filter((d) => d.topic === 'Kubernetes').length,
    })
    const ids = topics.map((t) => t.id)
    expect(ids.findIndex((id) => id.startsWith('devops:'))).toBeGreaterThan(
      ids.findLastIndex((id) => id.startsWith('track:')),
    )
    expect(topics.find((t) => t.id.startsWith('track:'))!.code).toBeTruthy()
  })

  it('starts with work in progress, then saved, never with locked or done', () => {
    let p = createEmptyProgress(curriculum)
    const first = startHere(items(p))!
    expect(first.locked || first.blocked || first.status === 'done').toBe(false)
    p = reducer(p, { type: 'saved/toggle', kind: 'incident', id: 'k8s-hpa-pdb' })
    expect(startHere(items(p))!.id).toBe('k8s-hpa-pdb')
    p.incidents['linux-disk-full'] = {
      hintsShown: 0,
      startedAt: '2026-10-08T10:00:00Z',
      reports: [],
    }
    expect(startHere(items(p))!.id).toBe('linux-disk-full')
    expect(startHere(items(p), 'devops:Docker')!.topicId).toBe('devops:Docker')
    for (const i of items(p).filter(
      (x) => x.format === 'incident' && x.topicId === 'devops:Docker',
    ))
      solve(p, i.id)
    expect(startHere(items(p), 'devops:Docker')).toBeUndefined()
  })

  it('filters by status, format, topic and saved', () => {
    let p = createEmptyProgress(curriculum)
    solve(p, 'k8s-rollout')
    p = reducer(p, {
      type: 'saved/toggle',
      kind: 'task',
      id: items(p).find((i) => i.format === 'task')!.id,
    })
    const list = items(p)
    expect(
      filterPractice(list, { ...EMPTY_PRACTICE_FILTERS, status: 'done' }).map((i) => i.id),
    ).toEqual(['k8s-rollout'])
    expect(filterPractice(list, { ...EMPTY_PRACTICE_FILTERS, status: 'saved' })).toHaveLength(1)
    expect(
      filterPractice(list, { ...EMPTY_PRACTICE_FILTERS, format: 'incident' }).every(
        (i) => i.format === 'incident',
      ),
    ).toBe(true)
    expect(
      filterPractice(list, { ...EMPTY_PRACTICE_FILTERS, topic: 'devops:Linux' }).every(
        (i) => i.topicId === 'devops:Linux',
      ),
    ).toBe(true)
  })
})

describe('saved items', () => {
  it('toggles a bookmark and normalizes saved items from a file', () => {
    let p = createEmptyProgress(curriculum)
    p = reducer(p, { type: 'saved/toggle', kind: 'resource', id: 'r1' })
    expect(p.saved).toMatchObject([{ kind: 'resource', id: 'r1' }])
    p = reducer(p, { type: 'saved/toggle', kind: 'resource', id: 'r1' })
    expect(p.saved).toEqual([])
    const n = normalizeProgress(
      {
        saved: [
          { kind: 'task', id: 'A1', at: '2026-10-08T10:00:00Z' },
          { kind: 'task', id: 'A1' },
          { kind: 'video', id: 'x' },
          'junk',
        ],
      },
      curriculum,
    )
    expect(n.saved).toEqual([{ kind: 'task', id: 'A1', at: '2026-10-08T10:00:00Z' }])
    expect(normalizeProgress({}, curriculum).saved).toEqual([])
  })
})
