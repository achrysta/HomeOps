import { afterEach, describe, expect, it, vi } from 'vitest'
import { cliCommands, clusterState, fetchLabsStatus, formatMemory, memoryShare, nextLabsStatus, presetParts, runLabAction, standKind, standState, type LabContainer } from './labs'

afterEach(() => vi.unstubAllGlobals())

const c = (over: Partial<LabContainer>): LabContainer => ({ service: 'llm', name: 'inc-x-llm-1', state: 'running', status: 'Up 1 minute', oneoff: false, ...over })

describe('labs client', () => {
  it('reports a broken output stream and allows the next action to finish', async () => {
    let stream!: ReadableStreamDefaultController<Uint8Array>
    const broken = new ReadableStream<Uint8Array>({ start(controller) { stream = controller } })
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(broken)).mockResolvedValueOnce(new Response('готово\n__EXIT__ 0\n'))
    vi.stubGlobal('fetch', fetchMock)
    const chunks: string[] = []
    const action = runLabAction('sse-streaming', 'up', undefined, (s) => chunks.push(s))
    stream.enqueue(new TextEncoder().encode('Запуск…\n'))
    await vi.waitFor(() => expect(chunks).toContain('Запуск…\n'))
    stream.error(new Error('connection reset'))
    expect(await action).toBe(-1)
    expect(chunks.join('')).toContain('Обновите состояние стенда')
    expect(broken.locked).toBe(false)
    expect(await runLabAction('sse-streaming', 'up', undefined, () => {})).toBe(0)
  })

  it('does not report a truncated output stream as a failed verification', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('Проверка запущена…\n')))
    const chunks: string[] = []
    expect(await runLabAction('sse-streaming', 'verify', undefined, (s) => chunks.push(s))).toBe(-1)
    expect(chunks.join('')).toContain('Обновите состояние стенда')
  })

  it('splits a preset label into a short name and details', () => {
    expect(presetParts('Qwen2.5-3B — по умолчанию: ≈ 2 ГБ')).toEqual({ name: 'Qwen2.5-3B', details: 'По умолчанию: ≈ 2 ГБ' })
    expect(presetParts('qwen2.5-3b')).toEqual({ name: 'qwen2.5-3b', details: '' })
  })

  it('derives the stand state from long-running services only', () => {
    expect(standState([])).toBe('stopped')
    expect(standState([c({}), c({ service: 'verify', name: 'inc-x-verify-run-1', oneoff: true, state: 'exited', status: 'Exited (1)' })])).toBe('running')
    // одноразовая индексация завершилась успешно — стенд работает
    expect(standState([c({}), c({ service: 'ingest', name: 'inc-x-ingest-1', state: 'exited', status: 'Exited (0) 1 minute ago' })])).toBe('running')
    expect(standState([c({ status: 'Up 5 seconds (health: starting)', health: 'health: starting' })])).toBe('starting')
    expect(standState([c({}), c({ service: 'proxy', name: 'inc-x-proxy-1', state: 'exited', status: 'Exited (1) 2 seconds ago' })])).toBe('degraded')
    // воркер падает по OOM и перезапускается, API ждёт его здоровья — стенд сломан, а не остановлен
    expect(standState([c({ service: 'worker', state: 'restarting', status: 'Restarting (137) 3 seconds ago' }), c({ service: 'api', name: 'inc-x-api-1', state: 'created', status: 'Created' })])).toBe('degraded')
  })
})

describe('kubernetes stands in the client', () => {
  it('knows the stand kind and cluster state', () => {
    expect(standKind({ server: true })).toBe('server')
    expect(standKind({ cluster: true })).toBe('cluster')
    expect(standKind({})).toBe('compose')
    expect(clusterState([])).toBe('none')
    expect(clusterState([{ name: 'a', role: 'worker', state: 'running', status: '' }])).toBe('running')
    expect(clusterState([{ name: 'a', role: 'worker', state: 'running', status: '' }, { name: 'b', role: 'control-plane', state: 'exited', status: '' }])).toBe('partial')
  })

  it('gives CLI commands that create the shared cluster before the stand', () => {
    const cmds = cliCommands('k8s-crashloop', undefined, 'cluster').map((c) => c.cmd)
    const cluster = cmds.findIndex((c) => c.includes('cluster up'))
    expect(cluster).toBeGreaterThan(0)
    expect(cmds.findIndex((c) => c === 'docker compose up -d --wait')).toBeGreaterThan(cluster)
    expect(cmds).toContain('docker compose exec kubectl bash -l')
    expect(cmds.at(-1)).toContain('cluster down')
  })

  it.each(['k8s-node-notready', 'k8s-control-plane'])('prepares node faults on a fresh cluster for manual %s', (id) => {
    const cmds = cliCommands(id, undefined, 'cluster', true).map((c) => c.cmd)
    const at = (part: string) => cmds.findIndex((cmd) => cmd.includes(part))
    expect(at('docker compose down')).toBeGreaterThan(0)
    expect(at('cluster down')).toBeGreaterThan(at('docker compose down'))
    expect(at('cluster up')).toBeGreaterThan(at('cluster down'))
    expect(at(`cluster prepare ${id}`)).toBeGreaterThan(at('cluster up'))
    expect(at('docker compose up -d --wait')).toBeGreaterThan(at(`cluster prepare ${id}`))
    expect(at('docker compose run --rm verify')).toBeGreaterThan(at('docker compose up -d --wait'))
    expect(cmds).toContain('docker exec -it homeops-worker bash -l')
    expect(cmds).toContain('docker exec -it homeops-control-plane bash -l')
    expect(new Set(cmds).size).toBe(cmds.length)
  })
})

describe('labs status', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('turns a hung labs service into an error status instead of waiting forever', async () => {
    vi.stubGlobal('fetch', (_url: string, init?: RequestInit) => new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))))
    const st = await fetchLabsStatus(20)
    expect(st).toMatchObject({ ok: false, incidents: {} })
    expect(st?.error).toContain('не ответил')
  })

  it('reports an unreachable service as null so the page shows manual commands', async () => {
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ error: 'down' }), { status: 503, headers: { 'Content-Type': 'application/json' } }))
    expect(await fetchLabsStatus()).toBeNull()
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('connection refused')
    })
    expect(await fetchLabsStatus()).toBeNull()
  })
})

describe('labs status between polls', () => {
  const good = { ok: true, docker: true, hostDir: '/x', incidents: {} }
  const slow = { ok: false, docker: false, hostDir: null, incidents: {}, error: 'не ответил', timedOut: true }

  it('keeps the last good status through a couple of slow answers, then shows the error', () => {
    let r = nextLabsStatus(good, slow, 0)
    expect(r.status).toBe(good)
    r = nextLabsStatus(r.status, slow, r.timeouts)
    expect(r.status).toBe(good)
    r = nextLabsStatus(r.status, slow, r.timeouts)
    expect(r.status).toBe(slow)
    // ответ пришёл — счётчик сбрасывается
    expect(nextLabsStatus(slow, good, r.timeouts)).toEqual({ status: good, timeouts: 0 })
  })

  it('shows a timeout at once when there was no good status, and an outage (null) at once', () => {
    expect(nextLabsStatus(undefined, slow, 0).status).toBe(slow)
    expect(nextLabsStatus(good, null, 0).status).toBeNull()
  })
})

describe('stand memory', () => {
  it('formats sizes in Russian units', () => {
    expect(formatMemory(5.5 * 1024 ** 2)).toBe('5,5 МБ')
    expect(formatMemory(182 * 1024 ** 2)).toBe('182 МБ')
    expect(formatMemory(1.5 * 1024 ** 3)).toBe('1,5 ГБ')
  })

  it('measures the share against the limit, or against all Docker memory without one', () => {
    expect(memoryShare({ used: 200, limit: 256, available: 256 })).toBeCloseTo(0.78)
    expect(memoryShare({ used: 200, limit: null, available: 8000 })).toBeCloseTo(0.025)
    expect(memoryShare({ used: null, limit: 256, available: null })).toBeNull()
  })
})
