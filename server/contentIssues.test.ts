import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { appendIssue, ISSUES_FILE, MAX_ISSUES, readIssues, sanitizeIssue, type ContentIssue } from './contentIssues.ts'
import { createProgressApi } from './progressApi.ts'

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'homeops-issues-'))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

const valid = { kind: 'question', targetId: 'iv-gw-1', targetTitle: 'Как реализовать routing?', type: 'wrong', text: 'В разборе перепутаны 429 и 503' }

describe('content issues', () => {
  it('accepts a known kind and type and stores it as open', () => {
    const issue = sanitizeIssue({ ...valid, status: 'fixed', id: 'mine' })
    expect(issue).toMatchObject({ kind: 'question', targetId: 'iv-gw-1', type: 'wrong', status: 'open' })
    expect(typeof issue !== 'string' && issue.id).not.toBe('mine')
  })

  it('rejects unknown kinds, broken ids and an empty "other"', () => {
    expect(typeof sanitizeIssue({ ...valid, kind: 'progress' })).toBe('string')
    expect(typeof sanitizeIssue({ ...valid, type: 'spam' })).toBe('string')
    expect(typeof sanitizeIssue({ ...valid, targetId: '../../etc/passwd' })).toBe('string')
    expect(typeof sanitizeIssue({ ...valid, type: 'other', text: '   ' })).toBe('string')
    // битая ссылка понятна и без текста
    expect(typeof sanitizeIssue({ ...valid, type: 'link', text: '' })).toBe('object')
  })

  it('keeps at most MAX_ISSUES, dropping resolved ones first', async () => {
    const make = (i: number, status: ContentIssue['status']): ContentIssue => ({ id: `i${i}`, at: new Date(0).toISOString(), kind: 'task', targetId: 'A0', targetTitle: '', type: 'unclear', text: '', status })
    const issues = Array.from({ length: MAX_ISSUES }, (_, i) => make(i, i === 5 ? 'fixed' : 'open'))
    await writeFile(path.join(dir, ISSUES_FILE), JSON.stringify({ issues }))
    await appendIssue(dir, make(9999, 'open'))
    const after = await readIssues(dir)
    expect(after).toHaveLength(MAX_ISSUES)
    expect(after.some((x) => x.id === 'i5')).toBe(false)
    expect(after.at(-1)?.id).toBe('i9999')
  })

  it('serves issues over HTTP and accepts only JSON posts', async () => {
    const api = createProgressApi({ dataDir: dir })
    const server: Server = createServer(async (req, res) => {
      if (!(await api(req, res))) res.writeHead(418).end()
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    try {
      // простой POST без JSON (так шлёт форма с чужого сайта) — отклоняется
      expect((await fetch(`${base}/api/issues`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(valid) })).status).toBe(415)
      const ok = await fetch(`${base}/api/issues`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(valid) })
      expect(ok.status).toBe(201)
      const bad = await fetch(`${base}/api/issues`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...valid, kind: 'x' }) })
      expect(bad.status).toBe(400)
      const list = (await (await fetch(`${base}/api/issues`)).json()) as { issues: ContentIssue[] }
      expect(list.issues).toHaveLength(1)
      expect(JSON.parse(await readFile(path.join(dir, ISSUES_FILE), 'utf8')).format).toBe('homeops-content-issues')
    } finally {
      await new Promise((resolve) => server.close(resolve))
    }
  })
})
