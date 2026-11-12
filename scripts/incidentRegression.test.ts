import { cp, mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { incidents } from '../src/data/incidents'
import { CKA_EXAM_VARIANTS } from '../src/data/ckaExams'
import { REGRESSION_CASES, selectCases, validateStage } from './incidentCases.ts'
import { runRegression, oneOffCommand, standOverride, TEST_CLUSTER, TEST_LOCK, TEST_VOLUME, type DockerCommand } from './incidentRegression.ts'
import { NVIDIA_PROBE_ARGS } from './gpuCapability.ts'
import { isolateCompose } from './regressionCompose.ts'

const report = (id: string, expected: Record<string, boolean>, messages: Record<string, string> = {}) => ({ format: 'homeops-incident-report', incidentId: id, passed: Object.values(expected).every(Boolean), checks: Object.entries(expected).map(([id, ok]) => ({ id, ok, message: messages[id] ?? (ok ? 'OK' : 'Обнаружена поломка') })) })

describe('regression control cases', () => {
  it('covers the fixed catalog including PostgreSQL recovery and rejects constraint bypasses', () => {
    expect(REGRESSION_CASES).toHaveLength(62)
    expect(new Set(REGRESSION_CASES.map((c) => c.id)).size).toBe(62)
    for (const incident of incidents.filter((i) => REGRESSION_CASES.some((c) => c.id === i.id) && i.constraints?.length)) {
      const bypasses = REGRESSION_CASES.find((c) => c.id === incident.id)!.stages.filter((s) => s.id.startsWith('bypass'))
      expect(bypasses.length, incident.id).toBeGreaterThan(0)
      for (const bypass of bypasses) expect(Object.values(bypass.expected), `${incident.id}/${bypass.id}`).toContain(false)
    }
    expect(REGRESSION_CASES.filter((c) => c.nodeAccess).map((c) => c.id).sort()).toEqual(incidents.filter((i) => i.nodeAccess && REGRESSION_CASES.some((c) => c.id === i.id)).map((i) => i.id).sort())
  })
  it('uses all current check ids and requires a meaningful partial failure', () => {
    for (const test of REGRESSION_CASES) {
      const incident = incidents.find((i) => i.id === test.id)!
      for (const stage of test.stages) expect(Object.keys(stage.expected).sort()).toEqual(incident.checks.map((c) => c.id).sort())
      expect(Object.values(test.stages[0].expected).every(Boolean)).toBe(false)
      if (!test.allowRedPartial) expect(Object.values(test.stages[1].expected)).toContain(true)
      else expect(test.stages[1].commands?.length).toBeGreaterThan(0)
      expect(Object.values(test.stages[1].expected)).toContain(false)
      expect(Object.values(test.stages.find((s) => s.id === 'fixed')!.expected).every(Boolean)).toBe(true)
    }
  })

  it('accepts expected red checks rather than treating every nonzero exit as failure', () => {
    for (const test of REGRESSION_CASES) for (const stage of test.stages) {
      const raw = report(test.id, stage.expected, stage.messageIncludes)
      expect(validateStage(raw, test, stage, raw.passed ? 0 : 1)).toEqual([])
    }
  })

  it('rejects unexpected green, wrong aggregate, missing ids, duplicate ids and crashes', () => {
    const test = REGRESSION_CASES[0]
    const stage = test.stages[0]
    const valid = report(test.id, stage.expected)
    for (const raw of [
      { ...valid, passed: true },
      { ...valid, incidentId: 'other' },
      { ...valid, checks: valid.checks.slice(1) },
      { ...valid, checks: [...valid.checks, valid.checks[0]] },
      { ...valid, checks: valid.checks.map((c) => ({ ...c, message: '' })) },
      { ...valid, checks: valid.checks.map((c) => ({ ...c, message: 'Вернуть: kubectl apply -f решение.yaml' })) },
      report(test.id, test.stages[2].expected),
      null,
    ]) expect(validateStage(raw, test, stage, 1).length).toBeGreaterThan(0)
    expect(validateStage(valid, test, stage, 127)).not.toEqual([])
  })

  it('requires the actual CI and naive bisect symptoms, not just a red boolean', () => {
    for (const id of ['ci-lockfile', 'git-bisect', 'linux-tls', 'k8s-cni', 'k8s-storm']) {
      const test = REGRESSION_CASES.find((c) => c.id === id)!
      for (const stage of test.stages.filter((s) => s.messageIncludes)) {
        expect(validateStage(report(id, stage.expected), test, stage, 1).join()).toContain('ожидаемый симптом')
        expect(validateStage(report(id, stage.expected, stage.messageIncludes), test, stage, Object.values(stage.expected).every(Boolean) ? 0 : 1)).toEqual([])
      }
    }
  })

  it('accepts only supported ids, with a plan and no duplicate runs', () => {
    expect(selectCases([]).cases).toHaveLength(REGRESSION_CASES.length)
    expect(selectCases(['--plan', 'k8s-probes', 'k8s-probes'])).toMatchObject({ plan: true, cases: [REGRESSION_CASES[1]] })
    expect(() => selectCases(['../data'])).toThrow(/Нет сценария/)
    expect(() => selectCases(['--force'])).toThrow(/Нет сценария/)
  })

  it('isolates images, writable copies, kubeconfig and report sending in every service', () => {
    const o = standOverride('/host/path with spaces/work', 'k8s-probes', 'owner')
    expect(o.volumes.kubeconfig).toEqual({ name: TEST_VOLUME, external: true })
    for (const service of Object.values(o.services)) {
      expect(service.image).toBe('homeops-regression-tools:1')
      expect(service.environment).toEqual({ DASHBOARD_URL: 'off', KIND_CLUSTER_NAME: TEST_CLUSTER })
      expect(service.volumes.find((v) => v.target === '/scenario')?.source).toBe('/host/path with spaces/work/k8s-probes')
      expect(service.volumes.find((v) => v.target === '/tools')?.read_only).toBe(true)
    }
  })

  it('keeps every offline CI container disconnected and covers each new constraint', () => {
    const isolated = isolateCompose({ services: { shell: { networks: { default: {} } }, verify: {} } }, '/work', '/host', 'test', 'owner', true)
    for (const service of Object.values(isolated.services)) {
      expect(service.network_mode).toBe('none')
      expect(service.networks).toBeUndefined()
      expect(service.environment?.DASHBOARD_URL).toBe('off')
    }
    const guards: Record<string, Record<string, string>> = {
      'ci-lockfile': { 'bypass-conftest': 'lint', 'bypass-noqa': 'lint', 'bypass-packaging': 'upgrade', 'bypass-tests': 'tests', 'bypass-ci': 'ci' },
      'git-bisect': { 'bypass-history': 'history', 'bypass-tests': 'fixed', 'bypass-uncommitted': 'fixed', 'bypass-bisect': 'clean' },
      'k8s-statefulset': { 'bypass-data': 'data', 'bypass-leader': 'config', 'bypass-readiness': 'config' },
      'k8s-gateway': { 'bypass-all': 'scope', 'bypass-web-host': 'scope', 'bypass-copy': 'scope' },
      'k8s-operator': { 'bypass-admin': 'rbac', 'bypass-manual': 'cronjob', 'bypass-crd': 'crd' },
      'linux-tls': { 'bypass-client': 'trust' },
      'k8s-cni': { 'bypass-taint': 'placement', 'bypass-kindnet': 'kindnet' },
      'k8s-storm': { 'bypass-quota': 'platform', 'bypass-deny': 'platform', 'bypass-allow-all': 'platform', 'bypass-liveness': 'stable', 'bypass-readiness': 'stable' },
      'k8s-gpu-scheduling': { 'bypass-delete-training': 'training', 'bypass-taint': 'node', 'bypass-capacity': 'node', 'bypass-class': 'classes', 'bypass-job': 'training' },
    }
    for (const [id, stages] of Object.entries(guards)) for (const [stage, guard] of Object.entries(stages)) {
      expect(REGRESSION_CASES.find((c) => c.id === id)?.stages.find((s) => s.id === stage)?.expected[guard], `${id}/${stage}`).toBe(false)
    }
  })

  it('removes published ports and separates every Compose write and named volume', () => {
    const raw = { services: { server: { container_name: 'user-server', ports: ['8080:80'], environment: { DASHBOARD_URL: 'http://real' }, volumes: [{ type: 'bind', source: '/work/case', target: '/scenario' }] } }, volumes: { data: { name: 'user-data' } }, networks: { default: { name: 'user-network' } } }
    const config = isolateCompose(raw, '/work', '/host/copy', 'homeops-regression-case', 'owner')
    expect(config.services.server.ports).toBeUndefined()
    expect(config.services.server.container_name).toBeUndefined()
    expect(config.services.server.environment?.DASHBOARD_URL).toBe('off')
    expect(config.services.server.volumes?.[0].source).toBe('/host/copy/case')
    expect(config.volumes?.data.name).toBe('homeops-regression-case-data')
    expect(config.networks?.default.name).toBe('homeops-regression-case-default')
    expect(raw.services.server.volumes[0].source).toBe('/work/case')
    expect(() => isolateCompose({ services: { bad: { volumes: [{ type: 'bind', source: '/data', target: '/scenario' }] } } }, '/work', '/host', 'test', 'owner')).toThrow(/вне/)
    expect(() => isolateCompose({ services: {}, volumes: { data: { external: true } } }, '/work', '/host', 'test', 'owner')).toThrow(/Внешний том/)
  })
})

describe('runner lifecycle with fake Docker', () => {
  let sourceDir: string
  beforeAll(async () => {
    sourceDir = await mkdtemp(path.join(tmpdir(), 'homeops-regression-fixtures-'))
    const realSource = path.resolve('incidents')
    const modelCache = path.join(realSource, '_shared/gpu/models')
    // Мок Docker не загружает weights: физический cache не должен раздувать каждый тест.
    await cp(realSource, sourceDir, { recursive: true, filter: (file) => file !== modelCache && !file.startsWith(modelCache + path.sep) && !file.split(path.sep).some((part) => part === '.reports' || part === '__pycache__') })
  })
  afterAll(async () => { await rm(sourceDir, { recursive: true, force: true }) })
  let dir: string
  let calls: { args: string[]; cleanup: boolean }[]
  let owner: string
  let counts: Record<string, number>
  let execute: DockerCommand

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'homeops-regression-test-'))
    calls = []
    counts = {}
    owner = ''
    execute = async (args) => {
      if (args.join(' ') === NVIDIA_PROBE_ARGS.join(' ')) return { code: 0, stdout: 'NVIDIA GeForce RTX 4060\n' }
      if (args[0] === 'create') owner = args[args.indexOf('--label') + 1].split('=')[1]
      if (args[0] === 'inspect' && args[1].startsWith(`${TEST_CLUSTER}-run-`)) return { code: 1, stdout: 'Error: No such object' }
      if (args[0] === 'inspect' || (args[0] === 'volume' && args[1] === 'inspect')) return { code: 0, stdout: JSON.stringify({ 'homeops.regression.run': owner }) }
      if (args[0] === 'network' && args[1] === 'ls') return { code: 0, stdout: 'kind\n' }
      if (args[0] === 'compose' && args.at(-1) === 'reset' && args.includes('-f')) {
        const copy = path.dirname(args[args.indexOf('-f') + 1])
        await cp(path.join(copy, '.original'), copy, { recursive: true }).catch(() => {})
      }
      if (args.includes('config') && args.includes('json')) return { code: 0, stdout: JSON.stringify({ services: Object.fromEntries(['server', 'worker', 'api', 'model-api', 'verify', 'reset', 'llm', 'redis', 'ingest', 'db', 'reporter', 'shell', 'model', 'tools', 'agent', 'mlflow', 'webhook', 'airflow'].map((s) => [s, {}])) }) }
      if (args[0] === 'compose' && args.at(-1) === 'verify') {
        const testDir = path.dirname(args[args.indexOf('-f') + 1])
        const id = path.basename(testDir)
        const test = REGRESSION_CASES.find((c) => c.id === id)!
        const stage = test.stages[counts[id] ?? 0]
        counts[id] = (counts[id] ?? 0) + 1
        const raw = report(id, stage.expected, stage.messageIncludes)
        await mkdir(path.join(testDir, '.reports'), { recursive: true })
        await writeFile(path.join(testDir, '.reports/last.json'), JSON.stringify(raw))
        return { code: raw.passed ? 0 : 1, stdout: 'verify' }
      }
      if (args[0] === 'compose' && args.at(-1) === '--services') return { code: 0, stdout: 'kubectl\n' }
      return { code: 0, stdout: '' }
    }
  })
  afterEach(async () => { await rm(dir, { recursive: true, force: true }) })

  const run = () => runRegression({ sourceDir, outputDir: dir, hostOutputDir: '/host/runs', cases: REGRESSION_CASES, docker: async (args, cleanup = false) => { calls.push({ args, cleanup }); return execute(args, cleanup) } })

  it('runs all control phases, keeps sources untouched, resets and removes only owned resources', async () => {
    const before = await readFile(path.join(sourceDir, 'k8s-crashloop/manifests/notify.yaml'), 'utf8')
    const { summary, reportDir } = await run()
    expect(summary.ok).toBe(true)
    expect(summary.cases.flatMap((c) => c.stages)).toHaveLength(REGRESSION_CASES.reduce((n, c) => n + c.stages.length, 0))
    expect(await readFile(path.join(sourceDir, 'k8s-crashloop/manifests/notify.yaml'), 'utf8')).toBe(before)
    expect(JSON.parse(await readFile(path.join(reportDir, 'summary.json'), 'utf8')).ok).toBe(true)
    await expect(readFile(path.join(reportDir, 'work/cluster.override.json'))).rejects.toThrow()
    const verify = calls.filter((c) => c.args.at(-1) === 'verify')
    expect(verify).toHaveLength(REGRESSION_CASES.reduce((n, c) => n + c.stages.length, 0))
    for (const c of verify) expect(c.args).toContain('DASHBOARD_URL=off')
    for (const id of REGRESSION_CASES.map((c) => c.id)) {
      const project = calls.filter((c) => c.args.includes(`${TEST_CLUSTER}-${id}`))
      const kind = REGRESSION_CASES.find((c) => c.id === id)?.kind
      expect(project.some((c) => c.cleanup && c.args.at(-1) === 'reset')).toBe(kind !== 'server')
      expect(project.some((c) => c.cleanup && c.args.includes('teardown'))).toBe(!kind || kind === 'k8s')
      expect(project.some((c) => c.cleanup && c.args.includes('down') && c.args[c.args.indexOf('--profile') + 1] === '*')).toBe(true)
    }
    expect(calls.some((c) => c.args.includes('homeops-k8s-kubeconfig'))).toBe(false)
    expect(calls.some((c) => c.args[0] === 'rm' && c.args.includes(TEST_LOCK))).toBe(true)
    expect(calls.some((c) => c.args[0] === 'volume' && c.args[1] === 'rm' && c.args[2] === TEST_VOLUME)).toBe(true)
    expect(calls.some((c) => c.args[0] === 'network' && c.args[1] === 'rm')).toBe(false)
  })

  it('skips NVIDIA cases without starting workloads or claiming stages, and cleans its lease', async () => {
    const original = execute
    execute = async (args, cleanup) => args.join(' ') === NVIDIA_PROBE_ARGS.join(' ')
      ? { code: 1, stdout: 'no NVIDIA device' }
      : original(args, cleanup)
    const { summary } = await runRegression({ sourceDir, outputDir: dir, hostOutputDir: '/host/runs', cases: REGRESSION_CASES.filter((c) => c.requires === 'nvidia-gpu'), docker: async (args, cleanup = false) => { calls.push({ args, cleanup }); return execute(args, cleanup) } })
    expect(summary.ok).toBe(true)
    expect(summary.cases).toHaveLength(4)
    for (const result of summary.cases) expect(result).toMatchObject({ stages: [], errors: [], skipKind: 'hardware', skipped: expect.stringContaining('NVIDIA') })
    expect(calls.some((c) => c.args.includes('up') || c.args.at(-1) === 'verify')).toBe(false)
    expect(calls.filter((c) => c.args[0] === 'run')).toHaveLength(1)
    expect(calls.some((c) => c.cleanup && c.args[0] === 'rm' && c.args.includes(TEST_LOCK))).toBe(true)
  })

  it('restores the canonical broken files in the copy before starting', async () => {
    const original = execute
    execute = async (args, cleanup) => {
      if (args.includes('up') && args.includes(`${TEST_CLUSTER}-k8s-crashloop`)) {
        const copy = path.join(path.dirname(args[args.indexOf('-f') + 1]), 'manifests/notify.yaml')
        expect(await readFile(copy, 'utf8')).toBe(await readFile(path.join(sourceDir, 'k8s-crashloop/.original/manifests/notify.yaml'), 'utf8'))
      }
      if (args.at(-1) === 'cluster' && args.includes('build')) {
        const override = args[args.lastIndexOf('-f') + 1]
        expect(JSON.parse(await readFile(override, 'utf8')).services.cluster.network_mode).toBe('none')
      }
      return original(args, cleanup)
    }
    expect((await run()).summary.ok).toBe(true)
  })

  it.each([124, 130])('stops a leaked helper after code %s before cluster cleanup waits on its lock', async (code) => {
    const original = execute
    let leaked = ''
    let removed = false
    execute = async (args, cleanup) => {
      if (args[0] === 'compose' && args.includes('run') && args.at(-1) === 'up' && !cleanup) {
        leaked = args[args.indexOf('--name') + 1]
        return { code, stdout: 'CLI finished, helper still holds flock' }
      }
      if (args[0] === 'inspect' && args[1] === leaked) return { code: 0, stdout: JSON.stringify({ 'homeops.regression.run': owner, 'com.docker.compose.project': `${TEST_CLUSTER}-cluster`, 'com.docker.compose.oneoff': 'True' }) }
      if (args[0] === 'rm' && args.at(-1) === leaked) { expect(cleanup).toBe(true); removed = true }
      if (args[0] === 'compose' && args.at(-1) === 'down' && args.includes(`${TEST_CLUSTER}-cluster`)) expect(removed).toBe(true)
      return original(args, cleanup)
    }
    const { summary } = await run()
    expect(leaked).toMatch(/^homeops-regression-run-/)
    expect(summary.ok).toBe(false)
    expect(summary.cleanupErrors).toEqual([])
  })

  it('preserves a timed-out helper whose owner label changed', async () => {
    const original = execute
    let leaked = ''
    execute = async (args, cleanup) => {
      if (args[0] === 'compose' && args.includes('run') && args.at(-1) === 'up' && !cleanup) {
        leaked = args[args.indexOf('--name') + 1]
        return { code: 124, stdout: 'timeout' }
      }
      if (args[0] === 'inspect' && args[1] === leaked) return { code: 0, stdout: JSON.stringify({ 'homeops.regression.run': 'another-run', 'com.docker.compose.project': `${TEST_CLUSTER}-cluster`, 'com.docker.compose.oneoff': 'True' }) }
      return original(args, cleanup)
    }
    const { summary } = await run()
    expect(summary.ok).toBe(false)
    expect(summary.cleanupErrors.join()).toContain('контейнер сохранён')
    expect(calls.some((c) => c.args[0] === 'rm' && c.args.includes(leaked))).toBe(false)
  })

  it('names only Compose run, leaving kubectl run inside exec and other projects unchanged', () => {
    const base = ['compose', '--ansi', 'never', '-p', `${TEST_CLUSTER}-cluster`, '-f', '/copy/compose.yaml']
    const args = [...base, 'run', '--rm', '-T', 'cluster', 'up']
    expect(oneOffCommand(args, 'owner', 1)).toMatchObject({ name: `${TEST_CLUSTER}-run-owner-1`, project: `${TEST_CLUSTER}-cluster` })
    expect(oneOffCommand(args, 'owner', 2).name).not.toBe(oneOffCommand(args, 'owner', 1).name)
    const exec = [...base, 'exec', '-T', 'kubectl', 'kubectl', 'run', 'probe']
    expect(oneOffCommand(exec, 'owner', 3)).toEqual({ args: exec })
    const foreign = ['compose', '-p', 'inc-user', 'run', '--rm', 'shell']
    expect(oneOffCommand(foreign, 'owner', 4)).toEqual({ args: foreign })
  })

  it('refuses a foreign Docker lease without removing it', async () => {
    execute = async (args) => args[0] === 'create' ? { code: 1, stdout: 'name in use' } : { code: 0, stdout: JSON.stringify({ 'homeops.regression.run': 'another-run' }) }
    const { summary } = await run()
    expect(summary.ok).toBe(false)
    expect(calls.some((c) => c.args[0] === 'rm')).toBe(false)
    expect(calls.some((c) => c.args[0] === 'compose')).toBe(false)
  })

  it.each(['nodes', 'volume'])('preserves leftover %s and refuses to reuse them', async (resource) => {
    const original = execute
    execute = async (args, cleanup) => {
      if (resource === 'nodes' && args[0] === 'ps') return { code: 0, stdout: `${TEST_CLUSTER}-control-plane\n` }
      if (resource === 'volume' && args[0] === 'volume' && args[1] === 'ls') return { code: 0, stdout: TEST_VOLUME }
      return original(args, cleanup)
    }
    const { summary } = await run()
    expect(summary.ok).toBe(false)
    expect(calls.some((c) => c.args[0] === 'compose')).toBe(false)
    expect(calls.some((c) => c.args[0] === 'volume' && c.args[1] === 'rm')).toBe(false)
    expect(calls.filter((c) => c.args[0] === 'rm').map((c) => c.args)).toEqual([['rm', '-f', TEST_LOCK]])
  })

  it('detects a broken state falsely passing, and still cleans up and runs the other stand', async () => {
    const original = execute
    execute = async (args, cleanup) => {
      const out = await original(args, cleanup)
      if (args.at(-1) === 'verify' && args.includes(`${TEST_CLUSTER}-k8s-crashloop`)) {
        const testDir = path.dirname(args[args.indexOf('-f') + 1])
        await writeFile(path.join(testDir, '.reports/last.json'), JSON.stringify(report('k8s-crashloop', REGRESSION_CASES[0].stages[2].expected)))
        return { code: 0, stdout: '' }
      }
      return out
    }
    const { summary } = await run()
    expect(summary.ok).toBe(false)
    expect(summary.cases[0].stages[0].errors.join()).toContain('running')
    expect(summary.cases[1].stages).toHaveLength(3)
    expect(summary.cleanupErrors).toEqual([])
  })

  it('does not reuse an old report when verify crashes before writing a new one', async () => {
    const original = execute
    execute = async (args, cleanup) => {
      if (args.at(-1) === 'verify' && args.includes(`${TEST_CLUSTER}-k8s-crashloop`) && counts['k8s-crashloop'] === 1) return { code: 127, stdout: 'crashed' }
      return original(args, cleanup)
    }
    const { summary } = await run()
    expect(summary.ok).toBe(false)
    expect(summary.cases[0].stages).toHaveLength(1)
    expect(summary.cases[0].errors[0]).toContain('last.json')
    expect(summary.cleanupErrors).toEqual([])
  })

  it('cleans up after cancellation using commands that are independent of the aborted signal', async () => {
    const original = execute
    execute = async (args, cleanup) => {
      if (args.includes('up') && !cleanup) throw new Error('aborted')
      return original(args, cleanup)
    }
    const { summary } = await run()
    expect(summary.ok).toBe(false)
    expect(summary.errors).toContain('aborted')
    expect(calls.some((c) => c.cleanup && c.args.includes('down'))).toBe(true)
    expect(calls.some((c) => c.cleanup && c.args.includes(TEST_VOLUME) && c.args.includes('rm'))).toBe(true)
  })

  it('reports cleanup failure and retains the compose copy for recovery', async () => {
    const original = execute
    execute = async (args, cleanup) => args[0] === 'volume' && args[1] === 'rm' ? { code: 1, stdout: 'volume busy' } : original(args, cleanup)
    const { summary, reportDir } = await run()
    expect(summary.ok).toBe(false)
    expect(summary.cleanupErrors.join()).toContain('volume busy')
    expect(await readFile(path.join(reportDir, 'work/cluster.override.json'), 'utf8')).toContain(TEST_VOLUME)
  })

  it('recreates the test cluster before each nodeAccess preparation and uses only test node names', async () => {
    expect((await run()).summary.ok).toBe(true)
    for (const test of REGRESSION_CASES.filter((c) => c.nodeAccess)) {
      const prepare = calls.findIndex((c) => c.args.at(-2) === 'prepare' && c.args.at(-1) === test.id)
      expect(prepare).toBeGreaterThan(1)
      expect(calls[prepare - 1].args.slice(-2)).toEqual(['cluster', 'up'])
      expect(calls[prepare - 2].args.slice(-2)).toEqual(['cluster', 'down'])
    }
    const nodeExec = calls.filter((c) => c.args[0] === 'exec')
    expect(nodeExec.length).toBeGreaterThan(0)
    for (const c of nodeExec) expect(c.args[3]).toMatch(/^homeops-regression-(control-plane|worker)$/)
    expect(calls.filter((c) => c.args.at(-2) === 'prepare' && c.args.at(-1) === 'k8s-kubeadm-upgrade')).toHaveLength(2)
  })

  it('records a missing local upgrade image as a skip without rebuilding it or preparing that stand', async () => {
    const original = execute
    execute = async (args, cleanup) => args[0] === 'image' && args[1] === 'inspect' ? { code: 1, stdout: 'no image' } : original(args, cleanup)
    const { summary } = await run()
    expect(summary.ok).toBe(false)
    expect(summary.cases.find((c) => c.id === 'k8s-kubeadm-upgrade')).toMatchObject({ stages: [], skipped: expect.stringContaining('homeops-k8s-upgrade') })
    expect(calls.some((c) => c.args.at(-2) === 'prepare' && c.args.at(-1) === 'k8s-kubeadm-upgrade')).toBe(false)
    expect(calls.some((c) => c.args.includes('pull'))).toBe(false)
    expect(summary.cleanupErrors).toEqual([])
  })

  it('recreates the GPU/CNI workspace on the same nodes and audits cluster objects before down', async () => {
    expect((await run()).summary.ok).toBe(true)
    for (const stand of ['k8s-gpu-scheduling', 'k8s-cni']) {
      const project = `${TEST_CLUSTER}-${stand}`
      const recreate = calls.findIndex((c) => c.args.includes(project) && c.args.includes('--force-recreate'))
      expect(recreate).toBeGreaterThan(0)
      expect(calls[recreate - 1].args.at(-1)).toBe('reset')
      expect(calls[recreate - 1].args).toContain('DASHBOARD_URL=off')
      const previousVerify = calls.slice(0, recreate).findLastIndex((c) => c.args.includes(project) && c.args.at(-1) === 'verify')
      expect(calls.slice(previousVerify + 1, recreate).some((c) => c.args.includes('cluster'))).toBe(false)
    }
    for (const id of ['k8s-gateway', 'k8s-operator', 'k8s-gpu-scheduling']) {
      const audit = calls.findIndex((c) => c.cleanup && c.args.includes(`${TEST_CLUSTER}-${id}`) && c.args.some((a) => a.includes('После teardown остались')))
      expect(audit, id).toBeGreaterThan(0)
      expect(calls[audit - 1].args.at(-1)).toBe('teardown')
      expect(calls[audit + 1].args).toContain('down')
    }
  })

  it('restarts only the test cluster before a namespace stand following an exclusive one', async () => {
    const cases = ['k8s-cni', 'k8s-storm'].map((id) => REGRESSION_CASES.find((c) => c.id === id)!)
    const { summary } = await runRegression({ sourceDir, outputDir: dir, hostOutputDir: '/host/runs', cases, docker: async (args, cleanup = false) => { calls.push({ args, cleanup }); return execute(args, cleanup) } })
    expect(summary.ok).toBe(true)
    const down = calls.findIndex((c) => c.cleanup && c.args.includes('cluster') && c.args.at(-1) === 'down')
    const start = calls.findIndex((c) => c.args.includes('homeops-regression-k8s-storm') && c.args.includes('up'))
    expect(calls.slice(down + 1, start).some((c) => c.args.includes('cluster') && c.args.at(-1) === 'up')).toBe(true)
    expect(calls.slice(down + 1, start).some((c) => c.args.includes('prepare'))).toBe(false)
  })

  it('checks both exam teardown directions in an isolated compatibility-only run', async () => {
    const original = execute
    execute = async (args, cleanup) => {
      if (args[0] === 'compose' && args.at(-1) === 'verify') {
        const copy = path.dirname(args[args.indexOf('-f') + 1]), id = path.basename(copy)
        const test = REGRESSION_CASES.find((c) => c.id === id)!
        await writeFile(path.join(copy, '.reports/last.json'), JSON.stringify(report(id, test.stages.find((s) => s.id === 'fixed')!.expected)))
        return { code: 0, stdout: '' }
      }
      return original(args, cleanup)
    }
    const selected = selectCases(['--exam-compatibility'])
    expect(selected.cases.map((c) => c.id)).toEqual(['k8s-gateway', 'k8s-operator'])
    expect(() => selectCases(['--exam-compatibility', 'k8s-gpu-scheduling'])).toThrow('только')
    const { summary } = await runRegression({ sourceDir, outputDir: dir, hostOutputDir: '/host/runs', cases: selected.cases, examCompatibility: true, docker: async (args, cleanup = false) => { calls.push({ args, cleanup }); return execute(args, cleanup) } })
    expect(summary.ok).toBe(true)
    expect(summary.cases).toEqual([])
    expect(summary.compatibility?.checks.map((c) => c.id)).toEqual(['ready/k8s-gateway', 'ready/k8s-operator', 'after-gateway-teardown/k8s-operator', 'after-operator-teardown/k8s-gateway'])
    expect(calls.filter((c) => c.args.at(-1) === 'verify')).toHaveLength(4)
    for (const c of calls.filter((c) => c.args.at(-1) === 'verify')) expect(c.args).toContain('DASHBOARD_URL=off')
    expect(summary.cleanupErrors).toEqual([])
    const final = selectCases(['--exam-final-compatibility'])
    expect(final.cases.map((c) => c.id)).toEqual(CKA_EXAM_VARIANTS.find((v) => v.id === 'cka-9')?.incidentIds)
    expect(() => selectCases(['--exam-final-compatibility', 'k8s-cni'])).toThrow('только')
    expect(() => selectCases(['--exam-final-compatibility', '--exam-compatibility'])).toThrow('один режим')
    calls = []
    const result = await runRegression({ sourceDir, outputDir: dir, hostOutputDir: '/host/runs', cases: final.cases, examCompatibility: true, docker: async (args, cleanup = false) => { calls.push({ args, cleanup }); return execute(args, cleanup) } })
    expect(result.summary.ok).toBe(true)
    expect(result.summary.compatibility?.checks).toHaveLength(9)
    for (const removed of final.cases) for (const other of final.cases.filter((c) => c.id !== removed.id)) {
      expect(result.summary.compatibility?.checks.map((c) => c.id)).toContain('after-' + removed.id.replace(/^k8s-/, '') + '-teardown/' + other.id)
    }
    expect(result.summary.cleanupErrors).toEqual([])
  })
})
