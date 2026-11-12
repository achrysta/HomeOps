import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import { connect, type AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createLabsApi } from './labs.ts'
import { NVIDIA_PROBE_ARGS, NVIDIA_PROBE_IMAGE } from '../scripts/gpuCapability.ts'

const mock = vi.hoisted(() => ({ execute: null as ((args: string[]) => { code: number; stdout: string }) | null, probeDelay: 0, probeHangs: false, probeStarted: null as (() => void) | null, liveStarted: null as (() => void) | null, liveRelease: null as (() => void) | null, liveHold: false, record: null as ((args: string[]) => void) | null }))
vi.mock('node:child_process', async (original) => {
  const actual = await original<typeof import('node:child_process')>()
  const { EventEmitter } = await import('node:events')
  const { PassThrough } = await import('node:stream')
  return { ...actual, spawn: (_command: string, args: string[]) => {
    mock.record?.(args)
    const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), kill: () => { child.emit('close', null); return true } })
    const finish = () => { const out = mock.execute!(args); child.stdout.end(out.stdout); child.emit('close', out.code) }
    queueMicrotask(() => {
      if (args.at(-1) === '--live' && mock.liveHold) { mock.liveRelease = finish; mock.liveStarted?.(); return }
      if (args[0] === 'run') {
        mock.probeStarted?.()
        if (mock.probeHangs) return
        if (mock.probeDelay) { setTimeout(finish, mock.probeDelay); return }
      }
      finish()
    })
    return child
  } }
})

describe('NVIDIA requirement over HTTP and WebSocket with fake Docker', () => {
  let dir: string
  let apiServer: Server
  let socketServer: Server
  let base: string
  let commands: string[][]
  let gpu: boolean
  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'homeops-gpu-api-'))
    const incidentsDir = path.join(dir, 'incidents')
    await mkdir(path.join(incidentsDir, 'gpu-test'), { recursive: true })
    await writeFile(path.join(incidentsDir, 'gpu-test/compose.yaml'), 'services:\n  model:\n    labels:\n      homeops.requires: nvidia-gpu\n')
    const socket = path.join(dir, 'docker.sock')
    socketServer = createServer((_req, res) => res.end(JSON.stringify({ Mounts: [{ Destination: incidentsDir, Source: incidentsDir }] })))
    await new Promise<void>((resolve) => socketServer.listen(socket, resolve))
    commands = []
    gpu = false
    mock.probeDelay = 0
    mock.probeHangs = false
    mock.probeStarted = null
    mock.liveStarted = null
    mock.liveRelease = null
    mock.liveHold = false
    mock.record = (args) => { commands.push(args) }
    mock.execute = (args) => {
      if (args[0] === 'run') return { code: gpu ? 0 : 1, stdout: gpu ? 'NVIDIA GeForce RTX 4060\n' : 'could not select device driver' }
      return { code: 0, stdout: '' }
    }
    const api = createLabsApi({ incidentsDir, dockerSocket: socket })
    apiServer = createServer((req, res) => void api.handle(req, res))
    apiServer.on('upgrade', (req, socket, head) => void api.handleUpgrade(req, socket, head))
    await new Promise<void>((resolve) => apiServer.listen(0, '127.0.0.1', resolve))
    base = `http://127.0.0.1:${(apiServer.address() as AddressInfo).port}`
  })
  afterEach(async () => {
    vi.useRealTimers()
    await Promise.all([apiServer, socketServer].map((s) => new Promise<void>((resolve) => s.close(() => resolve()))))
    await rm(dir, { recursive: true, force: true })
    mock.execute = null
  })
  const post = (action: string, body = {}) => fetch(`${base}/api/labs/incidents/gpu-test/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

  it('refuses every workload action before compose and caches only the fixed probe', async () => {
    for (const action of ['up', 'reset', 'verify', 'check']) {
      const response = await post(action, { command: 'arbitrary', gpus: 'all', image: 'foreign' })
      expect(response.status).toBe(409)
      expect(await response.text()).toContain('Windows/WSL')
    }
    expect(commands.filter((a) => a[0] === 'run')).toEqual([[...NVIDIA_PROBE_ARGS]])
    expect(commands.filter((a) => a[0] === 'image')).toEqual([['image', 'inspect', NVIDIA_PROBE_IMAGE]])
    expect(commands.some((a) => a[0] === 'compose')).toBe(false)
  })
  it('allows a cold NVIDIA probe taking longer than five seconds', async () => {
    gpu = true
    mock.probeDelay = 6_000
    const started = new Promise<void>((resolve) => { mock.probeStarted = resolve })
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const pending = post('up')
    await started
    await vi.advanceTimersByTimeAsync(6_000)
    const response = await pending
    expect(response.status).toBe(200)
    expect(await response.text()).toContain('__EXIT__ 0')
    expect(commands.some((a) => a[0] === 'compose' && a.includes('up'))).toBe(true)
  })
  it('does not cache a timeout as unavailable GPU for the next up', async () => {
    mock.probeHangs = true
    const started = new Promise<void>((resolve) => { mock.probeStarted = resolve })
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const pending = post('up')
    await started
    await vi.advanceTimersByTimeAsync(20_000)
    const timedOut = await pending
    expect(timedOut.status).toBe(409)
    await timedOut.text()
    gpu = true
    mock.probeHangs = false
    const response = await post('up')
    expect(response.status).toBe(200)
    expect(await response.text()).toContain('__EXIT__ 0')
    expect(commands.filter((a) => a[0] === 'run')).toHaveLength(2)
  })
  it('allows stopping a stand even when NVIDIA is unavailable', async () => {
    const response = await post('down')
    expect(response.status).toBe(200)
    expect(await response.text()).toContain('__EXIT__ 0')
    expect(commands.some((a) => a.includes('down'))).toBe(true)
    expect(commands.some((a) => a[0] === 'run')).toBe(false)
  })
  it('publishes the reason, and allows up only after a successful NVIDIA probe', async () => {
    gpu = true
    const status = await (await fetch(`${base}/api/labs/status`)).json()
    expect(status.gpu).toEqual({ available: true, reason: '' })
    const response = await post('up')
    expect(await response.text()).toContain('__EXIT__ 0')
    expect(commands.some((a) => a[0] === 'compose' && a.includes('up'))).toBe(true)
  })
  it('uses only fixed lightweight GPU live checks and refuses an inactive stand', async () => {
    gpu = true
    expect((await post('check')).status).toBe(409)
    const original = mock.execute!
    mock.execute = (args) => {
      if (args[0] === 'ps' && args.includes('label=homeops.live=gpu')) return { code: 0, stdout: 'inc-gpu-test-live-1' }
      if (args[0] === 'ps' && args.includes('label=homeops.requires=nvidia-gpu')) return { code: 0, stdout: 'inc-gpu-test-model-1' }
      if (args[0] === 'compose' && args.at(-1) === '--live') return { code: 0, stdout: 'HOMEOPS_LIVE {"checks":[{"id":"gpu","ok":true,"message":"CUDA"}]}' }
      return original(args)
    }
    const response = await post('check', { command: 'rm', args: ['-rf'], dashboard: 'http://foreign' })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ checks: [{ id: 'gpu', ok: true }] })
    const command = commands.find((args) => args[0] === 'compose' && args.at(-1) === '--live')!
    expect(command.slice(command.indexOf('exec'))).toEqual(['exec', '-T', '-e', 'DASHBOARD_URL=off', 'live', 'python', '/tools/verify.py', '--live'])
    expect(commands.filter((args) => args[0] === 'compose').some((args) => args.includes('run'))).toBe(false)
    expect(commands.some((args) => args.at(-1) === 'verify')).toBe(false)
  })
  it('does not create a missing live helper on polling', async () => {
    gpu = true
    const original = mock.execute!
    mock.execute = (args) => args[0] === 'ps' && args.includes('label=homeops.requires=nvidia-gpu')
      ? { code: 0, stdout: 'model-1' } : original(args)
    const response = await post('check')
    expect(response.status).toBe(409)
    expect(await response.text()).toContain('live-контейнер')
    expect(commands.some((args) => args[0] === 'compose')).toBe(false)
  })
  it('shares one running exec between concurrent polls and starts a fresh check later', async () => {
    gpu = true
    const original = mock.execute!
    mock.execute = (args) => {
      if (args[0] === 'ps') return { code: 0, stdout: 'running' }
      if (args.at(-1) === '--live') return { code: 0, stdout: 'HOMEOPS_LIVE {"at":"one","checks":[{"id":"ready","ok":true}]}' }
      return original(args)
    }
    mock.liveHold = true
    const started = new Promise<void>((resolve) => { mock.liveStarted = resolve })
    const first = post('check')
    await started
    const second = post('check')
    // Даём второму HTTP-запросу пройти async filesystem guards до освобождения проверки.
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(commands.filter((args) => args.at(-1) === '--live')).toHaveLength(1)
    mock.liveHold = false
    mock.liveRelease!()
    expect(await (await first).json()).toEqual(await (await second).json())
    expect((await post('check')).status).toBe(200)
    expect(commands.filter((args) => args.at(-1) === '--live')).toHaveLength(2)
    expect(commands.some((args) => args[0] === 'compose' && args.includes('run'))).toBe(false)
  })
  it('cannot launch the terminal as a bypass through WebSocket', async () => {
    const output = await new Promise<string>((resolve, reject) => {
      const socket = connect((apiServer.address() as AddressInfo).port, '127.0.0.1')
      let text = ''
      socket.setTimeout(2000, () => { socket.destroy(); reject(new Error('WebSocket did not close')) })
      socket.on('connect', () => socket.write('GET /api/labs/incidents/gpu-test/terminal HTTP/1.1\r\nHost: '+new URL(base).host+'\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n'))
      socket.on('data', (b) => { text += b.toString() })
      socket.on('error', reject)
      socket.on('close', () => resolve(text))
    })
    expect(output).toContain('NVIDIA')
    expect(commands.some((a) => a[0] === 'compose' || a[0] === 'exec')).toBe(false)
  })
})
