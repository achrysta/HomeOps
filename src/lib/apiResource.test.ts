import { afterEach, describe, expect, it, vi } from 'vitest'
import { readApiJson, withDeadline } from './apiResource'
import { readBackups, readIssues } from './dataReads'

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

describe('bounded API reads', () => {
  it('accepts a successful response and clears its timeout', async () => {
    vi.useFakeTimers()
    expect(await withDeadline(async () => 'ready')).toBe('ready')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('reports a hung request and aborts it, even if it ignores cancellation', async () => {
    vi.useFakeTimers()
    let signal: AbortSignal | undefined
    let finish: ((v: string) => void) | undefined
    const request = withDeadline<string>((s) => { signal = s; return new Promise((resolve) => { finish = resolve }) })
    const rejection = expect(request).rejects.toThrow('Сервер не ответил')
    await vi.advanceTimersByTimeAsync(10_000)
    await rejection
    expect(signal?.aborted).toBe(true)
    finish?.('late response')
    await Promise.resolve()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('cancels reads when their consumer is gone', async () => {
    vi.useFakeTimers()
    const parent = new AbortController()
    const request = withDeadline(() => new Promise(() => {}), 10_000, parent.signal)
    const rejection = expect(request).rejects.toThrow('отменён')
    parent.abort()
    await rejection
    expect(vi.getTimerCount()).toBe(0)
  })

  it('does not start an already cancelled read', async () => {
    const parent = new AbortController()
    parent.abort()
    const read = vi.fn(async () => 'unused')
    await expect(withDeadline(read, 10_000, parent.signal)).rejects.toThrow('отменён')
    expect(read).not.toHaveBeenCalled()
  })

  it('preserves the error from a failed read', async () => {
    await expect(withDeadline(async () => { throw new Error('HTTP 503') })).rejects.toThrow('HTTP 503')
  })

  it('rejects HTTP failures and an HTML response instead of treating them as empty data', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('offline', { status: 503 })))
    await expect(readApiJson('/api/backups', new AbortController().signal)).rejects.toThrow('HTTP 503')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html/>', { headers: { 'Content-Type': 'text/html' } })))
    await expect(readApiJson('/api/backups', new AbortController().signal)).rejects.toThrow('неожиданный ответ')
  })

  it('distinguishes an empty list from a malformed backup/issue response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => Response.json({ dir: 'backups', backups: [] })))
    expect(await readBackups(new AbortController().signal)).toEqual({ dir: 'backups', backups: [] })
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => Response.json({ backups: [{ name: 'broken' }] })))
    await expect(readBackups(new AbortController().signal)).rejects.toThrow('список снимков')
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => Response.json({})))
    await expect(readIssues(new AbortController().signal)).rejects.toThrow('список замечаний')
  })
})
