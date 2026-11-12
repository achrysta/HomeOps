import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { curriculum } from '../data'
import { reducer } from '../state/reducer'
import { createEmptyProgress } from './storage'
import type { IncidentProgress, IncidentReport } from '../types'
import {
  ckaCoverage,
  emptyIncident,
  groupByTopic,
  incidentStatusFor,
  confirmedIncident,
  mergeIncidentReports,
  MAX_INCIDENT_REPORTS,
  parseIncidentReport,
} from './incidents'

const ROOT = path.resolve(__dirname, '../../incidents')
const skillIds = new Set(curriculum.skills.map((s) => s.id))
const taskIds = new Set(curriculum.tasks.map((t) => t.id))
const trackIds = new Set(curriculum.tracks.map((t) => t.id))

const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((n) => {
    const p = path.join(dir, n)
    return statSync(p).isDirectory() ? files(p).map((f) => path.join(n, f)) : [n]
  })

describe('incident stands', () => {
  it('init scripts of postgres images are executable', () => {
    // Docker Desktop на Mac (fakeowner) отвечает «да» на test -x для файла 644, но запустить его не даёт:
    // docker-entrypoint.sh пытается исполнить скрипт и падает с кодом 126. Скрипты initdb — только 755.
    for (const id of readdirSync(ROOT)) {
      const composePath = path.join(ROOT, id, 'compose.yaml')
      if (!existsSync(composePath)) continue
      for (const m of readFileSync(composePath, 'utf8').matchAll(/\.\/([^:\s]+):\/docker-entrypoint-initdb\.d/g)) {
        const dir = path.join(ROOT, id, m[1])
        for (const f of files(dir).filter((f) => f.endsWith('.sh'))) {
          expect(statSync(path.join(dir, f)).mode & 0o111, `${id}/${m[1]}/${f}: нужен chmod +x`).not.toBe(0)
          const original = path.join(ROOT, id, '.original', m[1], f)
          if (existsSync(original)) expect(statSync(original).mode & 0o111, `${id}/.original/${m[1]}/${f}: нужен chmod +x`).not.toBe(0)
        }
      }
    }
  })

  it.each(curriculum.incidents.map((d) => [d.id, d] as const))(
    '%s: definition matches incidents/%s',
    (id, def) => {
      const dir = path.join(ROOT, id)
      expect(existsSync(path.join(dir, 'compose.yaml'))).toBe(true)
      const compose = readFileSync(path.join(dir, 'compose.yaml'), 'utf8')
      expect(compose).toContain(`INCIDENT_ID: ${id}`)
      expect(
        /homeops\.role:\s*server/.test(compose),
        `${id}: метка сервера совпадает с флагом server`,
      ).toBe(!!def.server)
      expect(/homeops\.role:\s*k8s/.test(compose), `${id}: метка k8s совпадает с флагом cluster`).toBe(
        !!def.cluster,
      )
      expect(
        /homeops\.cluster:\s*exclusive/.test(compose),
        `${id}: метка стенда уровня кластера совпадает с nodeAccess`,
      ).toBe(!!def.nodeAccess)
      if (def.nodeAccess) {
        expect(def.cluster, `${id}: стенд уровня кластера живёт в кластере kind`).toBe(true)
        expect(
          files(path.join(dir, '.setup')).some((f) => /^node-(control-plane|worker)\.sh$/.test(f)),
          `${id}: поломку в узлах готовит .setup/node-<узел>.sh`,
        ).toBe(true)
      }
      if (def.server) {
        // учебный сервер: поломку готовит setup.sh, проверка — verify внутри сервера, сброс — пересоздание
        expect(existsSync(path.join(dir, 'setup', 'setup.sh'))).toBe(true)
      } else if (def.cluster) {
        // Kubernetes-стенд: рабочее место с kubectl в сети kind, namespace из K8S_NAMESPACES, поломку готовит .setup/setup.sh
        for (const svc of [
          'kubectl:',
          'verify:',
          'reset:',
          'K8S_NAMESPACES:',
          'name: kind',
          'name: homeops-k8s-kubeconfig',
        ])
          expect(compose, `${id}: ${svc}`).toContain(svc)
        expect(existsSync(path.join(dir, '.setup', 'setup.sh'))).toBe(true)
        if (def.category === 'devops') {
          expect(def.topic).toBe('Kubernetes')
          expect(def.cka?.length, `${id}: домены CKA`).toBeGreaterThan(0)
        } else {
          // MLOps-стенд привязан к треку; CKA-домены допустимы, но не обязательны.
          expect(def.trackId, `${id}: трек MLOps-стенда`).toBeTruthy()
          expect(trackIds.has(def.trackId!), `${id}: существующий трек MLOps`).toBe(true)
        }
      } else {
        for (const svc of ['verify:', 'reset:', 'shell:']) expect(compose).toContain(svc)
      }

      // id проверок в checks.py совпадают с описанием в дашборде и идут в том же порядке
      const checksPy = readFileSync(path.join(dir, 'checks.py'), 'utf8')
      const ids = [...checksPy.matchAll(/@check\(\s*"([^"]+)"/g)].map((m) => m[1])
      expect(ids).toEqual(def.checks.map((c) => c.id))

      // сброс возвращает файлы из .original, и каждый из них есть в стенде. Без .original — только серверные стенды
      // и стенды уровня кластера без файлов для правки (всё ломается и чинится на узле, сброс пересоздаёт кластер)
      const original = path.join(dir, '.original')
      if (def.server || (def.nodeAccess && !existsSync(path.join(dir, 'manifests')))) return
      expect(existsSync(original)).toBe(true)
      const originals = files(original)
      expect(originals.length).toBeGreaterThan(0)
      // .exact — список папок, которые сброс делает точной копией .original; сам файл в стенд не копируется
      for (const f of originals.filter((f) => f !== '.exact'))
        expect(existsSync(path.join(dir, f)), `${id}/${f}`).toBe(true)
    },
  )

  it('Kubernetes stands use their own namespaces in the shared cluster', () => {
    const owner = new Map<string, string>()
    for (const d of curriculum.incidents.filter((x) => x.cluster)) {
      const compose = readFileSync(path.join(ROOT, d.id, 'compose.yaml'), 'utf8')
      const namespaces = /K8S_NAMESPACES:\s*(.+)/.exec(compose)?.[1].trim().split(/\s+/) ?? []
      expect(namespaces.length, d.id).toBeGreaterThan(0)
      expect(
        /K8S_NAMESPACE:\s*(\S+)/.exec(compose)?.[1],
        `${d.id}: рабочий namespace — первый из K8S_NAMESPACES`,
      ).toBe(namespaces[0])
      for (const ns of namespaces) {
        expect(owner.get(ns), `namespace ${ns} занят стендом ${owner.get(ns)}`).toBeUndefined()
        owner.set(ns, d.id)
      }
      // манифесты указывают namespace явно и только свои
      for (const f of existsSync(path.join(ROOT, d.id, 'manifests'))
        ? files(path.join(ROOT, d.id, 'manifests'))
        : []) {
        for (const m of readFileSync(path.join(ROOT, d.id, 'manifests', f), 'utf8').matchAll(
          /^\s+namespace:\s*(\S+)/gm,
        ))
          expect(namespaces, `${d.id}/${f}`).toContain(m[1])
      }
    }
  })

  it('keeps constraints separate from the goal and short', () => {
    for (const d of curriculum.incidents) {
      for (const c of d.constraints ?? []) {
        expect(c.trim().length, d.id).toBeGreaterThan(20)
        expect(c.length, `${d.id}: ограничение — одно предложение`).toBeLessThanOrEqual(200)
        // ограничение не повторяет цель: в цели — итоговое состояние, в ограничениях — чего нельзя делать
        expect(d.goal.includes(c.slice(0, 40)), `${d.id}: ограничение повторяет цель`).toBe(false)
      }
    }
    expect(curriculum.incidents.filter((d) => d.constraints?.length).length).toBeGreaterThan(0)
  })

  it('definitions are complete and reference existing curriculum entities', () => {
    const seen = new Set<string>()
    for (const d of curriculum.incidents) {
      expect(seen.has(d.id), d.id).toBe(false)
      seen.add(d.id)
      if (d.category === 'mlops') expect(d.trackId && trackIds.has(d.trackId), d.id).toBe(true)
      else expect(d.topic, d.id).toBeTruthy()
      expect(d.hints.length, d.id).toBeGreaterThanOrEqual(2)
      expect(d.checks.length, d.id).toBeGreaterThan(0)
      expect(
        d.scenario && d.goal && d.debrief.cause && d.debrief.fix && d.debrief.lesson,
        d.id,
      ).toBeTruthy()
      for (const s of d.skillIds) expect(skillIds.has(s), `${d.id}: skill ${s}`).toBe(true)
      for (const t of d.relatedTaskIds) expect(taskIds.has(t), `${d.id}: task ${t}`).toBe(true)
    }
  })
})

const def = curriculum.incidents.find((d) => d.id === 'sse-streaming')!
const rawReport = (over: Record<string, unknown> = {}) => ({
  format: 'homeops-incident-report',
  id: 'r-1',
  incidentId: 'sse-streaming',
  at: '2026-10-07T10:00:00Z',
  passed: true,
  checks: def.checks.map((c) => ({ id: c.id, title: c.title, ok: true, message: 'ok' })),
  env: { arch: 'aarch64' },
  ...over,
})
const parse = (raw: unknown) => {
  const r = parseIncidentReport(raw, curriculum.incidents, 'auto')
  if ('error' in r) throw new Error(r.error)
  return r.report
}

describe('incident reports', () => {
  const minimal = { ...def, checks: [{ id: 'ttft', title: 'TTFT' }] }
  const state = (ip: IncidentProgress) => {
    const p = createEmptyProgress(curriculum)
    p.meta.createdAt = '2026-10-01T00:00:00Z'
    p.incidents[def.id] = ip
    return p
  }

  it('decides "solved" from the curriculum checks, not from the report flag', () => {
    expect(parse(rawReport()).passed).toBe(true)
    // проверка из описания отсутствует в отчёте (старая версия стенда) — не решено, даже если passed: true
    expect(parse(rawReport({ checks: [{ id: 'ttft', ok: true, message: '' }] })).passed).toBe(false)
    // лишние проверки игнорируются
    const extra = rawReport({
      checks: [...rawReport().checks, { id: 'unknown', ok: false, message: '' }],
    })
    expect(parse(extra).passed).toBe(true)
    expect(parse(rawReport()).arch).toBe('aarch64')
  })

  it('rejects foreign files', () => {
    expect(
      parseIncidentReport(
        { format: 'homeops-progress' },
        curriculum.incidents,
        'upload',
      ),
    ).toHaveProperty('error')
    expect(
      parseIncidentReport(rawReport({ incidentId: 'nope' }), curriculum.incidents, 'upload'),
    ).toHaveProperty('error')
    expect(
      parseIncidentReport(rawReport({ checks: [] }), curriculum.incidents, 'upload'),
    ).toHaveProperty('error')
  })

  it('merges without duplicates, keeps the first passing report and records solvedAt', () => {
    const fail = (i: number): IncidentReport => ({
      id: `f${i}`,
      at: `2026-10-07T11:${String(i).padStart(2, '0')}:00.000Z`,
      passed: false,
      checks: [{ id: 'ttft', ok: false, message: '' }],
      source: 'auto',
    })
    const pass: IncidentReport = {
      id: 'p',
      at: '2026-10-07T10:30:00.000Z',
      passed: true,
      checks: [{ id: 'ttft', ok: true, message: '' }],
      source: 'auto',
    }
    let ip = mergeIncidentReports(emptyIncident(), [pass])
    expect(ip.solvedAt).toBe(pass.at)
    expect(mergeIncidentReports(ip, [pass])).toBe(ip)
    ip = mergeIncidentReports(
      ip,
      Array.from({ length: MAX_INCIDENT_REPORTS + 5 }, (_, i) => fail(i)),
    )
    expect(ip.reports).toHaveLength(MAX_INCIDENT_REPORTS)
    expect(ip.reports[0].id).toBe('p')
    expect(incidentStatusFor(minimal, state(ip))).toBe('solved')
  })

  it('ignores reports from before a progress reset', () => {
    const old: IncidentReport = {
      id: 'old',
      at: '2026-10-01T10:00:00.000Z',
      passed: true,
      checks: [{ id: 'ttft', ok: true, message: '' }],
      source: 'auto',
    }
    const ip = mergeIncidentReports(emptyIncident(), [old], '2026-10-05T00:00:00.000Z')
    expect(ip.reports).toHaveLength(0)
    expect(incidentStatusFor(minimal, state(ip))).toBe('not_started')
  })

  it('marks a solve made after opening the debrief', () => {
    const ip = {
      ...emptyIncident(),
      reports: [
        {
          id: 'pass',
          at: '2026-10-07T12:00:00Z',
          passed: true,
          source: 'auto' as const,
          checks: [{ id: 'ttft', ok: true, message: '' }],
        },
      ],
    }
    expect(
      confirmedIncident(minimal, state({ ...ip, debriefOpenedAt: '2026-10-07T11:00:00Z' }))
        ?.independent,
    ).toBe(false)
    expect(
      confirmedIncident(minimal, state({ ...ip, debriefOpenedAt: '2026-10-07T13:00:00Z' }))
        ?.independent,
    ).toBe(true)
  })
})

describe('incident progress in the reducer', () => {
  it('does not change progress when polling reports already removed by the history cap', () => {
    const p = createEmptyProgress(curriculum)
    p.meta.createdAt = new Date(Date.now() - 60_000).toISOString()
    const reports: IncidentReport[] = Array.from({ length: MAX_INCIDENT_REPORTS + 5 }, (_, i) => ({
      id: `report-${i}`,
      at: new Date(Date.parse(p.meta.createdAt) + (i + 1) * 1000).toISOString(),
      passed: i === 0,
      checks: def.checks.map((c) => ({ id: c.id, ok: i === 0, message: '' })),
      source: 'auto',
    }))
    const action = { type: 'incident/reports' as const, reports: { [def.id]: reports } }
    const first = reducer(p, action)
    expect(first.incidents[def.id].reports).toHaveLength(MAX_INCIDENT_REPORTS)
    expect(first.incidents[def.id].solvedAt).toBe(reports[0].at)
    expect(reducer(first, action)).toBe(first)
    // Новый отчёт продолжает приниматься, несмотря на ограничение истории.
    const latest = {
      ...reports.at(-1)!,
      id: 'new-report',
      at: new Date(Date.parse(reports.at(-1)!.at) + 1000).toISOString(),
    }
    const next = reducer(first, { ...action, reports: { [def.id]: [...reports, latest] } })
    expect(next.incidents[def.id].reports.at(-1)?.id).toBe(latest.id)
    expect(reducer(next, { ...action, reports: { [def.id]: [...reports, latest] } })).toBe(next)
  })

  it('deduplicates repeated ids within one report batch', () => {
    const report = parse(rawReport())
    expect(mergeIncidentReports(emptyIncident(), [report, report]).reports).toHaveLength(1)
  })

  it('caps hints and records start, debrief and reports without touching unrelated state', () => {
    let p = createEmptyProgress(curriculum)
    for (let i = 0; i < 5; i++)
      p = reducer(p, { type: 'incident/hint', id: 'sse-streaming', max: 3 })
    expect(p.incidents['sse-streaming'].hintsShown).toBe(3)
    expect(p.incidents['sse-streaming'].startedAt).toBeTruthy()

    const later = new Date(Date.now()).toISOString()
    const report: IncidentReport = {
      id: 'r',
      at: later,
      passed: true,
      checks: def.checks.map((c) => ({ id: c.id, ok: true, message: '' })),
      source: 'auto',
    }
    p = reducer(p, { type: 'incident/reports', reports: { 'sse-streaming': [report] } })
    expect(incidentStatusFor(def, p)).toBe('solved')
    // повторный приход тех же отчётов (опрос сервера) не меняет прогресс
    expect(reducer(p, { type: 'incident/reports', reports: { 'sse-streaming': [report] } })).toBe(p)
  })
})

describe('incident grouping and CKA coverage', () => {
  it('groups by topic in order of appearance', () => {
    const groups = groupByTopic(curriculum.incidents.filter((d) => d.category === 'devops'))
    expect(groups.map(([t]) => t)).toEqual(['Linux', 'Docker', 'Kubernetes', 'PostgreSQL', 'Redis', 'CI/CD'])
    expect(
      groupByTopic(curriculum.incidents.filter((d) => d.category === 'mlops')).map(([t]) => t),
    ).toEqual([''])
  })

  it('counts incidents and solved ones per CKA domain', () => {
    const progress = createEmptyProgress(curriculum)
    const before = ckaCoverage(curriculum.incidents, progress)
    expect(before.map((c) => c.domain)).toEqual([
      'troubleshooting',
      'cluster',
      'networking',
      'workloads',
      'storage',
    ])
    const troubleshooting = before.find((c) => c.domain === 'troubleshooting')!
    expect(troubleshooting.total).toBe(
      curriculum.incidents.filter((d) => d.cka?.includes('troubleshooting')).length,
    )
    expect(troubleshooting.solved).toBe(0)
    progress.meta.createdAt = '2026-10-07T10:00:00Z'
    progress.incidents['k8s-crashloop'] = {
      ...emptyIncident(),
      solvedAt: '2026-10-07T12:00:00Z',
      reports: [
        {
          id: 'r',
          at: '2026-10-07T12:00:00Z',
          passed: true,
          checks: curriculum.incidents
            .find((d) => d.id === 'k8s-crashloop')!
            .checks.map((c) => ({ id: c.id, ok: true, message: '' })),
          source: 'auto',
        },
      ],
    }
    expect(
      ckaCoverage(curriculum.incidents, progress).find((c) => c.domain === 'troubleshooting')!
        .solved,
    ).toBe(1)
  })
})
