import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer, request, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  createProgressApi,
  createSnapshot,
  listBackups,
  readStored,
  writeStored,
} from './progressApi.ts'

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'homeops-'))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('file store', () => {
  it('writes atomically with increasing revisions and an importable format', async () => {
    expect(await readStored(dir)).toBeNull()
    const r1 = await writeStored(dir, { tasks: { A1: { status: 'completed' } } }, 0, '2026.10.1')
    expect(r1).toMatchObject({ ok: true, revision: 1 })
    const r2 = await writeStored(dir, { tasks: {} }, 1)
    expect(r2).toMatchObject({ ok: true, revision: 2 })
    const raw = JSON.parse(await readFile(path.join(dir, 'progress.json'), 'utf8'))
    expect(raw.format).toBe('homeops-progress')
    expect(raw.progress).toEqual({ tasks: {} })
  })

  it('rejects writes based on a stale revision', async () => {
    await writeStored(dir, { v: 1 }, 0)
    await writeStored(dir, { v: 2 }, 1)
    const stale = await writeStored(dir, { v: 'stale' }, 1)
    expect(stale.ok).toBe(false)
    if (!stale.ok) {
      expect(stale.revision).toBe(2)
      expect(stale.current?.progress).toEqual({ v: 2 })
    }
    expect((await readStored(dir))?.progress).toEqual({ v: 2 })
  })

  it('keeps a daily snapshot and manual snapshots', async () => {
    await writeStored(dir, { v: 1 }, 0)
    await writeStored(dir, { v: 2 }, 1)
    await writeStored(dir, { v: 3 }, 2)
    let backups = await listBackups(dir)
    expect(backups.filter((b) => b.name.endsWith('-daily.json'))).toHaveLength(1)
    const daily = JSON.parse(await readFile(path.join(dir, 'backups', backups[0].name), 'utf8'))
    expect(daily.progress).toEqual({ v: 1 })

    const name = await createSnapshot(dir, 'before-import')
    expect(name).toMatch(/before-import\.json$/)
    backups = await listBackups(dir)
    expect(backups).toHaveLength(2)
  })

  it('never overwrites a corrupted file', async () => {
    await writeFile(path.join(dir, 'progress.json'), '{ broken', 'utf8')
    await expect(readStored(dir)).rejects.toThrow(/повреждён/)
    await expect(writeStored(dir, { v: 1 }, 0)).rejects.toThrow(/повреждён/)
    expect(await readFile(path.join(dir, 'progress.json'), 'utf8')).toBe('{ broken')
  })
})

describe('HTTP API', () => {
  let server: Server
  let base: string

  beforeEach(async () => {
    const api = createProgressApi({ dataDir: dir })
    server = createServer(async (req, res) => {
      if (!(await api(req, res))) {
        res.writeHead(418)
        res.end()
      }
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })
  afterEach(async () => {
    await new Promise((resolve) => server.close(resolve))
  })

  const put = (progress: unknown, baseRevision: number) =>
    fetch(`${base}/api/progress`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ progress, baseRevision }),
    })

  it('rejects foreign Host/Origin and fake JSON media types on writes', async () => {
    for (const headers of [
      { Host: 'evil.example', 'Content-Type': 'application/json' },
      { Origin: 'https://evil.example', 'Content-Type': 'application/json' },
      { 'Content-Type': 'text/plain; application/json' },
    ] as Record<string, string>[]) {
      const code = await new Promise<number>((resolve, reject) => {
        const req = request(`${base}/api/progress`, { method: 'PUT', headers }, (res) => {
          res.resume()
          res.on('end', () => resolve(res.statusCode!))
        })
        req.on('error', reject)
        req.end(JSON.stringify({ baseRevision: 0, progress: {} }))
      })
      expect([403, 415]).toContain(code)
    }
    expect(await readStored(dir)).toBeNull()
  })

  it('supports the load → save → conflict cycle', async () => {
    expect((await fetch(`${base}/api/progress`)).status).toBe(404)
    const saved = await put({ tasks: {} }, 0)
    expect(saved.status).toBe(200)
    expect(((await saved.json()) as { revision: number }).revision).toBe(1)

    const loaded = await (await fetch(`${base}/api/progress`)).json()
    expect(loaded).toMatchObject({ revision: 1, progress: { tasks: {} } })

    const conflict = await put({ tasks: { stale: true } }, 0)
    expect(conflict.status).toBe(409)
    expect(await conflict.json()).toMatchObject({ revision: 1, progress: { tasks: {} } })
  })

  it('serves a single snapshot by name and refuses paths outside backups', async () => {
    await put({ tasks: { A1: { status: 'completed' } } }, 0)
    const name = await createSnapshot(dir, 'manual')
    const ok = await fetch(`${base}/api/backups/${name}`)
    expect(ok.status).toBe(200)
    expect(await ok.json()).toMatchObject({ progress: { tasks: { A1: { status: 'completed' } } } })
    expect((await fetch(`${base}/api/backups/progress-missing.json`)).status).toBe(404)
    expect((await fetch(`${base}/api/backups/..%2Fprogress.json`)).status).toBe(404)
    expect((await fetch(`${base}/api/backups/progress.json`)).status).toBe(404)
  })

  it('validates input and ignores non-API paths', async () => {
    const bad = await fetch(`${base}/api/progress`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: '{"progress": []}',
    })
    expect(bad.status).toBe(400)
    expect((await fetch(`${base}/index.html`)).status).toBe(418)
    expect((await fetch(`${base}/api/unknown`)).status).toBe(404)
  })
})

describe('incident reports', () => {
  let server: Server
  let base: string

  beforeEach(async () => {
    const api = createProgressApi({ dataDir: dir })
    server = createServer((req, res) => void api(req, res))
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })
  afterEach(async () => {
    await new Promise((resolve) => server.close(resolve))
  })

  const report = (over: Record<string, unknown> = {}) => ({
    format: 'homeops-incident-report',
    id: '0b6c1f0e-1111-4c1d-9d5e-123456789abc',
    incidentId: 'sse-streaming',
    at: '2026-10-07T10:00:00Z',
    passed: true,
    checks: [
      { id: 'ttft', title: 'TTFT', ok: true, message: 'ok' },
      { id: 'long-prompt', title: 'Long', ok: false, message: 'HTTP 504' },
    ],
    env: { arch: 'aarch64' },
    ...over,
  })
  const send = (body: unknown) =>
    fetch(`${base}/api/incidents/reports`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

  it('stores reports separately from progress, recomputes passed and dedupes by id', async () => {
    const res = await send(report())
    expect(res.status).toBe(201)
    // passed пересчитывается по проверкам, а не берётся из отчёта
    expect(await res.json()).toMatchObject({ passed: false })
    expect((await send(report())).status).toBe(201)

    const { reports } = (await (await fetch(`${base}/api/incidents/reports`)).json()) as {
      reports: unknown[]
    }
    expect(reports).toHaveLength(1)
    expect(reports[0]).toMatchObject({
      incidentId: 'sse-streaming',
      passed: false,
      arch: 'aarch64',
    })
    expect(await readStored(dir)).toBeNull()
  })

  it('rejects malformed reports', async () => {
    expect((await send({ ...report(), format: 'other' })).status).toBe(400)
    expect((await send(report({ incidentId: '../etc' }))).status).toBe(400)
    expect((await send(report({ checks: [] }))).status).toBe(400)
    expect((await send(report({ at: 'вчера' }))).status).toBe(400)
  })
})
