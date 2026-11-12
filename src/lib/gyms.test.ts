import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { GYM_INTERVAL_DAYS, MAX_GYM_SESSIONS } from '../config/weights'
import { curriculum } from '../data'
import { reducer } from '../state/reducer'
import type { GymDef, UserProgress } from '../types'
import { activeSession, bestSeconds, currentRep, gymCommands, gymDueAt, gymState, isFullSession, sessionSeconds } from './gyms'
import { createEmptyProgress, normalizeProgress } from './storage'
import { computeSkillLevels } from './progress'

const ROOT = path.resolve(__dirname, '../../incidents')
const DAY = 86_400_000
const T0 = Date.parse('2026-10-08T10:00:00Z')
const def: GymDef = curriculum.gyms[0]

/** Пройти сессию: start, затем подходы по очереди с шагом в минуту */
function session(p: UserProgress, at: number, reps = def.reps.length): UserProgress {
  vi.setSystemTime(at)
  p = reducer(p, { type: 'gym/start', gymId: def.id })
  for (let i = 0; i < reps; i++) {
    vi.setSystemTime(at + (i + 1) * 60_000)
    p = reducer(p, { type: 'gym/rep', def, sessionId: activeSession(p.gyms[def.id])!.id, repId: def.reps[i].id })
  }
  return p
}

describe('gym stands', () => {
  it.each(curriculum.gyms.map((g) => [g.id, g] as const))('%s: rep ids match live checks in incidents/%s', (id, g) => {
    const dir = path.join(ROOT, id)
    const compose = readFileSync(path.join(dir, 'compose.yaml'), 'utf8')
    expect(compose).toContain(`INCIDENT_ID: ${id}`)
    expect(/homeops\.role:\s*k8s/.test(compose)).toBe(g.topic === 'Kubernetes')
    expect(/homeops\.role:\s*server/.test(compose)).toBe(g.topic === 'Linux')
    expect(/homeops\.role:\s*compose-gym/.test(compose)).toBe(['MLflow', 'Airflow', 'LLM API'].includes(g.topic))
    // залы засчитываются живой проверкой: отчёты автопроверки в дашборд не отправляются
    expect(compose).toMatch(/DASHBOARD_URL:\s*"off"/)
    // подготовка: у Kubernetes — .setup/ рабочего места, у учебного сервера — setup/ (монтируется в сервер)
    expect(existsSync(path.join(dir, g.topic === 'Linux' ? 'setup' : '.setup', 'setup.sh'))).toBe(true)
    const checks = readFileSync(path.join(dir, 'checks.py'), 'utf8')
    const live = [...checks.matchAll(/@check\(\s*"([^"]+)"[^)]*live=True/g)].map((m) => m[1])
    expect(live, 'каждый подход — живая проверка, в том же порядке').toEqual(g.reps.map((r) => r.id))
    expect(g.reps.length).toBeGreaterThanOrEqual(3)
    for (const r of g.reps) {
      expect(r.task.length, `${id}/${r.id}`).toBeGreaterThan(30)
      expect(r.hint.length, `${id}/${r.id}`).toBeGreaterThan(15)
    }
  })

  it('gym namespaces do not clash with incident stands or each other', () => {
    const owner = new Map<string, string>()
    for (const id of [...curriculum.incidents.filter((d) => d.cluster).map((d) => d.id), ...curriculum.gyms.map((g) => g.id)]) {
      const compose = readFileSync(path.join(ROOT, id, 'compose.yaml'), 'utf8')
      for (const ns of /K8S_NAMESPACES:\s*(.+)/.exec(compose)?.[1].trim().split(/\s+/) ?? []) {
        expect(owner.get(ns), `namespace ${ns}: ${id} и ${owner.get(ns)}`).toBeUndefined()
        owner.set(ns, id)
      }
    }
    expect(new Set(curriculum.gyms.map((g) => g.id)).size).toBe(curriculum.gyms.length)
    for (const g of curriculum.gyms) expect(curriculum.incidents.some((d) => d.id === g.id), g.id).toBe(false)
  })
})

describe('gym commands without the labs service', () => {
  it.each(curriculum.gyms.map((g) => [g.id, g] as const))('%s: manual commands match its stand', (id, g) => {
    const cmds = gymCommands(g).map((c) => c.cmd)
    expect(cmds[0]).toBe(`cd incidents/${id}`)
    // живая проверка — та же, что опрашивает дашборд: показывает готовые подходы, но не засчитывает их
    expect(cmds.some((c) => c.includes('--live'))).toBe(true)
    expect(cmds.some((c) => c.includes(g.topic === 'Linux' ? 'exec server bash -l' : g.topic === 'Kubernetes' ? 'exec kubectl bash -l' : 'exec shell bash -l'))).toBe(true)
    expect(cmds.some((c) => c.includes('cluster up'))).toBe(g.topic === 'Kubernetes')
  })
})

describe('gym sessions', () => {
  it.each(['gym-airflow', 'gym-llm-api'])('%s: a completed session does not credit tasks or role skills', (id) => {
    const gym = curriculum.gyms.find((g) => g.id === id)!
    let p = createEmptyProgress(curriculum)
    const beforeTasks = p.tasks
    const beforeSkills = computeSkillLevels(curriculum, p)
    p = reducer(p, { type: 'gym/start', gymId: id })
    const sessionId = activeSession(p.gyms[id])!.id
    for (const rep of gym.reps) p = reducer(p, { type: 'gym/rep', def: gym, sessionId, repId: rep.id })
    expect(isFullSession(gym, p.gyms[id].sessions[0])).toBe(true)
    expect(p.tasks).toBe(beforeTasks)
    expect(computeSkillLevels(curriculum, p)).toEqual(beforeSkills)
  })
  it('counts only the current rep, in order, and finishes the session with the last one', () => {
    vi.useFakeTimers()
    let p = createEmptyProgress(curriculum)
    vi.setSystemTime(T0)
    p = reducer(p, { type: 'gym/start', gymId: def.id })
    const s = activeSession(p.gyms[def.id])!
    expect(currentRep(def, s)?.id).toBe(def.reps[0].id)
    // подход не по порядку не засчитывается: проверки следующих подходов могут проходить раньше времени
    expect(reducer(p, { type: 'gym/rep', def, sessionId: s.id, repId: def.reps[2].id })).toBe(p)
    // чужая сессия — тоже
    expect(reducer(p, { type: 'gym/rep', def, sessionId: 'other', repId: def.reps[0].id })).toBe(p)
    p = session(createEmptyProgress(curriculum), T0)
    const done = p.gyms[def.id].sessions[0]
    expect(done.finishedAt).toBeTruthy()
    expect(Object.keys(done.reps)).toEqual(def.reps.map((r) => r.id))
    expect(sessionSeconds(done)).toBe(def.reps.length * 60)
    expect(bestSeconds(def, p.gyms[def.id])).toBe(def.reps.length * 60)
    vi.useRealTimers()
  })

  it('returns by schedule after full sessions and the next day after an unfinished one', () => {
    vi.useFakeTimers()
    let p = session(createEmptyProgress(curriculum), T0)
    const end1 = Date.parse(p.gyms[def.id].sessions[0].finishedAt!)
    expect(gymDueAt(def, p.gyms[def.id])).toBe(end1 + GYM_INTERVAL_DAYS[0] * DAY)
    expect(gymState(def, p.gyms[def.id], end1 + 1000)).toBe('scheduled')
    expect(gymState(def, p.gyms[def.id], end1 + 2 * DAY)).toBe('due')
    p = session(p, end1 + 2 * DAY)
    const end2 = Date.parse(p.gyms[def.id].sessions[1].finishedAt!)
    expect(gymDueAt(def, p.gyms[def.id])).toBe(end2 + GYM_INTERVAL_DAYS[1] * DAY)
    // начатая и брошенная сессия: серия прервана, зал вернётся на следующий день
    p = session(p, end2 + 5 * DAY, 2)
    const s = activeSession(p.gyms[def.id])!
    expect(gymState(def, p.gyms[def.id], end2 + 5 * DAY)).toBe('active')
    vi.setSystemTime(end2 + 6 * DAY)
    p = reducer(p, { type: 'gym/finish', gymId: def.id, sessionId: s.id })
    expect(gymDueAt(def, p.gyms[def.id])).toBe(end2 + 7 * DAY)
    vi.useRealTimers()
  })

  it('pauses a gym and starts a new session by closing the unfinished one', () => {
    let p = createEmptyProgress(curriculum)
    expect(gymState(def, p.gyms[def.id], T0)).toBe('new')
    p = reducer(p, { type: 'gym/pause', gymId: def.id, paused: true })
    expect(gymState(def, p.gyms[def.id], T0)).toBe('paused')
    expect(gymDueAt(def, p.gyms[def.id])).toBeNull()
    p = reducer(p, { type: 'gym/pause', gymId: def.id, paused: false })
    p = reducer(p, { type: 'gym/start', gymId: def.id })
    p = reducer(p, { type: 'gym/start', gymId: def.id })
    expect(p.gyms[def.id].sessions).toHaveLength(2)
    expect(p.gyms[def.id].sessions[0].finishedAt).toBeTruthy()
    expect(activeSession(p.gyms[def.id])?.id).toBe(p.gyms[def.id].sessions[1].id)
  })

  it('normalizes gyms from a file: broken sessions are dropped, history is bounded', () => {
    const at = new Date(T0).toISOString()
    const sessions = Array.from({ length: MAX_GYM_SESSIONS + 5 }, (_, i) => ({ id: `s${i}`, startedAt: at, finishedAt: at, reps: { create: at, bad: 'nope' } }))
    const p = normalizeProgress({ gyms: { [def.id]: { sessions: [...sessions, { id: '', startedAt: at }, { id: 'x', startedAt: 'never' }], paused: 'yes' }, junk: 5 } }, curriculum)
    expect(p.gyms[def.id].sessions).toHaveLength(MAX_GYM_SESSIONS)
    expect(p.gyms[def.id].sessions[0].reps).toEqual({ create: at })
    expect(p.gyms[def.id].paused).toBeUndefined()
    expect(p.gyms.junk).toBeUndefined()
  })
})
