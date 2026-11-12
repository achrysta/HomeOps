import { cp, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { validateStage, type RegressionCase } from './incidentCases.ts'
import type { DockerCommand } from './incidentRegression.ts'

export const COMPATIBILITY_IDS = ['k8s-gateway', 'k8s-operator'] as const
export const FINAL_COMPATIBILITY_IDS = ['k8s-storm', 'k8s-operator', 'k8s-storage'] as const
export interface CompatibilityResult {
  ok: boolean
  checks: { id: string; ok: boolean; errors: string[]; report: string }[]
  errors: string[]
  cleanupErrors: string[]
}

/** Только копии в уже принадлежащем runner кластере, без сервиса labs и пользовательского API. */
export async function runExamCompatibility(work: string, reportDir: string, cases: readonly RegressionCase[], command: DockerCommand): Promise<CompatibilityResult> {
  const ids = cases.map((c) => c.id)
  if (![COMPATIBILITY_IDS, FINAL_COMPATIBILITY_IDS].some((group) => group.length === ids.length && group.every((id) => ids.includes(id)))) throw new Error('Совместимость поддерживает только фиксированные составы экзаменов')
  const result: CompatibilityResult = { ok: false, checks: [], errors: [], cleanupErrors: [] }
  const base = (id: string) => ['compose', '--ansi', 'never', '--progress', 'plain', '-p', `homeops-regression-${id}`, '-f', path.join(work, id, 'compose.yaml'), '-f', path.join(work, id, 'regression.override.json')]
  const required = async (args: string[], cleanup = false) => {
    const out = await command(args, cleanup)
    if (out.code !== 0) throw new Error(`Код ${out.code}: docker ${args.join(' ')}\n${out.stdout.slice(-1000)}`)
  }
  const prepare = async (id: string) => {
    const test = cases.find((c) => c.id === id)
    if (!test || test.nodeAccess) throw new Error('Совместимость проверяется только для фиксированных namespace-стендов')
    const dir = path.join(work, id)
    await cp(path.join(dir, '.original'), dir, { recursive: true })
    await required([...base(id), 'up', '-d', '--no-build', '--force-recreate', '--wait', '--wait-timeout', '180'])
    for (const stage of test.stages.slice(1)) {
      for (const edit of stage.edits ?? []) {
        const file = path.resolve(dir, edit.path)
        if (!file.startsWith(dir + path.sep)) throw new Error('Правка вне тестовой копии')
        const text = await readFile(file, 'utf8')
        if (!text.includes(edit.from)) throw new Error(`Контрольное исправление не совпало: ${id}/${edit.path}`)
        await writeFile(file, edit.all ? text.replaceAll(edit.from, edit.to) : text.replace(edit.from, edit.to))
      }
      for (const action of stage.commands ?? []) await required([...base(id), 'exec', '-T', action.service, ...action.args])
      if (stage.id === 'fixed') return
    }
    throw new Error(`Нет полного исправления ${id}`)
  }
  const verify = async (id: string, label: string) => {
    const test = cases.find((c) => c.id === id)!
    const stage = test.stages.find((s) => s.id === 'fixed')!
    const file = path.join(work, id, '.reports/last.json')
    await rm(file, { force: true })
    const out = await command([...base(id), 'run', '--rm', '-T', '-e', 'DASHBOARD_URL=off', 'verify'])
    const raw: unknown = JSON.parse(await readFile(file, 'utf8'))
    const errors = validateStage(raw, test, stage, out.code)
    const report = `compat-${label}-${id}.json`
    await writeFile(path.join(reportDir, report), JSON.stringify(raw, null, 2) + '\n')
    result.checks.push({ id: `${label}/${id}`, ok: errors.length === 0, errors, report })
    if (errors.length) throw new Error(`${label}/${id}: ${errors.join('; ')}`)
  }
  const teardown = (id: string) => required([...base(id), 'exec', '-T', 'kubectl', 'homeops-level', 'teardown'])
  try {
    for (const id of ids) await prepare(id)
    for (const id of ids) await verify(id, 'ready')
    for (const removed of ids) {
      await teardown(removed)
      for (const other of ids.filter((id) => id !== removed)) await verify(other, 'after-' + removed.replace(/^k8s-/, '') + '-teardown')
      if (removed !== ids.at(-1)) await prepare(removed)
    }
  } catch (error) { result.errors.push(error instanceof Error ? error.message : String(error)) }
  finally {
    for (const id of ids) {
      for (const args of [
        [...base(id), 'run', '--rm', '-T', '-e', 'DASHBOARD_URL=off', 'reset'],
        [...base(id), 'exec', '-T', 'kubectl', 'homeops-level', 'teardown'],
        [...base(id), '--profile', '*', 'down', '--remove-orphans'],
      ]) {
        try { await required(args, true) }
        catch (error) { result.cleanupErrors.push(error instanceof Error ? error.message : String(error)) }
      }
    }
  }
  result.ok = result.checks.length === ids.length ** 2 && result.checks.every((c) => c.ok) && !result.errors.length && !result.cleanupErrors.length
  return result
}
