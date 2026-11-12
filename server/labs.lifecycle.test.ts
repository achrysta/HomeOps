import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createLabsApi } from './labs.ts'

type Output = { code: number; stdout: string }
const docker = vi.hoisted(() => ({ execute: null as ((args: string[]) => Promise<Output>) | null }))

// Docker полностью подменён: тесты не запускают стенды и не трогают настоящий кластер.
vi.mock('node:child_process', async (original) => {
  const actual = await original<typeof import('node:child_process')>()
  const { EventEmitter } = await import('node:events')
  const { PassThrough } = await import('node:stream')
  return {
    ...actual,
    spawn: (_command: string, args: string[]) => {
      const child = Object.assign(new EventEmitter(), {
        stdout: new PassThrough(),
        stderr: new PassThrough(),
        kill: () => {
          child.emit('close', null)
          return true
        },
      })
      queueMicrotask(async () => {
        try {
          const out = await docker.execute!(args)
          child.stdout.write(out.stdout)
          child.emit('close', out.code)
        } catch (error) {
          child.emit('error', error)
        }
      })
      return child
    },
  }
})

const ok = (): Output => ({ code: 0, stdout: '' })
const deferred = () => {
  let resolve!: () => void
  const promise = new Promise<void>((r) => {
    resolve = r
  })
  return { promise, resolve }
}
const standId = (args: string[]) => path.basename(path.dirname(args[args.indexOf('-f') + 1] ?? ''))
const isCluster = (args: string[], action: string) =>
  args.includes('cluster') && args.at(-1) === action

describe('shared cluster lifecycle over HTTP', () => {
  let dir: string
  let apiServer: Server
  let socketServer: Server
  let base: string
  let commands: string[][]
  let running: Set<string>
  let execute: (args: string[]) => Promise<Output>

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'homeops-lifecycle-'))
    const incidentsDir = path.join(dir, 'incidents')
    for (const id of ['k8s-a', 'k8s-b', 'plain']) {
      await mkdir(path.join(incidentsDir, id), { recursive: true })
      await writeFile(
        path.join(incidentsDir, id, 'compose.yaml'),
        id === 'plain' ? 'services: {}' : 'labels: { homeops.role: k8s }',
      )
    }
    const socket = path.join(dir, 'docker.sock')
    socketServer = createServer((_req, res) =>
      res.end(JSON.stringify({ Mounts: [{ Destination: incidentsDir, Source: incidentsDir }] })),
    )
    await new Promise<void>((resolve, reject) =>
      socketServer.once('error', reject).listen(socket, resolve),
    )
    commands = []
    running = new Set()
    execute = async (args) => {
      if (args[0] === 'ps') {
        if (args.includes('{{.Names}}')) {
          const id = args
            .find((a) => a.startsWith('label=com.docker.compose.project=inc-'))
            ?.split('=inc-')[1]
          return { code: 0, stdout: id && running.has(id) ? `inc-${id}-kubectl-1` : '' }
        }
        if (args.some((a) => a.includes('kind.cluster'))) return ok()
        return {
          code: 0,
          stdout: [...running]
            .map((id) =>
              JSON.stringify({
                Names: `inc-${id}-kubectl-1`,
                State: 'running',
                Labels: `com.docker.compose.project=inc-${id},com.docker.compose.service=kubectl,homeops.role=k8s`,
              }),
            )
            .join('\n'),
        }
      }
      if (args[0] === 'compose' && !args.includes('cluster')) {
        if (args.includes('up')) running.add(standId(args))
        if (args.includes('down')) running.delete(standId(args))
      }
      return ok()
    }
    docker.execute = async (args) => {
      commands.push(args)
      return execute(args)
    }
    const api = createLabsApi({ incidentsDir, dockerSocket: socket })
    apiServer = createServer((req, res) => void api.handle(req, res))
    await new Promise<void>((resolve, reject) =>
      apiServer.once('error', reject).listen(0, '127.0.0.1', resolve),
    )
    base = `http://127.0.0.1:${(apiServer.address() as AddressInfo).port}`
  })

  afterEach(async () => {
    await Promise.all(
      [apiServer, socketServer]
        .filter(Boolean)
        .map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
    )
    await rm(dir, { recursive: true, force: true })
    docker.execute = null
  })

  const post = async (id: string, act: string) =>
    (
      await fetch(`${base}/api/labs/incidents/${id}/${act}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      })
    ).text()

  it('keeps the cluster until a concurrently starting workplace is ready', async () => {
    running.add('k8s-a')
    const started = deferred()
    const release = deferred()
    const original = execute
    execute = async (args) => {
      if (args.includes('up') && standId(args) === 'k8s-b') {
        started.resolve()
        await release.promise
      }
      return original(args)
    }
    const up = post('k8s-b', 'up')
    await started.promise
    const down = post('k8s-a', 'down')
    try {
      // Другой, обычный стенд продолжает запускаться, пока k8s-b готовит namespace.
      expect(await post('plain', 'up')).toContain('__EXIT__ 0')
      // Даём HTTP и файловым операциям down время дойти до общей очереди.
      await new Promise((resolve) => setTimeout(resolve, 30))
      expect(commands.some((args) => isCluster(args, 'down'))).toBe(false)
      expect(commands.some((args) => standId(args) === 'k8s-a' && args.includes('down'))).toBe(
        false,
      )
    } finally {
      release.resolve()
      await Promise.all([up, down])
    }
    expect(running.has('k8s-b')).toBe(true)
    expect(commands.some((args) => isCluster(args, 'down'))).toBe(false)
  })

  it('serializes reset with deletion of the last stand', async () => {
    running.add('k8s-a')
    running.add('k8s-b')
    const started = deferred()
    const release = deferred()
    const original = execute
    execute = async (args) => {
      if (args.includes('reset')) {
        started.resolve()
        await release.promise
      }
      return original(args)
    }
    const reset = post('k8s-b', 'reset')
    await started.promise
    const down = post('k8s-a', 'down')
    try {
      await new Promise((resolve) => setTimeout(resolve, 30))
      expect(commands.some((args) => args.includes('teardown'))).toBe(false)
    } finally {
      release.resolve()
      await Promise.all([reset, down])
    }
    expect(commands.findIndex((a) => a.includes('--force-recreate'))).toBeLessThan(
      commands.findIndex((a) => a.includes('teardown')),
    )
  })

  it.each(['teardown', 'down'])('preserves the cluster when stand %s fails', async (step) => {
    running.add('k8s-a')
    const original = execute
    execute = async (args) =>
      args.includes(step) && !args.includes('cluster')
        ? { code: 7, stdout: 'failure' }
        : original(args)
    expect(await post('k8s-a', 'down')).toContain('__EXIT__ 7')
    expect(commands.some((args) => isCluster(args, 'down'))).toBe(false)
  })

  it('reports failure to delete the cluster and allows the next action', async () => {
    running.add('k8s-a')
    const original = execute
    execute = async (args) =>
      isCluster(args, 'down') ? { code: 9, stdout: 'cluster failure' } : original(args)
    expect(await post('k8s-a', 'down')).toContain('__EXIT__ 9')
    expect(await post('k8s-b', 'up')).toContain('__EXIT__ 0')
  })

  it('does not infer an empty cluster from a failed Docker status', async () => {
    running.add('k8s-a')
    const original = execute
    execute = async (args) =>
      args[0] === 'ps' && args.includes('label=com.docker.compose.project')
        ? { code: 1, stdout: 'unavailable' }
        : original(args)
    expect(await post('k8s-a', 'down')).toContain('общий кластер сохранён')
    expect(commands.some((args) => isCluster(args, 'down'))).toBe(false)
  })

  it('does not delete another stand’s cluster when stopping an inactive exclusive stand', async () => {
    await writeFile(
      path.join(dir, 'incidents', 'k8s-a', 'compose.yaml'),
      'labels: { homeops.role: k8s, homeops.cluster: exclusive }',
    )
    running.add('k8s-b')
    expect(await post('k8s-a', 'down')).toContain('__EXIT__ 0')
    expect(running.has('k8s-b')).toBe(true)
    expect(commands.some((args) => isCluster(args, 'down'))).toBe(false)
  })

  it('still deletes the cluster when stopping its sole exclusive stand', async () => {
    await writeFile(
      path.join(dir, 'incidents', 'k8s-a', 'compose.yaml'),
      'labels: { homeops.role: k8s, homeops.cluster: exclusive }',
    )
    running.add('k8s-a')
    expect(await post('k8s-a', 'down')).toContain('__EXIT__ 0')
    expect(commands.some((args) => isCluster(args, 'down'))).toBe(true)
  })

  it('preserves the cluster on an exclusive down when Docker status fails', async () => {
    await writeFile(
      path.join(dir, 'incidents', 'k8s-a', 'compose.yaml'),
      'labels: { homeops.role: k8s, homeops.cluster: exclusive }',
    )
    const original = execute
    execute = async (args) =>
      args[0] === 'ps' && args.includes('label=com.docker.compose.project')
        ? { code: 1, stdout: 'unavailable' }
        : original(args)
    expect(await post('k8s-a', 'down')).toContain('общий кластер сохранён')
    expect(commands.some((args) => isCluster(args, 'down'))).toBe(false)
  })
  it('enforces media types and the actual service list before spawning logs', async () => {
    for (const mime of ['text/plain; application/json', 'application/jsonx', 'text/plain']) {
      const res = await fetch(`${base}/api/labs/incidents/plain/up`, {
        method: 'POST',
        headers: { 'Content-Type': mime },
        body: '{}',
      })
      expect(res.status).toBe(415)
    }
    const res = await fetch(`${base}/api/labs/incidents/plain/logs?service=unknown`)
    expect(res.status).toBe(400)
    expect(commands.some((a) => a.includes('logs'))).toBe(false)
  })

  it('runs only fixed live checks in a running compose gym and refuses full reports', async () => {
    await writeFile(path.join(dir, 'incidents', 'plain', 'compose.yaml'), 'labels: { homeops.role: compose-gym }')
    const response = await fetch(`${base}/api/labs/incidents/plain/check`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
    expect(response.status).toBe(409)
    running.add('plain')
    const original = execute
    execute = async (args) => args.includes('exec')
      ? { code: 0, stdout: 'HOMEOPS_LIVE {"checks":[{"id":"run","ok":true,"message":"ok"}]}' }
      : original(args)
    const result = await fetch(`${base}/api/labs/incidents/plain/check?command=rm`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"command":"rm","args":["-rf"]}' })
    expect(result.status).toBe(200)
    expect(await result.json()).toMatchObject({ checks: [{ id: 'run', ok: true }] })
    const exec = commands.find((args) => args.includes('exec'))!
    expect(exec.slice(exec.indexOf('exec'))).toEqual(['exec', '-T', 'shell', 'python', '/tools/verify.py', '--live'])
    expect(await post('plain', 'verify')).toContain('__EXIT__ 1')
    expect(commands.some((args) => args.at(-1) === 'verify')).toBe(false)
    await post('plain', 'reset')
    expect(commands.find((args) => args.includes('up'))).toContain('--wait')
    expect(commands.some((args) => args.at(-1) === 'reset')).toBe(true)
    const stopIndex = commands.findIndex((args) => args.includes('stop'))
    const resetIndex = commands.findIndex((args) => args.at(-1) === 'reset')
    const upIndex = commands.findIndex((args) => args.includes('up'))
    expect(stopIndex).toBeGreaterThan(-1)
    expect(resetIndex).toBeGreaterThan(stopIndex)
    expect(upIndex).toBeGreaterThan(resetIndex)
    expect(commands.some((args) => args.includes('cluster'))).toBe(false)
  })

  it('does not reset a compose gym database if stopping its writers fails', async () => {
    await writeFile(path.join(dir, 'incidents', 'plain', 'compose.yaml'), 'labels: { homeops.role: compose-gym }')
    running.add('plain')
    const original = execute
    execute = async (args) => args.includes('stop') ? { code: 1, stdout: 'stop failed' } : original(args)
    expect(await post('plain', 'reset')).toContain('__EXIT__ 1')
    expect(commands.some((args) => args.at(-1) === 'reset' || args.includes('up'))).toBe(false)
  })

  it('bounds concurrent requests and releases slots after Docker timeout', async () => {
    socketServer.removeAllListeners('request')
    socketServer.on('request', (_req, _res) => {}) // Docker never sends headers
    const api = createLabsApi({
      incidentsDir: path.join(dir, 'incidents'),
      dockerSocket: path.join(dir, 'docker.sock'),
      dockerTimeoutMs: 80,
      maxRequests: 1,
    })
    const extra = createServer((req, res) => void api.handle(req, res))
    await new Promise<void>((r) => extra.listen(0, '127.0.0.1', r))
    const url = `http://127.0.0.1:${(extra.address() as AddressInfo).port}/api/labs/status`
    try {
      const first = fetch(url)
      await new Promise((r) => setTimeout(r, 25))
      expect((await fetch(url)).status).toBe(429)
      expect(await (await first).json()).toMatchObject({
        ok: false,
        error: expect.stringContaining('вовремя'),
      })
      expect((await fetch(url)).status).toBe(200)
    } finally {
      extra.closeAllConnections()
      await new Promise<void>((r) => extra.close(() => r()))
    }
  })

  it('kills a stuck compose command and makes the stand available again', async () => {
    const api = createLabsApi({
      incidentsDir: path.join(dir, 'incidents'),
      dockerSocket: path.join(dir, 'docker.sock'),
      commandTimeoutMs: 25,
    })
    const extra = createServer((req, res) => void api.handle(req, res))
    await new Promise<void>((r) => extra.listen(0, '127.0.0.1', r))
    const url = `http://127.0.0.1:${(extra.address() as AddressInfo).port}/api/labs/incidents/plain/up`
    const original = execute
    execute = async (args) => (args.includes('up') ? new Promise(() => {}) : original(args))
    try {
      const post = () =>
        fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      expect(await (await post()).text()).toContain('__EXIT__ 124')
      execute = original
      expect(await (await post()).text()).toContain('__EXIT__ 0')
    } finally {
      extra.closeAllConnections()
      await new Promise<void>((r) => extra.close(() => r()))
    }
  })
  it('does not read stats of a foreign compose project even if Docker lists its id', async () => {
    let statsReads = 0
    socketServer.removeAllListeners('request')
    socketServer.on('request', (req, res) => {
      if (req.url?.includes('/stats')) {
        statsReads++
        res.end('{}')
      } else if (req.url?.startsWith('/containers/json?'))
        res.end(JSON.stringify([{ Id: 'a'.repeat(64) }]))
      else if (req.url === `/containers/${'a'.repeat(64)}/json`)
        res.end(
          JSON.stringify({
            State: { Running: true },
            Config: { Labels: { 'com.docker.compose.project': 'inc-other' } },
          }),
        )
      else
        res.end(
          JSON.stringify({
            Mounts: [
              { Destination: path.join(dir, 'incidents'), Source: path.join(dir, 'incidents') },
            ],
          }),
        )
    })
    const res = await fetch(`${base}/api/labs/incidents/plain/memory`)
    expect(await res.json()).toEqual({ containers: [] })
    expect(statsReads).toBe(0)
  })

  it('bounds Docker fan-out from a large memory response', async () => {
    let reads = 0,
      done!: () => void
    const drained = new Promise<void>((r) => {
      done = r
    })
    socketServer.removeAllListeners('request')
    socketServer.on('request', (req, res) => {
      if (req.url?.startsWith('/containers/json?'))
        res.end(
          JSON.stringify(
            Array.from({ length: 65 }, (_, i) => ({ Id: String(i).padStart(12, '0') })),
          ),
        )
      else if (/^\/containers\/[0-9]{12}\/json$/.test(req.url ?? '')) {
        reads++
        setTimeout(() => {
          res.end(
            JSON.stringify({ Config: { Labels: { 'com.docker.compose.project': 'inc-other' } } }),
          )
          if (++responses === 64) done()
        }, 30)
      } else
        res.end(
          JSON.stringify({
            Mounts: [
              { Destination: path.join(dir, 'incidents'), Source: path.join(dir, 'incidents') },
            ],
          }),
        )
    })
    let responses = 0
    const res = await fetch(`${base}/api/labs/incidents/plain/memory`)
    expect(res.status).toBe(500)
    expect(await res.json()).toMatchObject({ error: 'Слишком много запросов к Docker' })
    await drained
    expect(reads).toBe(64)
    expect((await fetch(`${base}/api/labs/status`)).status).toBe(200)
  })
})
