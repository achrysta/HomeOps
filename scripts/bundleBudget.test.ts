import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { inspectStartupBundle, inspectWrittenEntries, MAIN_BUDGET_BYTES } from './bundleBudget'

const chunk = (fileName: string, isEntry: boolean, code = '', imports: string[] = [], modules: Record<string, unknown> = {}) => ({ type: 'chunk' as const, fileName, isEntry, code, imports, modules })
describe('startup bundle budget', () => {
  it('rejects an entry grown by a later plugin in the final written asset', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'homeops-budget-'))
    try {
      expect(inspectStartupBundle({ main: chunk('main.js', true, 'small') }).errors).toEqual([])
      await writeFile(path.join(dir, 'main.js'), 'x'.repeat(MAIN_BUDGET_BYTES + 1))
      expect((await inspectWrittenEntries(dir, ['main.js'])).join()).toContain('после записи')
      await writeFile(path.join(dir, 'main.js'), 'x'.repeat(MAIN_BUDGET_BYTES))
      expect(await inspectWrittenEntries(dir, ['main.js'])).toEqual([])
    } finally { await rm(dir, { recursive: true, force: true }) }
  })
  it('accepts lazy plans but rejects them even in a small transitive startup chunk', () => {
    const main = chunk('main.js', true, '', ['shared.js'])
    const plans = chunk('plans.js', false, '', [], { '/app/src/data/labSteps.ts': {} })
    const shared = chunk('shared.js', false)
    expect(inspectStartupBundle({ main, shared, plans }).errors).toEqual([])
    shared.imports.push('plans.js')
    expect(inspectStartupBundle({ main, shared, plans }).errors.join()).toContain('стартовой загрузке')
    plans.modules = { '/app/src/data/packs/agents/pack.ts': {} }
    expect(inspectStartupBundle({ main, shared, plans }).errors.join()).toContain('стартовой загрузке')
    plans.modules = { '/app/src/data/incidents.ts': {} }
    expect(inspectStartupBundle({ main, shared, plans }).errors.join()).toContain('стартовой загрузке')
  })
  it('counts UTF-8 bytes, refuses an oversized main and handles static cycles', () => {
    const main = chunk('main.js', true, 'а'.repeat(MAIN_BUDGET_BYTES / 2 + 1), ['peer.js'])
    const peer = chunk('peer.js', false, '', ['main.js'])
    expect(inspectStartupBundle({ main, peer }).errors.join()).toContain('900')
    main.code = 'x'.repeat(MAIN_BUDGET_BYTES)
    expect(inspectStartupBundle({ main, peer }).errors).toEqual([])
    expect(inspectStartupBundle({}).errors).not.toEqual([])
  })
})
