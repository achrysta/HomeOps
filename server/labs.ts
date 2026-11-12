// Сервис стендов инцидентов: запуск, проверка, живая проверка, сброс, логи и терминал для incidents/<id>.
// Работает в отдельном контейнере с доступом к Docker (сокет) и выполняет только фиксированный
// набор действий над папками incidents/*. Дашборд проксирует к нему /api/labs/*.
//
// Безопасность: доступ к Docker равен правам администратора Docker, поэтому
// - принимаются только запросы с локальным Host (защита от DNS rebinding);
// - запросы браузера с чужим Origin отклоняются (CSRF и подмена WebSocket с других сайтов);
// - id инцидента и пресет модели сверяются со списком папок и файлов, произвольных команд нет.
// Kubernetes-стенды живут в общем кластере kind: его создаёт и удаляет служебный сервис
// incidents/_shared/k8s (cluster up/down/prepare) — тоже фиксированное действие, а не произвольная команда.
// Стенды уровня кластера (homeops.cluster: exclusive) работают по одному на свежем кластере; терминал
// в узел kind открывается только им и только в узел из фиксированного списка (control-plane, worker).

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readFile, readdir, stat, symlink } from 'node:fs/promises'
import { request, type IncomingMessage, type ServerResponse } from 'node:http'
import { hostname } from 'node:os'
import path from 'node:path'
import { probeNvidia, type NvidiaCapability } from '../scripts/gpuCapability.ts'
import type { Duplex } from 'node:stream'
import { isAllowedRequest } from './requestGuards.ts'
export { isAllowedRequest } from './requestGuards.ts'
import { acceptWebSocket } from './websocket.ts'

export type LabAction = 'up' | 'verify' | 'reset' | 'down'

export interface LabContainer {
  service: string
  name: string
  state: string
  status: string
  health?: string
  oneoff: boolean
  /** homeops.role: server — учебный Linux-сервер (терминал и проверка внутри него);
   *  k8s — рабочее место стенда в общем Kubernetes-кластере (терминал с kubectl) */
  role?: string
}

export type LabRole = 'server' | 'k8s' | 'compose-gym'

/** Узел общего кластера kind, в котором живут Kubernetes-стенды */
export interface ClusterNode {
  name: string
  role: string
  state: string
  status: string
}

/** Имя кластера kind и его служебный compose (incidents/_shared/k8s) */
export const CLUSTER_NAME = 'homeops'
const CLUSTER_COMPOSE = path.join('_shared', 'k8s', 'compose.yaml')

/** Роль стенда по метке homeops.role в compose.yaml */
export function composeRole(compose: string): LabRole | null {
  const m = /homeops\.role:\s*(compose-gym|server|k8s)\b/.exec(compose)
  return m ? (m[1] as LabRole) : null
}

/** Только фиксированная команда в рабочем месте, без аргументов от клиента. */
export function liveCheckCommand(role: LabRole): string[] {
  if (role === 'server') return ['server', 'verify', '--live']
  return [role === 'k8s' ? 'kubectl' : 'shell', 'python', '/tools/verify.py', '--live']
}

/**
 * Стенд уровня кластера (метка homeops.cluster: exclusive): ломает узлы или control plane, поэтому
 * работает один на свежем кластере, а сброс и остановка пересоздают или удаляют кластер целиком.
 */
export function composeExclusive(compose: string): boolean {
  return /homeops\.cluster:\s*exclusive\b/.test(compose)
}

export function composeRequiresNvidia(compose: string): boolean {
  return /homeops\.requires:\s*["']?nvidia-gpu\b/.test(compose)
}

/** Узлы кластера, в которые открывается терминал стенда уровня кластера */
export const CLUSTER_NODE_ROLES = ['control-plane', 'worker'] as const
export type ClusterNodeRole = (typeof CLUSTER_NODE_ROLES)[number]

/** Строки `docker ps --format '{{json .}}'` узлов kind → узлы кластера. */
export function parseClusterNodes(output: string): ClusterNode[] {
  const nodes: ClusterNode[] = []
  for (const line of output.split('\n')) {
    if (!line.trim()) continue
    try {
      const row = JSON.parse(line) as Record<string, string>
      const role = /io\.x-k8s\.kind\.role=([a-z-]+)/.exec(String(row.Labels ?? ''))?.[1] ?? ''
      nodes.push({
        name: String(row.Names ?? ''),
        role,
        state: String(row.State ?? ''),
        status: String(row.Status ?? ''),
      })
    } catch {
      continue
    }
  }
  return nodes.sort((a, b) => a.name.localeCompare(b.name))
}

export interface LabPreset {
  id: string
  label: string
}

/** Результат живой проверки (verify --live): лёгкие проверки без отчёта и без зачёта */
export interface LiveCheck {
  id: string
  title: string
  ok: boolean
  message: string
}
export interface LiveResult {
  at: string
  checks: LiveCheck[]
}

/**
 * Сборка упала, потому что не удалось получить базовый образ из registry (нет сети или
 * Docker Hub недоступен). Тогда стенд можно запустить на уже собранном образе — без --build.
 */
export function isBaseImageUnavailable(output: string): boolean {
  return /failed to resolve source metadata|failed to do request: Head "https:\/\/[^"]*\/manifests\/|pull access denied|TLS handshake timeout/.test(
    output,
  )
}

/** Итог verify --live — последняя строка «HOMEOPS_LIVE {json}» в выводе команды. */
export function parseLiveOutput(output: string): LiveResult | null {
  const line = output
    .split('\n')
    .reverse()
    .find((l) => l.startsWith('HOMEOPS_LIVE '))
  if (!line) return null
  try {
    const data = JSON.parse(line.slice('HOMEOPS_LIVE '.length)) as { at?: unknown; checks?: unknown }
    if (!Array.isArray(data.checks)) return null
    const checks = data.checks
      .filter(
        (c): c is Record<string, unknown> =>
          typeof c === 'object' && c !== null && typeof (c as { id?: unknown }).id === 'string',
      )
      .map((c) => ({
        id: String(c.id),
        title: String(c.title ?? ''),
        ok: c.ok === true,
        message: String(c.message ?? '').slice(0, 600),
      }))
    return { at: String(data.at ?? ''), checks }
  } catch {
    return null
  }
}

export interface LabsOptions {
  /** Папка incidents внутри контейнера сервиса */
  incidentsDir: string
  dockerSocket?: string
  /** Адрес дашборда во внутренней сети: туда пересылаются отчёты verify */
  dashboardUrl?: string
  /** Ограничения ресурсов сервиса; также позволяют проверять таймауты без Docker. */
  dockerTimeoutMs?: number
  commandTimeoutMs?: number
  maxRequests?: number
}

/** Строки `docker ps --format '{{json .}}'` → контейнеры стендов по id инцидента. */
export function parseDockerPs(output: string): Record<string, LabContainer[]> {
  const byIncident: Record<string, LabContainer[]> = {}
  for (const line of output.split('\n')) {
    if (!line.trim()) continue
    let row: Record<string, string>
    try {
      row = JSON.parse(line) as Record<string, string>
    } catch {
      continue
    }
    const labels = Object.fromEntries(
      String(row.Labels ?? '')
        .split(',')
        .map((kv) => {
          const i = kv.indexOf('=')
          return i > 0 ? [kv.slice(0, i), kv.slice(i + 1)] : [kv, '']
        }),
    )
    const project = labels['com.docker.compose.project'] ?? ''
    if (!project.startsWith('inc-')) continue
    const status = String(row.Status ?? '')
    const health = /\((healthy|unhealthy|health: starting)\)/.exec(status)?.[1]
    ;(byIncident[project.slice(4)] ??= []).push({
      service: labels['com.docker.compose.service'] ?? '',
      name: String(row.Names ?? ''),
      state: String(row.State ?? ''),
      status,
      ...(health ? { health } : {}),
      oneoff: labels['com.docker.compose.oneoff'] === 'True',
      ...(labels['homeops.role'] ? { role: labels['homeops.role'] } : {}),
    })
  }
  return byIncident
}

/** Память контейнера стенда — чтобы ловушки с лимитом памяти были видны без терминала */
export interface LabMemory {
  service: string
  name: string
  state: string
  /** Занято байт, как в docker stats (без неактивного файлового кэша); null — контейнер не запущен */
  used: number | null
  /** Лимит памяти контейнера (mem_limit в compose); null — лимита нет */
  limit: number | null
  /** Сколько памяти контейнеру доступно на деле: лимит или вся память Docker */
  available: number | null
  /** Последнюю остановку контейнера вызвал OOM killer */
  oomKilled: boolean
  restarts: number
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

/**
 * Описание контейнера (GET /containers/{id}/json) и снимок статистики (GET /containers/{id}/stats?stream=false&one-shot=true)
 * → память контейнера стенда. Чужие проекты, одноразовые verify/shell и терминал пропускаются (null).
 */
export function containerMemory(info: unknown, stats: unknown): LabMemory | null {
  const c = (info ?? {}) as {
    Name?: unknown
    RestartCount?: unknown
    State?: { Status?: unknown; Running?: unknown; OOMKilled?: unknown }
    HostConfig?: { Memory?: unknown }
    Config?: { Labels?: Record<string, unknown> }
  }
  const labels = c.Config?.Labels ?? {}
  const name = String(c.Name ?? '').replace(/^\//, '')
  if (
    !String(labels['com.docker.compose.project'] ?? '').startsWith('inc-') ||
    labels['com.docker.compose.oneoff'] === 'True' ||
    name.endsWith('-terminal')
  )
    return null
  const m =
    (
      (stats ?? {}) as {
        memory_stats?: { usage?: unknown; limit?: unknown; stats?: Record<string, unknown> }
      }
    ).memory_stats ?? {}
  const usage = c.State?.Running === true ? num(m.usage) : null
  // Как docker stats: cgroup v2 — inactive_file, cgroup v1 — total_inactive_file
  const inactive = num(m.stats?.inactive_file) ?? num(m.stats?.total_inactive_file) ?? 0
  const limit = num(c.HostConfig?.Memory)
  return {
    service: String(labels['com.docker.compose.service'] ?? ''),
    name,
    state: String(c.State?.Status ?? ''),
    used: usage === null ? null : inactive < usage ? usage - inactive : usage,
    limit: limit && limit > 0 ? limit : null,
    available: usage === null ? null : num(m.limit),
    oomKilled: c.State?.OOMKilled === true,
    restarts: num(c.RestartCount) ?? 0,
  }
}

/** Первая строка env-файла пресета вида «# Qwen2.5-3B — …» — подпись в интерфейсе. */
export function presetLabel(content: string, fallback: string): string {
  const first = content.split('\n').find((l) => l.trim())
  return first?.startsWith('#') ? first.replace(/^#\s*/, '').trim() || fallback : fallback
}

export const terminalName = (id: string) => `inc-${id}-terminal`

/** Описание терминала compose-стенда из метки homeops.terminal сервиса shell: какие инструменты есть в образе.
 *  Управляющие символы вырезаются (текст уходит прямо в терминал), длина ограничена. */
export function terminalHint(labels: unknown): string | null {
  const raw = (labels as Record<string, unknown> | null)?.['homeops.terminal']
  if (typeof raw !== 'string') return null
  const visible = [...raw].map((ch) => {
    const code = ch.charCodeAt(0)
    return code < 0x20 || (code >= 0x7f && code <= 0x9f) ? ' ' : ch
  })
  const text = visible.join('').replace(/\s+/g, ' ').trim().slice(0, 200)
  return text || null
}

/** Каталог, в котором открывается терминал compose-стенда: working_dir сервиса shell, если он внутри /scenario */
export function terminalDir(workingDir: unknown): string {
  return typeof workingDir === 'string' &&
    /^\/scenario(\/[A-Za-z0-9._-]+)*$/.test(workingDir) &&
    !workingDir.split('/').includes('..')
    ? workingDir
    : '/scenario'
}

function parseJson(text: string): unknown {
  try {
    return text ? JSON.parse(text) : null
  } catch {
    return text
  }
}

interface RunResult {
  code: number
  stdout: string
}

export type TerminalMessage = { t: 'i'; d: string } | { t: 'r'; c: number; r: number }
export function parseTerminalMessage(data: Buffer): TerminalMessage | null {
  if (data.length > 64 * 1024) return null
  try {
    const msg: unknown = JSON.parse(data.toString('utf8'))
    if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return null
    const m = msg as Record<string, unknown>
    if (m.t === 'i' && typeof m.d === 'string') return { t: 'i', d: m.d }
    if (
      m.t === 'r' &&
      typeof m.c === 'number' &&
      typeof m.r === 'number' &&
      Number.isInteger(m.c) &&
      Number.isInteger(m.r) &&
      m.c >= 1 &&
      m.c <= 1000 &&
      m.r >= 1 &&
      m.r <= 500
    )
      return { t: 'r', c: m.c, r: m.r }
  } catch {
    /* Некорректное сообщение не выполняется. */
  }
  return null
}

export function createLabsApi({
  incidentsDir,
  dockerSocket = '/var/run/docker.sock',
  dashboardUrl,
  dockerTimeoutMs = 30_000,
  commandTimeoutMs = 300_000,
  maxRequests = 32,
}: LabsOptions) {
  const busy = new Set<string>()
  // Путь папки incidents на хосте: compose передаёт пути bind-монтирования демону Docker,
  // и они должны быть путями хоста. Узнаём его из описания своего контейнера и делаем ссылку.
  let hostDir: string | null = null
  let setupError: string | null = null
  let setupPending: Promise<void> | null = null
  let activeRequests = 0
  let activeTerminals = 0
  let pendingDocker = 0
  let gpuCached: { at: number; value: NvidiaCapability } | null = null
  let gpuPending: Promise<NvidiaCapability> | null = null

  async function gpuStatus(): Promise<NvidiaCapability> {
    if (gpuCached && Date.now() - gpuCached.at < 30_000) return gpuCached.value
    if (!gpuPending) {
      let timedOut = false
      gpuPending = probeNvidia(async (args) => {
        const result = await run(args, undefined, undefined, 20_000)
        timedOut ||= result.code === 124
        return result
      }).then((value) => {
        // Холодный NVIDIA hook может задержаться: таймаут не доказывает отсутствие GPU.
        gpuCached = timedOut ? null : { at: Date.now(), value }
        return value
      }).finally(() => { gpuPending = null })
    }
    return gpuPending
  }

  async function needsNvidia(id: string): Promise<boolean> {
    return composeRequiresNvidia(await readFile(path.join(incidentsDir, id, 'compose.yaml'), 'utf8'))
  }

  // ── Docker Engine API через сокет ────────────────────────────────────────
  function dockerApi(
    method: string,
    apiPath: string,
    body?: unknown,
  ): Promise<{ status: number; json: unknown }> {
    if (pendingDocker >= 64) return Promise.reject(new Error('Слишком много запросов к Docker'))
    pendingDocker++
    return new Promise<{ status: number; json: unknown }>((resolve, reject) => {
      const data = body === undefined ? undefined : Buffer.from(JSON.stringify(body))
      const req = request(
        {
          socketPath: dockerSocket,
          path: apiPath,
          method,
          headers: data
            ? { 'Content-Type': 'application/json', 'Content-Length': data.length }
            : {},
        },
        (res) => {
          const chunks: Buffer[] = []
          let size = 0
          res.on('aborted', () => req.destroy(new Error('Docker оборвал ответ')))
          res.on('error', (e) => req.destroy(e))
          res.on('data', (c: Buffer) => {
            size += c.length
            if (size > 8 * 1024 * 1024) req.destroy(new Error('Слишком большой ответ Docker'))
            else chunks.push(c)
          })
          res.on('end', () => {
            const text = Buffer.concat(chunks).toString('utf8')
            resolve({ status: res.statusCode ?? 0, json: parseJson(text) })
          })
        },
      )
      const timer = setTimeout(
        () => req.destroy(new Error('Docker не ответил вовремя')),
        dockerTimeoutMs,
      )
      req.on('close', () => clearTimeout(timer))
      req.on('error', reject)
      req.end(data)
    }).finally(() => {
      pendingDocker--
    })
  }

  async function setup(): Promise<void> {
    if (setupPending) return setupPending
    if (hostDir) return
    setupError = null
    setupPending = prepareHostDir().finally(() => {
      setupPending = null
    })
    return setupPending
  }

  async function prepareHostDir(): Promise<void> {
    if (hostDir || setupError) return
    try {
      const self = await dockerApi('GET', `/containers/${hostname()}/json`)
      const mounts =
        (self.json as { Mounts?: { Destination: string; Source: string }[] })?.Mounts ?? []
      const mount = mounts.find((m) => m.Destination === incidentsDir)
      if (!mount)
        throw new Error(`папка ${incidentsDir} не примонтирована в контейнер сервиса стендов`)
      hostDir = mount.Source
      if (hostDir !== incidentsDir && !existsSync(hostDir)) {
        await mkdir(path.dirname(hostDir), { recursive: true })
        await symlink(incidentsDir, hostDir)
      }
    } catch (e) {
      setupError = `Сервис стендов не смог подготовиться: ${e instanceof Error ? e.message : String(e)}`
      hostDir = null
    }
  }

  async function incidentIds(): Promise<string[]> {
    const names = await readdir(incidentsDir).catch(() => [] as string[])
    const ids: string[] = []
    for (const n of names.sort()) {
      if (n.startsWith('_') || n.startsWith('.')) continue
      if (existsSync(path.join(incidentsDir, n, 'compose.yaml'))) ids.push(n)
    }
    return ids
  }

  async function presets(id: string): Promise<LabPreset[]> {
    const dir = path.join(incidentsDir, id, 'models')
    const names = (await readdir(dir).catch(() => [] as string[]))
      .filter((n) => n.endsWith('.env'))
      .sort()
    return Promise.all(
      names.map(async (n) => {
        const presetId = n.slice(0, -4)
        return {
          id: presetId,
          label: presetLabel(await readFile(path.join(dir, n), 'utf8'), presetId),
        }
      }),
    )
  }

  /** Роль стенда: учебный сервер (homeops.role: server) или Kubernetes-стенд (homeops.role: k8s) */
  async function incidentRole(id: string): Promise<LabRole | null> {
    return composeRole(
      await readFile(path.join(incidentsDir, id, 'compose.yaml'), 'utf8').catch(() => ''),
    )
  }

  /** Запущенный контейнер стенда с этой ролью: сервер или рабочее место с kubectl */
  async function roleContainer(id: string, role: LabRole): Promise<string | null> {
    const ps = await run([
      'ps',
      '--filter',
      `label=com.docker.compose.project=inc-${id}`,
      '--filter',
      `label=homeops.role=${role}`,
      '--format',
      '{{.Names}}',
    ])
    return ps.stdout.trim().split('\n')[0] || null
  }

  // ── Общий кластер Kubernetes-стендов ─────────────────────────────────────
  // Один кластер kind на все k8s-стенды; стенды живут в своих namespace. Создаётся при запуске
  // первого стенда и удаляется вместе с последним, чтобы не держать ~1 ГБ памяти зря.
  // Блокировка охватывает весь up/reset/down, включая подготовку рабочего места:
  // иначе down последнего стенда может удалить кластер между cluster up и compose up другого.
  let clusterQueue: Promise<unknown> = Promise.resolve()
  function withClusterLock<T>(fn: () => Promise<T>): Promise<T> {
    const next = clusterQueue.then(fn, fn)
    clusterQueue = next.catch(() => undefined)
    return next
  }

  function clusterArgs(): string[] {
    return [
      'compose',
      '--ansi',
      'never',
      '--progress',
      'plain',
      '-f',
      path.join(hostDir!, CLUSTER_COMPOSE),
    ]
  }

  async function clusterNodes(): Promise<ClusterNode[]> {
    const ps = await run([
      'ps',
      '-a',
      '--filter',
      `label=io.x-k8s.kind.cluster=${CLUSTER_NAME}`,
      '--format',
      '{{json .}}',
    ])
    return ps.code === 0 ? parseClusterNodes(ps.stdout) : []
  }

  async function isExclusive(id: string): Promise<boolean> {
    return composeExclusive(
      await readFile(path.join(incidentsDir, id, 'compose.yaml'), 'utf8').catch(() => ''),
    )
  }

  /** Запущенные Kubernetes-стенды, кроме id */
  async function runningK8s(id: string): Promise<string[]> {
    const { ok, incidents } = await status()
    if (!ok) throw new Error('Не удалось проверить другие Kubernetes-стенды.')
    return Object.entries(incidents)
      .filter(
        ([other, st]) =>
          other !== id && st.containers.some((c) => c.role === 'k8s' && c.state === 'running'),
      )
      .map(([other]) => other)
  }

  async function otherK8sRunning(id: string): Promise<boolean> {
    const { ok, incidents } = await status()
    if (!ok)
      throw new Error('Не удалось проверить другие Kubernetes-стенды — общий кластер сохранён.')
    return Object.entries(incidents).some(
      ([other, s]) =>
        other !== id && s.containers.some((c) => c.role === 'k8s' && c.state === 'running'),
    )
  }

  function run(
    args: string[],
    onData?: (chunk: string) => void,
    cwd?: string,
    timeoutMs = commandTimeoutMs,
  ): Promise<RunResult> {
    return new Promise((resolve) => {
      const child = spawn('docker', args, {
        cwd,
        env: { ...process.env, NO_COLOR: '1', COMPOSE_MENU: 'false' },
      })
      // Зависшая команда (например, проверка, которая ждёт сеть) не должна держать запрос бесконечно
      let timedOut = false
      const timer = setTimeout(() => {
        timedOut = true
        child.kill('SIGKILL')
      }, timeoutMs)
      child.on('close', () => timer && clearTimeout(timer))
      let stdout = ''
      const handle = (b: Buffer) => {
        const s = b.toString('utf8')
        stdout = (stdout + s).slice(-1024 * 1024)
        onData?.(s)
      }
      child.stdout.on('data', handle)
      child.stderr.on('data', handle)
      child.on('error', (e) => {
        clearTimeout(timer)
        onData?.(`${e.message}\n`)
        resolve({ code: 127, stdout })
      })
      child.on('close', (code) =>
        resolve({
          code: timedOut ? 124 : (code ?? 1),
          stdout: timedOut ? stdout + '\nКоманда не завершилась вовремя.\n' : stdout,
        }),
      )
    })
  }

  function composeArgs(id: string, preset?: string): string[] {
    const dir = path.join(hostDir!, id)
    return [
      'compose',
      '--ansi',
      'never',
      '--progress',
      'plain',
      '-f',
      path.join(dir, 'compose.yaml'),
      ...(preset ? ['--env-file', path.join(dir, 'models', `${preset}.env`)] : []),
    ]
  }

  async function status() {
    await setup()
    const ids = await incidentIds()
    const ps = await run([
      'ps',
      '-a',
      '--filter',
      'label=com.docker.compose.project',
      '--format',
      '{{json .}}',
    ])
    const docker = ps.code === 0
    const containers = docker ? parseDockerPs(ps.stdout) : {}
    const incidents: Record<string, { containers: LabContainer[]; presets: LabPreset[] }> = {}
    for (const id of ids)
      incidents[id] = { containers: containers[id] ?? [], presets: await presets(id) }
    return {
      ok: docker && !setupError,
      docker,
      error:
        setupError ?? (docker ? undefined : `Docker недоступен: ${ps.stdout.trim().slice(0, 300)}`),
      hostDir,
      incidents,
      ...(await Promise.all(ids.map(needsNvidia)).then((flags) => flags.some(Boolean)) ? { gpu: await gpuStatus() } : {}),
      cluster: { name: CLUSTER_NAME, nodes: docker ? await clusterNodes() : [] },
    }
  }

  /** Память контейнеров стенда: только чтение через Docker Engine API, контейнеры — по метке compose-проекта стенда */
  async function memory(id: string): Promise<LabMemory[]> {
    const filters = encodeURIComponent(
      JSON.stringify({ label: [`com.docker.compose.project=inc-${id}`] }),
    )
    const list = await dockerApi('GET', `/containers/json?all=1&filters=${filters}`)
    if (list.status !== 200 || !Array.isArray(list.json))
      throw new Error(`Docker не ответил на список контейнеров: HTTP ${list.status}`)
    const rows = await Promise.all(
      list.json.map(async (item) => {
        const cid = (item as { Id?: unknown }).Id
        if (typeof cid !== 'string' || !/^[0-9a-f]{12,64}$/.test(cid)) return null
        const info = await dockerApi('GET', `/containers/${cid}/json`)
        if (info.status !== 200) return null
        const project = (info.json as { Config?: { Labels?: Record<string, string> } } | null)
          ?.Config?.Labels?.['com.docker.compose.project']
        if (project !== `inc-${id}`) return null
        const running =
          (info.json as { State?: { Running?: unknown } } | null)?.State?.Running === true
        const stats = running
          ? await dockerApi('GET', `/containers/${cid}/stats?stream=false&one-shot=true`)
          : null
        return containerMemory(info.json, stats?.status === 200 ? stats.json : null)
      }),
    )
    return rows
      .filter((r): r is LabMemory => r !== null)
      .sort((a, b) => a.service.localeCompare(b.service))
  }

  async function forwardReport(
    id: string,
    since: number,
    write: (s: string) => void,
  ): Promise<void> {
    if (!dashboardUrl) return
    const file = path.join(incidentsDir, id, '.reports', 'last.json')
    try {
      if ((await stat(file)).mtimeMs < since) return
      const res = await fetch(`${dashboardUrl}/api/incidents/reports`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: await readFile(file, 'utf8'),
        signal: AbortSignal.timeout(8_000),
      })
      write(
        res.ok ? 'Отчёт сохранён в дашборде.\n' : `Дашборд не принял отчёт: HTTP ${res.status}\n`,
      )
    } catch (e) {
      write(`Не удалось передать отчёт в дашборд: ${e instanceof Error ? e.message : String(e)}\n`)
    }
  }

  // ── Живая проверка: лёгкие проверки стенда для опроса из дашборда ──────────
  // Выполняется в уже запущенном рабочем месте (exec), отчёт не сохраняет и в дашборд не отправляет.
  // Одновременные запросы к одному стенду получают один и тот же результат.
  const live = new Map<string, Promise<{ status: number; body: Record<string, unknown> }>>()

  async function liveCheck(id: string): Promise<{ status: number; body: Record<string, unknown> }> {
    const role = await incidentRole(id)
    const gpuStand = !role && await needsNvidia(id)
    if (!role && !gpuStand)
      return {
        status: 400,
        body: {
          error:
            'Живая проверка есть у рабочего места kubectl, учебного сервера, compose-зала и GPU-стенда',
        },
      }
    const running = role ? await roleContainer(id, role) : (await run([
      'ps', '--filter', `label=com.docker.compose.project=inc-${id}`,
      '--filter', 'label=homeops.requires=nvidia-gpu', '--format', '{{.Names}}',
    ])).stdout.trim()
    if (!running) return { status: 409, body: { error: 'Стенд не запущен' } }
    if (gpuStand) {
      const helper = await run(['ps', '--filter', `label=com.docker.compose.project=inc-${id}`,
        '--filter', 'label=homeops.live=gpu', '--filter', 'status=running', '--format', '{{.Names}}'])
      if (!helper.stdout.trim()) return { status: 409, body: { error: 'Служебный live-контейнер не запущен — запустите стенд повторно, чтобы применить обновлённый Compose.' } }
    }
    // Фиксированный exec в уже запущенном CPU-контейнере; опрос не создаёт контейнеров.
    const command = role ? ['exec', '-T', ...liveCheckCommand(role)]
      : ['exec', '-T', '-e', 'DASHBOARD_URL=off', 'live', 'python', '/tools/verify.py', '--live']
    const out = await run(
      [...composeArgs(id), ...command],
      undefined,
      path.join(incidentsDir, id),
      30_000,
    )
    const result = parseLiveOutput(out.stdout)
    return result
      ? { status: 200, body: { ...result } }
      : {
          status: 502,
          body: { error: 'Живая проверка не вернула результат', output: out.stdout.slice(-400) },
        }
  }

  async function action(
    id: string,
    act: LabAction,
    preset: string | undefined,
    write: (s: string) => void,
  ): Promise<number> {
    const role = await incidentRole(id)
    const execute = () => performAction(id, act, preset, write, role)
    return role === 'k8s' && act !== 'verify' ? withClusterLock(execute) : execute()
  }

  async function performAction(
    id: string,
    act: LabAction,
    preset: string | undefined,
    write: (s: string) => void,
    role: LabRole | null,
  ): Promise<number> {
    const base = composeArgs(id, preset)
    const cwd = path.join(incidentsDir, id)
    const say = (s: string) => write(`\n▸ ${s}\n`)
    // up с пересборкой; если базовый образ недоступен (сеть, registry) — запуск на уже собранном образе
    const composeUp = async (flags: string[]): Promise<number> => {
      say(`docker compose up ${flags.join(' ')}`)
      const res = await run([...base, 'up', ...flags], write, cwd)
      if (res.code === 0 || !flags.includes('--build') || !isBaseImageUnavailable(res.stdout))
        return res.code
      say(
        'Базовый образ недоступен (нет сети или Docker Hub не отвечает) — запускаю уже собранный образ стенда без пересборки',
      )
      return (await run([...base, 'up', ...flags.filter((f) => f !== '--build')], write, cwd)).code
    }
    const k8s = role === 'k8s'
    // Рабочее место Kubernetes/compose-зала готово после подготовки исходного состояния (healthcheck)
    const upFlags = ['-d', '--build', '--remove-orphans', ...(k8s || role === 'compose-gym' ? ['--wait'] : [])]
    const showSetup = async () => {
      if (k8s)
        await run(
          [...base, 'logs', '--no-color', '--no-log-prefix', '--tail', '40', 'kubectl'],
          write,
          cwd,
        )
    }
    const exclusive = k8s && (await isExclusive(id))
    const cluster = (cmd: 'up' | 'down' | 'prepare') =>
      run(
        [...clusterArgs(), 'run', '--rm', '-T', 'cluster', cmd, ...(cmd === 'prepare' ? [id] : [])],
        write,
        incidentsDir,
      )
    // Стенд уровня кластера: свежий кластер → поломка в узлах → рабочее место с подготовкой namespace
    const freshCluster = async (recreate: boolean): Promise<number> => {
      say(
        `Стенд уровня кластера: пересоздаю кластер kind «${CLUSTER_NAME}» — поломка узлов не должна задеть другие стенды`,
      )
      let code = (await cluster('down')).code
      if (code === 0) code = (await cluster('up')).code
      if (code === 0) {
        say(`Готовлю поломку в узлах: homeops-cluster prepare ${id}`)
        code = (await cluster('prepare')).code
      }
      if (code !== 0) return code
      code = await composeUp([...upFlags, ...(recreate ? ['--force-recreate'] : [])])
      await showSetup()
      return code
    }
    if (act === 'up') {
      if (k8s) {
        const others = await runningK8s(id)
        if (exclusive && others.length) {
          write(
            `Этот стенд ломает узлы кластера и работает только один. Сначала остановите Kubernetes-стенды: ${others.join(', ')}.\n`,
          )
          return 1
        }
        const blocking = []
        for (const other of others) if (await isExclusive(other)) blocking.push(other)
        if (blocking.length) {
          write(
            `Сейчас работает стенд уровня кластера ${blocking.join(', ')} — он ломает узлы общего кластера. Остановите его, чтобы запустить этот стенд.\n`,
          )
          return 1
        }
        if (exclusive) return freshCluster(false)
        say(
          `Кластер Kubernetes (kind «${CLUSTER_NAME}»): docker compose -f ${CLUSTER_COMPOSE} run --rm cluster up`,
        )
        const up = await cluster('up')
        if (up.code !== 0) return up.code
      }
      const code = await composeUp(upFlags)
      await showSetup()
      return code
    }
    if (act === 'down' && exclusive) {
      // Узлы сломаны стендом — кластер удаляется целиком, namespace разбирать незачем
      say('docker compose down')
      const code = (await run([...base, 'down', '--remove-orphans'], write, cwd)).code
      if (code !== 0) return code
      // Повторный down старого стенда не должен удалить кластер нового стенда.
      // Проверяем под общей блокировкой; при ошибке Docker кластер тоже сохраняется.
      if (await otherK8sRunning(id)) {
        say('Другие Kubernetes-стенды работают — общий кластер сохранён')
        return 0
      }
      say('Стенд уровня кластера — удаляю кластер: следующий стенд получит исправные узлы')
      return (await cluster('down')).code
    }
    if (act === 'down') {
      if (k8s && (await roleContainer(id, 'k8s'))) {
        say('Убираю стенд из кластера: homeops-level teardown (удаление namespace)')
        const teardown = await run(
          [...base, 'exec', '-T', 'kubectl', 'homeops-level', 'teardown'],
          write,
          cwd,
        )
        if (teardown.code !== 0) return teardown.code
      }
      say('docker compose down')
      await run(['rm', '-f', terminalName(id)])
      const code = (await run([...base, 'down', '--remove-orphans'], write, cwd)).code
      if (code !== 0) return code
      if (k8s && !(await otherK8sRunning(id))) {
        say('Других Kubernetes-стендов нет — удаляю кластер, чтобы освободить память')
        return (
          await run([...clusterArgs(), 'run', '--rm', '-T', 'cluster', 'down'], write, incidentsDir)
        ).code
      }
      return code
    }
    const server = role === 'server'
    if (act === 'verify' && role === 'compose-gym') {
      write('Зал проверяется только живыми проверками; отчёт инцидента для него не создаётся.\n')
      return 1
    }
    if (act === 'verify') {
      const started = Date.now()
      let code: number
      if (role && !(await roleContainer(id, role))) {
        write(`${server ? 'Сервер' : 'Стенд'} не запущен — сначала запустите стенд.\n`)
        return 1
      }
      if (server) {
        say('docker compose exec server verify')
        code = (await run([...base, 'exec', '-T', 'server', 'verify'], write, cwd)).code
      } else {
        say('docker compose run --rm verify')
        code = (await run([...base, 'run', '--rm', '-T', 'verify'], write, cwd)).code
      }
      await forwardReport(id, started, write)
      return code
    }
    if (server) {
      // Состояние сервера живёт в контейнере: сброс = пересоздание со свежей поломкой
      if (!(await roleContainer(id, 'server'))) {
        write('Сервер не запущен: при следующем запуске поломка будет свежей.\n')
        return 0
      }
      return composeUp(['-d', '--build', '--force-recreate', '--remove-orphans'])
    }
    // Compose-зал может хранить metadata в своём томе: перед reset останавливаем только его проект.
    const gymWasRunning = role === 'compose-gym' && (await status()).incidents[id]?.containers.some((c) => !c.oneoff && c.state === 'running')
    if (gymWasRunning) {
      const stopped = await run([...base, 'stop'], write, cwd)
      if (stopped.code !== 0) return stopped.code
    }
    // Файлы — из .original/; у Kubernetes-стенда пересоздание рабочего места заново готовит namespace
    say('docker compose run --rm reset')
    const code = (await run([...base, 'run', '--rm', '-T', 'reset'], write, cwd)).code
    if (code !== 0) return code
    // Стенд уровня кластера: поломка живёт в узлах — сброс пересоздаёт кластер
    if (exclusive) return (await roleContainer(id, 'k8s')) ? freshCluster(true) : 0
    const running = role === 'compose-gym' ? gymWasRunning : (await status()).incidents[id]?.containers.some(
      (c) => !c.oneoff && c.state === 'running',
    )
    if (!running) return 0
    const recreated = await composeUp([...upFlags, '--force-recreate'])
    await showSetup()
    return recreated
  }

  // ── Терминал: sh в одноразовом контейнере shell внутри сети стенда ───────
  async function ensureTerminal(id: string): Promise<string | null> {
    if (await needsNvidia(id)) {
      const gpu = await gpuStatus()
      if (!gpu.available) return gpu.reason
    }
    const name = terminalName(id)
    const info = await dockerApi('GET', `/containers/${name}/json`)
    if (info.status === 200 && (info.json as { State?: { Running?: boolean } }).State?.Running)
      return null
    if (info.status === 200) await run(['rm', '-f', name])
    const res = await run(
      [...composeArgs(id), 'run', '-d', '--rm', '--name', name, 'shell', 'sleep', '86400'],
      undefined,
      path.join(incidentsDir, id),
    )
    return res.code === 0
      ? null
      : res.stdout.trim().slice(-400) || 'не удалось запустить контейнер терминала'
  }

  async function terminal(
    id: string,
    req: IncomingMessage,
    socket: Duplex,
    head: Buffer,
    node: ClusterNodeRole | null,
  ): Promise<void> {
    const ws = acceptWebSocket(req, socket, head)
    if (!ws) return
    // Сообщения клиента (ввод, размер окна) копятся, пока не готова сессия в контейнере
    const queued: Buffer[] = []
    let queuedBytes = 0
    let closed = false
    let disconnect: (() => void) | undefined
    ws.onClose(() => {
      closed = true
      queued.length = 0
      disconnect?.()
    })
    let deliver: ((data: Buffer) => void) | null = null
    ws.onMessage((data) => {
      if (closed) return
      if (deliver) return deliver(data)
      queuedBytes += data.length
      if (queuedBytes > 256 * 1024) ws.close(1009)
      else queued.push(data)
    })
    ws.send(
      `\x1b[2mПодключаюсь к ${node ? `узлу ${CLUSTER_NAME}-${node}` : `стенду ${id}`}…\x1b[0m\r\n`,
    )
    const role = await incidentRole(id)
    const server = role === 'server'
    let target: string
    // compose-стенд: что есть в образе терминала и где он открывается (метка homeops.terminal и working_dir сервиса shell)
    let composeHint: string | null = null
    let composeDir = '/scenario'
    if (node) {
      // Терминал в узле kind — только у стендов уровня кластера и только пока стенд запущен
      if (!(await isExclusive(id)) || !(await roleContainer(id, 'k8s'))) {
        ws.send(
          `\r\n\x1b[33mТерминал в узле есть только у запущенного стенда уровня кластера.\x1b[0m\r\n`,
        )
        ws.close(1000)
        return
      }
      target = `${CLUSTER_NAME}-${node}`
    } else if (role) {
      const name = await roleContainer(id, role)
      if (!name) {
        ws.send(
          `\r\n\x1b[33m${server ? 'Сервер' : 'Стенд'} не запущен — сначала запустите стенд.\x1b[0m\r\n`,
        )
        ws.close(1000)
        return
      }
      target = name
      if (role === 'compose-gym') {
        const info = (await dockerApi('GET', `/containers/${target}/json`)).json as {
          Config?: { Labels?: unknown; WorkingDir?: unknown }
        } | null
        composeHint = terminalHint(info?.Config?.Labels) ?? 'Ответы — в /answers; подходы проверяются автоматически.'
        composeDir = terminalDir(info?.Config?.WorkingDir)
      }
    } else {
      const error = await ensureTerminal(id)
      if (error) {
        ws.send(`\r\n\x1b[31mНе удалось открыть терминал: ${error}\x1b[0m\r\n`)
        ws.close(1011)
        return
      }
      target = terminalName(id)
      const info = (await dockerApi('GET', `/containers/${target}/json`)).json as {
        Config?: { Labels?: unknown; WorkingDir?: unknown }
      } | null
      composeHint = terminalHint(info?.Config?.Labels)
      composeDir = terminalDir(info?.Config?.WorkingDir)
    }
    if (closed) return
    const exec = await dockerApi('POST', `/containers/${target}/exec`, {
      AttachStdin: true,
      AttachStdout: true,
      AttachStderr: true,
      Tty: true,
      Cmd: role || node ? ['bash', '-l'] : ['sh'],
      Env: ['TERM=xterm-256color'],
      WorkingDir: server || node ? '/root' : role ? '/scenario' : composeDir,
    })
    const execId = (exec.json as { Id?: string })?.Id
    if (closed) return
    if (!execId || !/^[0-9a-f]{12,64}$/.test(execId)) {
      ws.send(
        `\r\n\x1b[31mDocker не создал сессию: ${JSON.stringify(exec.json).slice(0, 200)}\x1b[0m\r\n`,
      )
      ws.close(1011)
      return
    }
    const body = Buffer.from(JSON.stringify({ Detach: false, Tty: true }))
    const startReq = request({
      socketPath: dockerSocket,
      path: `/exec/${execId}/start`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': body.length,
        Connection: 'Upgrade',
        Upgrade: 'tcp',
      },
    })
    const connectTimer = setTimeout(
      () => startReq.destroy(new Error('Docker не открыл терминал вовремя')),
      dockerTimeoutMs,
    )
    disconnect = () => {
      clearTimeout(connectTimer)
      startReq.destroy()
    }
    startReq.on('close', () => clearTimeout(connectTimer))
    startReq.on('upgrade', (_res, tty, ttyHead) => {
      clearTimeout(connectTimer)
      if (closed) {
        tty.destroy()
        return
      }
      disconnect = () => tty.destroy()
      ws.send(
        node
          ? `\x1b[2mВы на узле ${CLUSTER_NAME}-${node} под root: systemctl, journalctl, crictl, /etc/kubernetes, /var/lib/kubelet. Узел пересоздаётся при сбросе стенда.\x1b[0m\r\n`
          : server
            ? id.startsWith('gym-')
              ? `\x1b[2mВы на учебном сервере зала под root: systemctl, journalctl, ss, lsof, du. Ответы пишите в файлы /answers/… — дашборд засчитает подходы сам.\x1b[0m\r\n`
              : `\x1b[2mВы на учебном сервере под root: systemd, journalctl, ss, lsof, vim, nano. Проверить решение — команда verify или кнопка «Проверить».\x1b[0m\r\n`
            : role === 'k8s'
              ? id.startsWith('gym-')
                ? `\x1b[2mkubectl в кластере kind «${CLUSTER_NAME}», namespace зала выбран. Алиас k, автодополнение по Tab. Делайте подходы по порядку — дашборд засчитает их сам.\x1b[0m\r\n`
                : `\x1b[2mkubectl в кластере kind «${CLUSTER_NAME}», namespace стенда выбран. Алиас k, автодополнение по Tab, редакторы vim и nano. Манифесты — в /scenario/manifests.\x1b[0m\r\n`
              : `\x1b[2mТерминал в сети стенда: сервисы доступны по именам из compose.yaml. ${composeHint ?? 'Есть curl, jq, dig, python.'} Файлы стенда — в /scenario.\x1b[0m\r\n`,
      )
      if (ttyHead.length) ws.send(ttyHead)
      tty.on('data', (chunk: Buffer) => ws.send(chunk))
      tty.on('close', () => ws.close(1000))
      tty.on('error', () => ws.close(1011))
      deliver = (data) => {
        const msg = parseTerminalMessage(data)
        if (!msg) return
        if (msg.t === 'i') {
          if (!tty.write(msg.d)) ws.close(1009)
        } else
          void dockerApi('POST', `/exec/${execId}/resize?h=${msg.r}&w=${msg.c}`).catch(
            () => undefined,
          )
      }
      queued.splice(0).forEach(deliver)
      // Обработчик закрытия установлен до асинхронной подготовки Docker.
    })
    startReq.on('response', (res) => {
      ws.send(`\r\n\x1b[31mDocker отклонил подключение: HTTP ${res.statusCode}\x1b[0m\r\n`)
      ws.close(1011)
    })
    startReq.on('error', (e) => {
      ws.send(`\r\n\x1b[31m${e.message}\x1b[0m\r\n`)
      ws.close(1011)
    })
    startReq.end(body)
  }

  // ── HTTP ─────────────────────────────────────────────────────────────────
  const sendJson = (res: ServerResponse, code: number, body: unknown) => {
    res.writeHead(code, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    })
    res.end(JSON.stringify(body))
  }

  async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
    const chunks: Buffer[] = []
    let size = 0
    for await (const c of req) {
      size += (c as Buffer).length
      if (size > 16 * 1024) throw new Error('Слишком большой запрос')
      chunks.push(c as Buffer)
    }
    const text = Buffer.concat(chunks).toString('utf8')
    const data: unknown = text ? JSON.parse(text) : {}
    return typeof data === 'object' && data !== null && !Array.isArray(data)
      ? (data as Record<string, unknown>)
      : {}
  }

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!isAllowedRequest(req.headers))
      return sendJson(res, 403, { error: 'Запрос не с этой машины или с чужого сайта' })
    if (activeRequests >= maxRequests)
      return sendJson(res, 429, { error: 'Слишком много запросов — повторите позже' })
    activeRequests++
    try {
      const url = new URL(req.url ?? '/', 'http://localhost')
      if (req.method === 'GET' && url.pathname === '/api/labs/status')
        return sendJson(res, 200, await status())
      const m =
        /^\/api\/labs\/incidents\/([a-z0-9-]+)\/(up|verify|reset|down|logs|check|memory)$/.exec(
          url.pathname,
        )
      if (!m) return sendJson(res, 404, { error: 'Not found' })
      await setup()
      if (!hostDir) return sendJson(res, 503, { error: setupError })
      const [, id, act] = m
      if (!(await incidentIds()).includes(id))
        return sendJson(res, 404, { error: `Нет стенда ${id}` })

      if (act === 'logs' && req.method === 'GET') {
        const service = url.searchParams.get('service') ?? ''
        if (service) {
          if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(service))
            return sendJson(res, 400, { error: 'Некорректное имя сервиса' })
          const config = await run(
            [...composeArgs(id), '--profile', '*', 'config', '--services'],
            undefined,
            path.join(incidentsDir, id),
          )
          if (config.code !== 0 || !config.stdout.split('\n').includes(service))
            return sendJson(res, 400, { error: 'Нет такого сервиса в стенде' })
        }
        const tail = Math.min(Math.max(Number(url.searchParams.get('tail')) || 200, 10), 2000)
        const out = await run(
          [
            ...composeArgs(id),
            'logs',
            '--no-color',
            '--tail',
            String(tail),
            ...(service ? [service] : []),
          ],
          undefined,
          path.join(incidentsDir, id),
        )
        res.writeHead(200, {
          'Content-Type': 'text/plain; charset=utf-8',
          'Cache-Control': 'no-store',
        })
        return void res.end(out.stdout)
      }
      if (act === 'memory' && req.method === 'GET')
        return sendJson(res, 200, { containers: await memory(id) })
      if (req.method !== 'POST' || act === 'logs' || act === 'memory')
        return sendJson(res, 405, { error: 'Method not allowed' })
      // Простой POST с чужого сайта тоже мог бы прийти без Origin — требуем JSON, это включает preflight
      if (
        (req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase() !==
        'application/json'
      )
        return sendJson(res, 415, { error: 'Ожидается application/json' })
      const body = await readBody(req)
      const preset = typeof body.preset === 'string' && body.preset ? body.preset : undefined
      if (preset && !(await presets(id)).some((p) => p.id === preset))
        return sendJson(res, 400, { error: `Нет пресета ${preset}` })
      if (act !== 'down' && await needsNvidia(id)) {
        const gpu = await gpuStatus()
        if (!gpu.available) return sendJson(res, 409, { error: gpu.reason })
      }
      if (act === 'check') {
        // Пока стенд запускается или сбрасывается, проверять нечего — отвечаем сразу
        if (busy.has(id)) return sendJson(res, 200, { busy: true })
        let pending = live.get(id)
        if (!pending) {
          pending = liveCheck(id).finally(() => live.delete(id))
          live.set(id, pending)
        }
        const r = await pending
        return sendJson(res, r.status, r.body)
      }
      if (busy.has(id))
        return sendJson(res, 409, {
          error: 'Со стендом уже выполняется действие — дождитесь окончания',
        })

      busy.add(id)
      res.writeHead(200, {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      })
      let code = 1
      try {
        code = await action(id, act as LabAction, preset, (s) => res.write(s))
      } finally {
        busy.delete(id)
      }
      res.end(`\n__EXIT__ ${code}\n`)
    } catch (e) {
      if (res.headersSent) res.end(`\n${e instanceof Error ? e.message : String(e)}\n__EXIT__ 1\n`)
      else sendJson(res, 500, { error: e instanceof Error ? e.message : String(e) })
    } finally {
      activeRequests--
    }
  }

  async function handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): Promise<void> {
    if (activeTerminals >= 16) {
      socket.end('HTTP/1.1 429 Too Many Requests\r\n\r\n')
      return
    }
    activeTerminals++
    let released = false
    const release = () => {
      if (!released) {
        released = true
        activeTerminals--
      }
    }
    socket.once('close', release)
    try {
      const url = new URL(req.url ?? '/', 'http://localhost')
      const m = /^\/api\/labs\/incidents\/([a-z0-9-]+)\/terminal$/.exec(url.pathname)
      if (!m || !isAllowedRequest(req.headers)) {
        socket.end('HTTP/1.1 403 Forbidden\r\n\r\n')
        return
      }
      await setup()
      if (!hostDir || !(await incidentIds()).includes(m[1])) {
        socket.end('HTTP/1.1 404 Not Found\r\n\r\n')
        return
      }
      // Узел — только из фиксированного списка: control-plane или worker
      const nodeParam = url.searchParams.get('node')
      const node = CLUSTER_NODE_ROLES.find((r) => r === nodeParam) ?? null
      if (nodeParam && !node) {
        socket.end('HTTP/1.1 400 Bad Request\r\n\r\n')
        return
      }
      const open = () => terminal(m[1], req, socket, head, node)
      if (node) await withClusterLock(open)
      else await open()
    } catch {
      socket.destroy()
    }
  }

  return { handle, handleUpgrade, status }
}
