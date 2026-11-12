import { describe, expect, it } from 'vitest'
import {
  parseTerminalMessage,
  composeExclusive,
  composeRole,
  liveCheckCommand,
  containerMemory,
  terminalDir,
  terminalHint,
  isAllowedRequest,
  isBaseImageUnavailable,
  parseClusterNodes,
  parseDockerPs,
  parseLiveOutput,
  presetLabel,
} from './labs.ts'
import { acceptKey, decodeFrame, encodeFrame } from './websocket.ts'

describe('labs service guards', () => {
  it('accepts only local hosts and same-origin browser requests', () => {
    expect(isAllowedRequest({ host: 'localhost:8080' })).toBe(true)
    expect(isAllowedRequest({ host: '127.0.0.1:8080', origin: 'http://127.0.0.1:8080' })).toBe(true)
    expect(isAllowedRequest({ host: 'labs:8090' })).toBe(true) // внутренняя сеть compose
    // DNS rebinding: чужое имя, указывающее на 127.0.0.1
    expect(isAllowedRequest({ host: 'evil.example:8080' })).toBe(false)
    // CSRF и подмена WebSocket с другого сайта
    expect(isAllowedRequest({ host: 'localhost:8080', origin: 'https://evil.example' })).toBe(false)
    expect(isAllowedRequest({ host: 'localhost:8080', origin: 'http://localhost:5173' })).toBe(
      false,
    )
    expect(isAllowedRequest({ host: 'localhost:8080', origin: 'null' })).toBe(false)
  })

  it('groups compose containers by incident and skips foreign projects', () => {
    const line = (o: Record<string, string>) => JSON.stringify(o)
    const out = [
      line({
        Names: 'inc-sse-streaming-proxy-1',
        State: 'running',
        Status: 'Up 2 minutes',
        Labels:
          'com.docker.compose.project=inc-sse-streaming,com.docker.compose.service=proxy,com.docker.compose.oneoff=False',
      }),
      line({
        Names: 'inc-rag-retrieval-qdrant-1',
        State: 'running',
        Status: 'Up 5 seconds (health: starting)',
        Labels: 'com.docker.compose.service=qdrant,com.docker.compose.project=inc-rag-retrieval',
      }),
      line({
        Names: 'homeops-labs',
        State: 'running',
        Status: 'Up',
        Labels: 'com.docker.compose.project=ml-ops,com.docker.compose.service=labs',
      }),
      'not json',
    ].join('\n')
    const parsed = parseDockerPs(out)
    expect(Object.keys(parsed).sort()).toEqual(['rag-retrieval', 'sse-streaming'])
    expect(parsed['sse-streaming'][0]).toMatchObject({
      service: 'proxy',
      state: 'running',
      oneoff: false,
    })
    expect(parsed['rag-retrieval'][0].health).toBe('health: starting')
  })

  it('takes the preset label from the first comment line', () => {
    expect(presetLabel('# Qwen2.5-3B — по умолчанию\nLLM_MODEL=x\n', 'qwen2.5-3b')).toBe(
      'Qwen2.5-3B — по умолчанию',
    )
    expect(presetLabel('LLM_MODEL=x\n', 'qwen2.5-3b')).toBe('qwen2.5-3b')
  })
})

describe('kubernetes stands', () => {
  it('detects the stand role from compose labels', () => {
    expect(composeRole('labels: { homeops.role: k8s }')).toBe('k8s')
    expect(composeRole('    labels: { homeops.role: server }')).toBe('server')
    expect(composeRole('labels: { homeops.role: k8sx }')).toBeNull()
    expect(composeRole('services: {}')).toBeNull()
    expect(composeRole('labels: { homeops.role: compose-gym }')).toBe('compose-gym')
    expect(composeRole('labels: { homeops.role: compose-gymx }')).toBeNull()
    expect(liveCheckCommand('compose-gym')).toEqual(['shell', 'python', '/tools/verify.py', '--live'])
    expect(liveCheckCommand('k8s')).toEqual(['kubectl', 'python', '/tools/verify.py', '--live'])
    expect(liveCheckCommand('server')).toEqual(['server', 'verify', '--live'])
  })

  it('parses kind nodes of the shared cluster', () => {
    const out = [
      JSON.stringify({
        Names: 'homeops-worker',
        State: 'running',
        Status: 'Up 2 minutes',
        Labels: 'io.x-k8s.kind.cluster=homeops,io.x-k8s.kind.role=worker',
      }),
      JSON.stringify({
        Names: 'homeops-control-plane',
        State: 'exited',
        Status: 'Exited (137)',
        Labels: 'io.x-k8s.kind.role=control-plane,io.x-k8s.kind.cluster=homeops',
      }),
      'not json',
    ].join('\n')
    expect(parseClusterNodes(out)).toEqual([
      {
        name: 'homeops-control-plane',
        role: 'control-plane',
        state: 'exited',
        status: 'Exited (137)',
      },
      { name: 'homeops-worker', role: 'worker', state: 'running', status: 'Up 2 minutes' },
    ])
  })
})

describe('websocket frames', () => {
  it('computes the RFC 6455 accept key', () => {
    expect(acceptKey('dGhlIHNhbXBsZSBub25jZQ==')).toBe('s3pPLMBiTxaQ9kYGzzhZRbK+xOo=')
  })

  it('decodes masked client frames and waits for incomplete data', () => {
    const payload = Buffer.from('{"t":"i","d":"ls\\n"}')
    const mask = Buffer.from([1, 2, 3, 4])
    const masked = Buffer.from(payload.map((b, i) => b ^ mask[i % 4]))
    const frame = Buffer.concat([Buffer.from([0x81, 0x80 | payload.length]), mask, masked])
    expect(decodeFrame(frame.subarray(0, 5))).toBeNull()
    const decoded = decodeFrame(frame)!
    expect(decoded).toMatchObject({ fin: true, opcode: 1, length: frame.length })
    expect(decoded.payload.toString()).toBe(payload.toString())
  })

  it('round-trips server frames of all length encodings', () => {
    for (const size of [5, 300, 70_000]) {
      const data = Buffer.alloc(size, 7)
      const f = decodeFrame(encodeFrame(0x2, data))!
      expect(f.opcode).toBe(2)
      expect(f.payload.equals(data)).toBe(true)
    }
  })
})

describe('live check output', () => {
  it('reads the last HOMEOPS_LIVE line and keeps only well-formed checks', () => {
    const out = [
      'Warning: some compose noise',
      'HOMEOPS_LIVE {"at":"2026-10-08T10:00:00Z","checks":[{"id":"old","ok":true}]}',
      'HOMEOPS_LIVE {"at":"2026-10-08T10:00:05Z","checks":[{"id":"rep-1","title":"Создать","ok":true,"message":"готово"},{"id":"rep-2","ok":"yes"},{"title":"без id"}]}',
    ].join('\n')
    expect(parseLiveOutput(out)).toEqual({
      at: '2026-10-08T10:00:05Z',
      checks: [
        { id: 'rep-1', title: 'Создать', ok: true, message: 'готово' },
        // ok засчитывается только как true, а не как непустая строка
        { id: 'rep-2', title: '', ok: false, message: '' },
      ],
    })
  })

  it('returns null when the check printed nothing usable', () => {
    expect(parseLiveOutput('Error: service "kubectl" is not running')).toBeNull()
    expect(parseLiveOutput('HOMEOPS_LIVE {broken')).toBeNull()
    expect(parseLiveOutput('HOMEOPS_LIVE {"checks":"nope"}')).toBeNull()
  })
})

describe('stand start without registry', () => {
  it('recognizes a build that failed only because the base image could not be fetched', () => {
    expect(
      isBaseImageUnavailable(
        'failed to solve: ubuntu:24.04: failed to resolve source metadata for docker.io/library/ubuntu:24.04: failed to do request: Head "https://registry-1.docker.io/v2/library/ubuntu/manifests/24.04": EOF',
      ),
    ).toBe(true)
    // ошибка в самом Dockerfile — не повод запускать старый образ
    expect(
      isBaseImageUnavailable(
        '#8 ERROR: process "/bin/sh -c pip install -r requirements.txt" did not complete successfully: exit code: 1',
      ),
    ).toBe(false)
    expect(isBaseImageUnavailable('Error response from daemon: port is already allocated')).toBe(
      false,
    )
  })
})

describe('cluster-level stands', () => {
  it('are marked explicitly in compose', () => {
    expect(composeExclusive('labels: { homeops.role: k8s, homeops.cluster: exclusive }')).toBe(true)
    expect(composeExclusive('labels: { homeops.role: k8s }')).toBe(false)
    expect(composeExclusive('labels: { homeops.cluster: exclusiveness }')).toBe(false)
  })
})

describe('stand memory', () => {
  const info = (over: Record<string, unknown> = {}, labels: Record<string, string> = {}) => ({
    Name: '/inc-docker-oom-healthcheck-api-1',
    RestartCount: 3,
    State: { Status: 'running', Running: true, OOMKilled: true },
    HostConfig: { Memory: 268_435_456 },
    Config: {
      Labels: {
        'com.docker.compose.project': 'inc-docker-oom-healthcheck',
        'com.docker.compose.service': 'api',
        ...labels,
      },
    },
    ...over,
  })
  const stats = {
    memory_stats: { usage: 200_000_000, limit: 268_435_456, stats: { inactive_file: 20_000_000 } },
  }

  it('reports usage like docker stats, the configured limit and OOM kills', () => {
    expect(containerMemory(info(), stats)).toEqual({
      service: 'api',
      name: 'inc-docker-oom-healthcheck-api-1',
      state: 'running',
      used: 180_000_000,
      limit: 268_435_456,
      available: 268_435_456,
      oomKilled: true,
      restarts: 3,
    })
  })

  it('treats a zero limit as no limit and a stopped container as unknown usage', () => {
    const r = containerMemory(
      info({
        HostConfig: { Memory: 0 },
        State: { Status: 'exited', Running: false, OOMKilled: false },
      }),
      null,
    )
    expect(r).toMatchObject({
      limit: null,
      used: null,
      available: null,
      state: 'exited',
      oomKilled: false,
    })
  })

  it('skips foreign projects, one-off containers and the terminal', () => {
    expect(containerMemory(info({}, { 'com.docker.compose.project': 'ml-ops' }), stats)).toBeNull()
    expect(containerMemory(info({}, { 'com.docker.compose.oneoff': 'True' }), stats)).toBeNull()
    expect(
      containerMemory(info({ Name: '/inc-docker-oom-healthcheck-terminal' }), stats),
    ).toBeNull()
  })
})

describe('compose stand terminal', () => {
  it('takes the tool hint from the homeops.terminal label without control characters', () => {
    expect(terminalHint({ 'homeops.terminal': 'Есть python, uv, ruff.' })).toBe(
      'Есть python, uv, ruff.',
    )
    expect(terminalHint({ 'homeops.terminal': 'a\u001b[31mb\nc' })).toBe('a [31mb c')
    expect(terminalHint({ 'homeops.terminal': 'x'.repeat(500) })).toHaveLength(200)
    expect(terminalHint({})).toBeNull()
    expect(terminalHint(null)).toBeNull()
  })

  it('opens in the service working_dir only inside /scenario', () => {
    expect(terminalDir('/scenario/project')).toBe('/scenario/project')
    expect(terminalDir('/scenario')).toBe('/scenario')
    expect(terminalDir('/etc')).toBe('/scenario')
    expect(terminalDir('/scenario/../etc')).toBe('/scenario')
    expect(terminalDir(undefined)).toBe('/scenario')
  })
})

describe('review: terminal input bounds', () => {
  const parse = (v: unknown) => parseTerminalMessage(Buffer.from(JSON.stringify(v)))
  it('ignores null, arrays, primitives, oversized input and invalid window sizes', () => {
    for (const v of [
      null,
      [],
      1,
      { t: 'r', c: -1, r: 24 },
      { t: 'r', c: 100000, r: 24 },
      { t: 'r', c: 80, r: 0 },
      { t: 'r', c: 80.5, r: 24 },
      { t: 'i', d: 'x'.repeat(65536) },
    ])
      expect(parse(v)).toBeNull()
    expect(parse({ t: 'i', d: 'ls\n' })).toEqual({ t: 'i', d: 'ls\n' })
    expect(parse({ t: 'r', c: 80, r: 24 })).toEqual({ t: 'r', c: 80, r: 24 })
  })
  it('rejects invalid Host ports and Origin schemes/credentials/paths', () => {
    for (const host of ['localhost:0', 'localhost:70000', 'localhost:8080x', 'evil .localhost'])
      expect(isAllowedRequest({ host })).toBe(false)
    for (const origin of [
      'ftp://localhost:8080',
      'http://user@localhost:8080',
      'http://localhost:8080/path',
      'http://localhost:8080/?q=x',
    ])
      expect(isAllowedRequest({ host: 'localhost:8080', origin })).toBe(false)
  })
})
