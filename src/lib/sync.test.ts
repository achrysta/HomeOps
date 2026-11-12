import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createProgressApi, writeStored } from '../../server/progressApi.ts'
import { curriculum } from '../data'
import { reducer } from '../state/reducer'
import type { UserProgress } from '../types'
import { createEmptyProgress } from './storage'

// Реальный API во временной папке + подмена fetch/localStorage: проверяем именно поведение
// синхронизации, из-за которого можно потерять данные.

let dir: string
let server: Server
const store = new Map<string, string>()
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'homeops-sync-'))
  const api = createProgressApi({ dataDir: dir })
  server = createServer((req, res) => void api(req, res))
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const realFetch = globalThis.fetch
  vi.stubGlobal('fetch', (input: string, init?: RequestInit) => realFetch(base + input, init))
  store.clear()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  })
  vi.resetModules()
})

afterEach(async () => {
  vi.unstubAllGlobals()
  await new Promise((resolve) => server.close(resolve))
  await rm(dir, { recursive: true, force: true })
})

const withTask = (p: UserProgress, id: string) =>
  reducer(p, { type: 'task/status', id, status: 'completed' })
const readFileProgress = async () =>
  JSON.parse(await readFile(path.join(dir, 'progress.json'), 'utf8')) as {
    revision: number
    progress: UserProgress
  }

async function start(local: UserProgress) {
  const sync = await import('./sync')
  const applied: UserProgress[] = []
  sync.queueSave(local)
  await sync.initSync(curriculum, (p) => applied.push(p))
  await sleep(50)
  return { sync, applied }
}

describe('file sync', () => {
  it.each([
    'practice',
    'incidents',
    'finalExam',
    'measurements',
    'ckaExams',
  ] as const)('saves a conflict snapshot when only %s has local progress', async (section) => {
    const base = createEmptyProgress(curriculum)
    await writeStored(dir, base as unknown as Record<string, unknown>, 0)
    await writeStored(dir, withTask(base, 'A1') as unknown as Record<string, unknown>, 1)
    store.set('homeops.sync.v1', JSON.stringify({ baseRevision: 1, dirty: true }))
    const local = { ...base }
    if (section === 'practice')
      local.practice = {
        q: { seen: 1, correct: 1, streak: 1, lastCorrect: true, lastAt: base.meta.createdAt },
      }
    if (section === 'incidents')
      local.incidents = {
        'sse-streaming': { startedAt: base.meta.createdAt, hintsShown: 1, reports: [] },
      }
    if (section === 'finalExam')
      local.finalExam = [
        { id: 'exam', at: base.meta.createdAt, correct: 1, total: 24, passed: false, wrongIds: [] },
      ]
    if (section === 'measurements')
      local.measurements = [
        {
          id: 'm',
          taskId: 'C3',
          date: '2026-10-09',
          metric: 'ttft',
          value: 125,
          unit: 'мс',
          model: 'test',
          hardware: 'test',
          conditions: 'test',
        },
      ]
    if (section === 'ckaExams')
      local.ckaExams = [
        {
          id: 'test-exam',
          variantId: 'cka-1',
          phase: 'preparing',
          createdAt: base.meta.createdAt,
          reports: {},
        },
      ]

    const { sync, applied } = await start(local)
    const backups = await readdir(path.join(dir, 'backups'))
    const snapshot = backups.find((b) => b.includes('conflict-browser'))!
    const saved = JSON.parse(await readFile(path.join(dir, 'backups', snapshot), 'utf8'))
    expect(saved.progress[section]).toEqual(local[section])
    expect(sync.getSyncStatus().notice).toContain(snapshot)
    expect(applied.at(-1)?.tasks.A1.status).toBe('completed')
    expect((await readFileProgress()).revision).toBe(2)
  })

  it('never lets an empty browser cache overwrite the file', async () => {
    const real = withTask(createEmptyProgress(curriculum), 'A1')
    await writeStored(dir, real as unknown as Record<string, unknown>, 0)

    const { applied } = await start(createEmptyProgress(curriculum)) // localStorage очищен, meta нет
    expect(applied).toHaveLength(1)
    expect(applied[0].tasks.A1.status).toBe('completed')
    const file = await readFileProgress()
    expect(file.revision).toBe(1)
    expect(file.progress.tasks.A1.status).toBe('completed')
    expect(await readdir(dir)).not.toContain('backups') // пустой кэш не сохраняется снимком
  })

  it('does not push a stale state queued again while the initial load is in flight', async () => {
    const real = withTask(createEmptyProgress(curriculum), 'A1')
    await writeStored(dir, real as unknown as Record<string, unknown>, 0)

    const sync = await import('./sync')
    const applied: UserProgress[] = []
    const empty = createEmptyProgress(curriculum)
    sync.queueSave(empty)
    const init = sync.initSync(curriculum, (p) => applied.push(p))
    sync.queueSave(empty) // повторный mount в StrictMode
    await init
    await sleep(600)
    const file = await readFileProgress()
    expect(file.revision).toBe(1)
    expect(file.progress.tasks.A1.status).toBe('completed')
    expect(applied.at(-1)?.tasks.A1.status).toBe('completed')
  })

  it('creates the file on first run from browser progress', async () => {
    await start(withTask(createEmptyProgress(curriculum), 'B1'))
    const file = await readFileProgress()
    expect(file.revision).toBe(1)
    expect(file.progress.tasks.B1.status).toBe('completed')
  })

  it('writes offline edits made on top of the current revision', async () => {
    const base = createEmptyProgress(curriculum)
    await writeStored(dir, base as unknown as Record<string, unknown>, 0)
    store.set('homeops.sync.v1', JSON.stringify({ baseRevision: 1, dirty: true }))

    const { applied } = await start(withTask(base, 'C2'))
    expect(applied).toHaveLength(0)
    const file = await readFileProgress()
    expect(file.revision).toBe(2)
    expect(file.progress.tasks.C2.status).toBe('completed')
    expect(JSON.parse(store.get('homeops.sync.v1')!)).toEqual({ baseRevision: 2, dirty: false })
  })

  it('keeps the file on conflict and saves the browser version as a snapshot', async () => {
    const base = createEmptyProgress(curriculum)
    await writeStored(dir, base as unknown as Record<string, unknown>, 0)
    await writeStored(dir, withTask(base, 'E1') as unknown as Record<string, unknown>, 1) // изменено в другом месте
    store.set('homeops.sync.v1', JSON.stringify({ baseRevision: 1, dirty: true }))

    const { sync, applied } = await start(withTask(base, 'D0'))
    expect(applied[0].tasks.E1.status).toBe('completed')
    const file = await readFileProgress()
    expect(file.revision).toBe(2)
    expect(file.progress.tasks.D0).toBeUndefined()
    const backups = await readdir(path.join(dir, 'backups'))
    const snapshot = backups.find((b) => b.includes('conflict-browser'))!
    const saved = JSON.parse(await readFile(path.join(dir, 'backups', snapshot), 'utf8'))
    expect(saved.progress.tasks.D0.status).toBe('completed')
    expect(sync.getSyncStatus().notice).toContain(snapshot)
  })

  it('saves changes after startup and resolves a stale-tab conflict', async () => {
    const { sync, applied } = await start(createEmptyProgress(curriculum))
    const p1 = withTask(createEmptyProgress(curriculum), 'A0.1')
    sync.queueSave(p1)
    await sleep(600)
    expect((await readFileProgress()).progress.tasks['A0.1'].status).toBe('completed')

    // другая вкладка записала новую ревизию
    const rev = (await readFileProgress()).revision
    await writeStored(dir, withTask(p1, 'A0.2') as unknown as Record<string, unknown>, rev)
    sync.queueSave(withTask(p1, 'A0.6'))
    await sleep(600)
    const file = await readFileProgress()
    expect(file.progress.tasks['A0.2'].status).toBe('completed')
    expect(file.progress.tasks['A0.6']).toBeUndefined()
    expect(applied.at(-1)?.tasks['A0.2'].status).toBe('completed')
  })

  it('on conflict keeps the edits made while the save request was in flight', async () => {
    const { sync, applied } = await start(createEmptyProgress(curriculum))
    const p1 = withTask(createEmptyProgress(curriculum), 'A0.1')
    sync.queueSave(p1)
    await sleep(600)
    // другая вкладка записала новую ревизию; PUT этой вкладки отвечает медленно
    const rev = (await readFileProgress()).revision
    await writeStored(dir, withTask(p1, 'A0.2') as unknown as Record<string, unknown>, rev)
    const fastFetch = globalThis.fetch
    vi.stubGlobal('fetch', async (input: string, init?: RequestInit) => {
      if (init?.method === 'PUT') await sleep(150)
      return fastFetch(input, init)
    })

    sync.queueSave(withTask(p1, 'A0.6'))
    await sleep(450) // запрос ушёл и ещё не вернулся
    sync.queueSave(withTask(withTask(p1, 'A0.6'), 'A0.7')) // пользователь продолжает работать
    await sleep(700)

    const backups = await readdir(path.join(dir, 'backups'))
    const snapshots = await Promise.all(
      backups
        .filter((b) => b.includes('conflict-browser'))
        .map(async (b) => JSON.parse(await readFile(path.join(dir, 'backups', b), 'utf8'))),
    )
    expect(snapshots.some((s) => s.progress.tasks['A0.7']?.status === 'completed')).toBe(true)
    expect(applied.at(-1)?.tasks['A0.2'].status).toBe('completed')
    expect((await readFileProgress()).progress.tasks['A0.7']).toBeUndefined()
  })

  it('does not replace local state on conflict when the snapshot cannot be saved', async () => {
    const { sync, applied } = await start(createEmptyProgress(curriculum))
    const p1 = withTask(createEmptyProgress(curriculum), 'A0.1')
    sync.queueSave(p1)
    await sleep(600)
    const rev = (await readFileProgress()).revision
    await writeStored(dir, withTask(p1, 'A0.2') as unknown as Record<string, unknown>, rev)
    const realFetch = globalThis.fetch
    vi.stubGlobal('fetch', (input: string, init?: RequestInit) =>
      input.startsWith('/api/backups') && init?.method === 'POST'
        ? Promise.resolve(
            new Response('{"error":"disk full"}', {
              status: 500,
              headers: { 'Content-Type': 'application/json' },
            }),
          )
        : realFetch(input, init),
    )
    const appliedBefore = applied.length

    sync.queueSave(withTask(p1, 'A0.6'))
    await sleep(600)
    expect(applied).toHaveLength(appliedBefore) // локальная версия осталась в интерфейсе
    expect(sync.getSyncStatus().mode).toBe('error')
    sync.queueSave(withTask(withTask(p1, 'A0.6'), 'A0.7'))
    await sleep(600)
    const file = await readFileProgress()
    expect(file.progress.tasks['A0.2'].status).toBe('completed') // чужие правки в файле не затёрты
    expect(file.progress.tasks['A0.6']).toBeUndefined()
  })

  it('does not snapshot a conflict when another tab already saved the same change', async () => {
    const { sync, applied } = await start(createEmptyProgress(curriculum))
    const p1 = withTask(createEmptyProgress(curriculum), 'A0.1')
    sync.queueSave(p1)
    await sleep(600)
    // другая вкладка приняла то же изменение (например, тот же отчёт автопроверки) и записала раньше
    const rev = (await readFileProgress()).revision
    const same = withTask(p1, 'A0.2')
    await writeStored(
      dir,
      {
        ...same,
        meta: { ...same.meta, updatedAt: '2026-10-07T00:00:00.000Z' },
      } as unknown as Record<string, unknown>,
      rev,
    )
    const appliedBefore = applied.length

    sync.queueSave({ ...same, meta: { ...same.meta, updatedAt: '2026-10-07T00:00:05.000Z' } })
    await sleep(600)
    const backups = await readdir(path.join(dir, 'backups')).catch(() => [] as string[])
    expect(backups.filter((b) => b.includes('conflict'))).toEqual([])
    expect(sync.getSyncStatus().notice).toBeUndefined()
    expect(sync.getSyncStatus().revision).toBe(rev + 1)
    expect(applied).toHaveLength(appliedBefore)
    // и дальнейшие правки уходят на актуальную ревизию без конфликтов
    sync.queueSave(withTask(same, 'A0.6'))
    await sleep(600)
    expect((await readFileProgress()).progress.tasks['A0.6'].status).toBe('completed')
  })
  it('cancels a debounced change when the user returns to the saved state', async () => {
    const base = createEmptyProgress(curriculum)
    const { sync } = await start(base)
    sync.queueSave(withTask(base, 'A1'))
    sync.queueSave(base)
    await sleep(650)
    expect((await readFileProgress()).progress.tasks.A1?.status).not.toBe('completed')
    expect(JSON.parse(store.get('homeops.sync.v1')!).dirty).toBe(false)
  })

  it('saves the restoration after an earlier change has already entered PUT', async () => {
    const base = createEmptyProgress(curriculum)
    const { sync } = await start(base)
    const fastFetch = globalThis.fetch
    let started!: () => void, release!: () => void
    const inFlight = new Promise<void>((r) => {
      started = r
    })
    const gate = new Promise<void>((r) => {
      release = r
    })
    let first = true
    vi.stubGlobal('fetch', async (input: string, init?: RequestInit) => {
      if (init?.method === 'PUT' && first) {
        first = false
        started()
        await gate
      }
      return fastFetch(input, init)
    })
    sync.queueSave(withTask(base, 'A1'))
    await inFlight
    sync.queueSave(base)
    release()
    await sleep(750)
    expect((await readFileProgress()).progress.tasks.A1?.status).not.toBe('completed')
    expect(JSON.parse(store.get('homeops.sync.v1')!).dirty).toBe(false)
  })
})
