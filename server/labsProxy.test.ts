import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { proxyLabs } from './labsProxy.ts'
import { runLabAction } from '../src/lib/labs'
import { vi } from 'vitest'

const servers: Server[] = []
async function listen(server: Server): Promise<string> {
  servers.push(server)
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`
}

afterEach(async () => {
  vi.unstubAllGlobals()
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.closeAllConnections()
          server.close(() => resolve())
        }),
    ),
  )
})

describe('labs HTTP proxy', () => {
  it('finishes an aborted upstream response so the client can retry', async () => {
    let attempts = 0
    const upstream = await listen(
      createServer((_req, res) => {
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' })
        res.write('Запуск…\n')
        if (++attempts === 1) setImmediate(() => res.destroy())
        else res.end('Готово\n__EXIT__ 0\n')
      }),
    )
    const proxy = await listen(createServer((req, res) => proxyLabs(req, res, new URL(upstream))))
    const realFetch = globalThis.fetch
    vi.stubGlobal('fetch', (input: string, init?: RequestInit) => realFetch(proxy + input, init))
    const chunks: string[] = []
    expect(await runLabAction('sse-streaming', 'up', undefined, (s) => chunks.push(s))).toBe(-1)
    expect(chunks.join('')).toContain('Обновите состояние стенда')
    expect(await runLabAction('sse-streaming', 'up', undefined, () => {})).toBe(0)
  })

  it('returns a clear 503 when the labs service is not configured', async () => {
    const proxy = await listen(createServer((req, res) => proxyLabs(req, res, null)))
    const res = await fetch(`${proxy}/api/labs/status`)
    expect(res.status).toBe(503)
    expect(await res.json()).toHaveProperty('error')
  })
  it('finishes a hung upstream within its deadline', async () => {
    const upstream = await listen(createServer((_req, _res) => {}))
    const proxy = await listen(
      createServer((req, res) => proxyLabs(req, res, new URL(upstream), 30)),
    )
    expect((await fetch(`${proxy}/api/labs/status`)).status).toBe(503)
  })
})
