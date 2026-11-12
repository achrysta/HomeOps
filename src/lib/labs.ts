// Клиент сервиса стендов инцидентов (/api/labs/*) и входящих отчётов автопроверки.

import { LABS_STATUS_TIMEOUT_MS } from '../config/weights'
import type { IncidentDef, IncidentReport } from '../types'
import { parseIncidentReport } from './incidents'

export type LabAction = 'up' | 'verify' | 'reset' | 'down'

export interface LabContainer {
  service: string
  name: string
  state: string
  status: string
  health?: string
  oneoff: boolean
  /** server — учебный Linux-сервер, k8s — рабочее место Kubernetes-стенда */
  role?: string
}

/** Узел общего кластера kind, в котором живут Kubernetes-стенды */
export interface ClusterNode {
  name: string
  role: string
  state: string
  status: string
}

/** Как устроен стенд: обычный compose, учебный Linux-сервер или namespace в общем Kubernetes-кластере */
export type StandKind = 'compose' | 'server' | 'cluster'
export const standKind = (def: Pick<IncidentDef, 'server' | 'cluster'>): StandKind => (def.server ? 'server' : def.cluster ? 'cluster' : 'compose')

export interface LabPreset {
  id: string
  label: string
}

export interface LabsStatus {
  ok: boolean
  docker: boolean
  /** Готовность фиксированной NVIDIA-диагностики, только для CUDA-стендов. */
  gpu?: { available: boolean; reason: string }
  error?: string
  hostDir: string | null
  incidents: Record<string, { containers: LabContainer[]; presets: LabPreset[] }>
  /** Общий кластер Kubernetes-стендов (kind) */
  cluster?: { name: string; nodes: ClusterNode[] }
  /** Статус не пришёл за LABS_STATUS_TIMEOUT_MS — сервис завис или занят */
  timedOut?: boolean
}

/** Сколько медленных ответов подряд терпим, прежде чем показать ошибку вместо последнего хорошего статуса */
export const LABS_TIMEOUTS_TOLERATED = 2

/**
 * Какой статус показать после очередного опроса. Одиночный медленный ответ (например, пока Docker создаёт кластер)
 * не должен прятать карточку стенда с журналом идущего действия: оставляем последний хороший статус,
 * а ошибку показываем, если сервис не ответил несколько раз подряд или ещё ни разу не отвечал.
 */
export function nextLabsStatus(prev: LabsStatus | null | undefined, next: LabsStatus | null, timeouts: number): { status: LabsStatus | null; timeouts: number } {
  if (!next?.timedOut) return { status: next, timeouts: 0 }
  const count = timeouts + 1
  return { status: prev?.ok && count <= LABS_TIMEOUTS_TOLERATED ? prev : next, timeouts: count }
}

/** Кластер запущен целиком, частично или не создан. */
export function clusterState(nodes: readonly ClusterNode[]): 'none' | 'running' | 'partial' {
  if (!nodes.length) return 'none'
  return nodes.every((n) => n.state === 'running') ? 'running' : 'partial'
}

export type StandState = 'stopped' | 'running' | 'starting' | 'degraded'

export const STAND_STATE_LABEL: Record<StandState, string> = {
  stopped: 'Стенд остановлен',
  running: 'Стенд работает',
  starting: 'Стенд запускается',
  degraded: 'Часть сервисов не работает',
}

/** Состояние стенда по контейнерам его сервисов (одноразовые verify/shell/ingest не учитываются). */
export function standState(containers: readonly LabContainer[]): StandState {
  const services = containers.filter((c) => !c.oneoff && !c.name.endsWith('-terminal'))
  const longRunning = services.filter((c) => c.state === 'running' || !/Exited \(0\)/.test(c.status))
  // Контейнер, который падает и перезапускается по кругу, — не остановленный стенд, а сломанный сервис
  if (!longRunning.some((c) => c.state === 'running' || c.state === 'restarting')) return 'stopped'
  if (longRunning.some((c) => c.state === 'restarting')) return 'degraded'
  if (longRunning.some((c) => c.health === 'health: starting' || c.state === 'created')) return 'starting'
  if (longRunning.some((c) => c.state !== 'running' || c.health === 'unhealthy')) return 'degraded'
  return 'running'
}

/** Подпись пресета «Qwen2.5-3B — по умолчанию: ≈ 2 ГБ, …» → короткое имя для списка и описание под ним. */
export function presetParts(label: string): { name: string; details: string } {
  const i = label.indexOf(' — ')
  if (i < 0) return { name: label, details: '' }
  const details = label.slice(i + 3).trim()
  return { name: label.slice(0, i).trim(), details: details.charAt(0).toUpperCase() + details.slice(1) }
}

/** Сервисы стенда для просмотра логов. */
export const standServices = (containers: readonly LabContainer[]): string[] =>
  [...new Set(containers.filter((c) => !c.oneoff && !c.name.endsWith('-terminal')).map((c) => c.service))].sort()

/** Статус сервиса стендов; null — сервис недоступен. Зависший сервис отвечает статусом с ошибкой по таймауту. */
export async function fetchLabsStatus(timeoutMs = LABS_STATUS_TIMEOUT_MS): Promise<LabsStatus | null> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch('/api/labs/status', { signal: ctrl.signal })
    if (!res.ok || !(res.headers.get('content-type') ?? '').includes('application/json')) return null
    return (await res.json()) as LabsStatus
  } catch {
    if (!ctrl.signal.aborted) return null
    return {
      ok: false,
      docker: false,
      error: `Сервис стендов не ответил за ${Math.round(timeoutMs / 1000)} с. Проверьте контейнер labs: docker compose ps и docker compose logs labs в папке проекта.`,
      hostDir: null,
      incidents: {},
      timedOut: true,
    }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Выполнить действие со стендом. Вывод команды приходит потоком (onChunk), результат — код выхода.
 * Ошибка запроса или обрыв вывода приходит строкой в onChunk и кодом -1.
 */
export async function runLabAction(id: string, action: LabAction, preset: string | undefined, onChunk: (text: string) => void): Promise<number> {
  let res: Response
  try {
    res = await fetch(`/api/labs/incidents/${id}/${action}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(preset ? { preset } : {}),
    })
  } catch {
    onChunk('Сервис стендов недоступен.\n')
    return -1
  }
  if (!res.ok || !res.body) {
    const body = (await res.json().catch(() => ({}))) as { error?: string }
    onChunk(`${body.error ?? `HTTP ${res.status}`}\n`)
    return -1
  }
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let tail = ''
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      const text = decoder.decode(value, { stream: true })
      tail = (tail + text).slice(-200)
      onChunk(text.replace(/\n?__EXIT__ -?\d+\n?$/, ''))
    }
  } catch {
    onChunk('\nСоединение с сервисом стендов прервано. Результат действия неизвестен. Обновите состояние стенда перед повтором.\n')
    return -1
  } finally {
    reader.releaseLock()
  }
  const m = /__EXIT__ (-?\d+)/.exec(tail)
  if (!m) {
    onChunk('\nВывод завершился без результата действия. Обновите состояние стенда перед повтором.\n')
    return -1
  }
  return Number(m[1])
}

export interface LiveCheck {
  id: string
  title: string
  ok: boolean
  message: string
}

/** Живая проверка: результат лёгких проверок, «занят» (стенд запускается или сбрасывается) или ошибка. */
export type LiveCheckResult = { kind: 'ok'; at: string; checks: LiveCheck[] } | { kind: 'busy' } | { kind: 'error'; error: string }

/** Лёгкие проверки стенда без отчёта и без зачёта — для опроса каждые несколько секунд. */
export async function fetchLiveCheck(id: string): Promise<LiveCheckResult> {
  try {
    const res = await fetch(`/api/labs/incidents/${id}/check`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
    const body = (await res.json().catch(() => ({}))) as { busy?: boolean; at?: string; checks?: LiveCheck[]; error?: string }
    if (body.busy) return { kind: 'busy' }
    if (!res.ok || !Array.isArray(body.checks)) return { kind: 'error', error: body.error ?? `HTTP ${res.status}` }
    return { kind: 'ok', at: body.at ?? '', checks: body.checks }
  } catch {
    return { kind: 'error', error: 'Сервис стендов недоступен' }
  }
}

/** Память контейнера стенда (GET /api/labs/incidents/<id>/memory) */
export interface LabMemory {
  service: string
  name: string
  state: string
  /** Занято байт, как в docker stats; null — контейнер не запущен */
  used: number | null
  /** Лимит памяти контейнера; null — лимита нет */
  limit: number | null
  /** Сколько памяти доступно на деле: лимит или вся память Docker */
  available: number | null
  oomKilled: boolean
  restarts: number
}

export async function fetchLabMemory(id: string, timeoutMs = 15_000): Promise<{ containers: LabMemory[] } | { error: string }> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(`/api/labs/incidents/${id}/memory`, { signal: ctrl.signal })
    const body = (await res.json().catch(() => ({}))) as { containers?: LabMemory[]; error?: string }
    return res.ok && Array.isArray(body.containers) ? { containers: body.containers } : { error: body.error ?? `HTTP ${res.status}` }
  } catch {
    return { error: ctrl.signal.aborted ? 'Docker не ответил вовремя' : 'Сервис стендов недоступен' }
  } finally {
    clearTimeout(timer)
  }
}

/** Байты → «182 МБ», «1,5 ГБ» */
export function formatMemory(bytes: number): string {
  const mb = bytes / 1024 ** 2
  if (mb < 1024) return `${mb < 10 ? mb.toFixed(1).replace('.', ',') : Math.round(mb)} МБ`
  return `${(mb / 1024).toFixed(1).replace('.', ',')} ГБ`
}

/** Доля занятой памяти: от лимита, а без лимита — от всей памяти Docker */
export function memoryShare(m: Pick<LabMemory, 'used' | 'limit' | 'available'>): number | null {
  const of = m.limit ?? m.available
  return m.used === null || !of ? null : Math.min(m.used / of, 1)
}

export async function fetchLabLogs(id: string, service: string, tail = 200): Promise<string> {
  try {
    const res = await fetch(`/api/labs/incidents/${id}/logs?tail=${tail}${service ? `&service=${encodeURIComponent(service)}` : ''}`)
    return res.ok ? await res.text() : `Не удалось получить логи: HTTP ${res.status}`
  } catch {
    return 'Сервис стендов недоступен.'
  }
}

/** Узел kind, в который открывается терминал стенда уровня кластера */
export type TerminalNode = 'control-plane' | 'worker'

export function terminalUrl(id: string, node?: TerminalNode): string {
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/labs/incidents/${id}/terminal${node ? `?node=${node}` : ''}`
}

/** Те же действия командами — когда сервис стендов не запущен или стенд крутится на другой машине. */
export function cliCommands(id: string, preset?: string, kind: StandKind = 'compose', nodeAccess = false): { label: string; cmd: string }[] {
  const env = preset ? ` --env-file models/${preset}.env` : ''
  if (kind === 'cluster' && nodeAccess) {
    const cluster = 'docker compose -f ../_shared/k8s/compose.yaml run --rm cluster'
    return [
      { label: 'Перейти в папку стенда', cmd: `cd incidents/${id}` },
      { label: 'Остановить рабочее место (также перед запуском или сбросом)', cmd: 'docker compose down' },
      { label: 'Удалить общий кластер — остальные Kubernetes-стенды и залы должны быть остановлены', cmd: `${cluster} down` },
      { label: 'Создать свежий кластер', cmd: `${cluster} up` },
      { label: 'Подготовить поломку в узлах', cmd: `${cluster} prepare ${id}` },
      { label: 'Подготовить рабочее место и namespace', cmd: 'docker compose up -d --wait' },
      { label: 'Терминал с kubectl', cmd: 'docker compose exec kubectl bash -l' },
      { label: 'Терминал в control-plane', cmd: 'docker exec -it homeops-control-plane bash -l' },
      { label: 'Терминал в worker', cmd: 'docker exec -it homeops-worker bash -l' },
      { label: 'Автопроверка', cmd: 'docker compose run --rm verify' },
    ]
  }
  if (kind === 'cluster') {
    return [
      { label: 'Перейти в папку стенда', cmd: `cd incidents/${id}` },
      { label: 'Создать кластер (один на все Kubernetes-стенды)', cmd: 'docker compose -f ../_shared/k8s/compose.yaml run --rm cluster up' },
      { label: 'Подготовить стенд в кластере', cmd: 'docker compose up -d --wait' },
      { label: 'Терминал с kubectl', cmd: 'docker compose exec kubectl bash -l' },
      { label: 'Автопроверка', cmd: 'docker compose run --rm verify' },
      { label: 'Вернуть манифесты в исходное состояние', cmd: 'docker compose run --rm reset' },
      { label: 'Пересоздать стенд со свежей поломкой', cmd: 'docker compose up -d --wait --force-recreate' },
      { label: 'Убрать стенд из кластера', cmd: 'docker compose exec kubectl homeops-level teardown' },
      { label: 'Остановить рабочее место', cmd: 'docker compose down' },
      { label: 'Удалить кластер и освободить память', cmd: 'docker compose -f ../_shared/k8s/compose.yaml run --rm cluster down' },
    ]
  }
  if (kind === 'server') {
    return [
      { label: 'Перейти в папку стенда', cmd: `cd incidents/${id}` },
      { label: 'Запустить сервер', cmd: 'docker compose up -d --build' },
      { label: 'Войти на сервер', cmd: 'docker compose exec server bash -l' },
      { label: 'Автопроверка (или verify на сервере)', cmd: 'docker compose exec server verify' },
      { label: 'Начать заново со свежей поломкой', cmd: 'docker compose up -d --force-recreate' },
      { label: 'Остановить', cmd: 'docker compose down' },
    ]
  }
  return [
    { label: 'Перейти в папку стенда', cmd: `cd incidents/${id}` },
    { label: 'Запустить стенд', cmd: `docker compose${env} up -d --build` },
    { label: 'Терминал в сети стенда', cmd: 'docker compose run --rm shell' },
    { label: 'Логи сервиса', cmd: 'docker compose logs -f <сервис>' },
    { label: 'Автопроверка', cmd: 'docker compose run --rm verify' },
    { label: 'Вернуть файлы стенда в исходное состояние', cmd: 'docker compose run --rm reset' },
    { label: 'Остановить', cmd: 'docker compose down' },
  ]
}

/** Новые отчёты автопроверки из inbox сервера, сгруппированные по инцидентам. */
export async function fetchIncidentReports(defs: readonly IncidentDef[]): Promise<Record<string, IncidentReport[]> | null> {
  try {
    const res = await fetch('/api/incidents/reports')
    if (!res.ok) return null
    const { reports } = (await res.json()) as { reports?: unknown[] }
    const out: Record<string, IncidentReport[]> = {}
    for (const raw of reports ?? []) {
      // Сервер хранит отчёт уже без поля format — восстанавливаем для общей проверки
      const parsed = parseIncidentReport({ format: 'homeops-incident-report', ...(raw as object) }, defs, 'auto')
      if ('report' in parsed) (out[parsed.incidentId] ??= []).push(parsed.report)
    }
    return out
  } catch {
    return null
  }
}

/** Попросить приложение забрать новые отчёты сейчас (после автопроверки из дашборда). */
export const REPORTS_REFRESH_EVENT = 'homeops:incident-reports'
export function requestReportsRefresh(): void {
  window.dispatchEvent(new Event(REPORTS_REFRESH_EVENT))
}
