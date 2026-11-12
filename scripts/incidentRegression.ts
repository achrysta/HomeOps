import { randomUUID } from 'node:crypto'
import { appendFile, cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { validateStage, type RegressionCase } from './incidentCases.ts'
import { isolateCompose, type RegressionCompose } from './regressionCompose.ts'
import { runExamCompatibility, type CompatibilityResult } from './examCompatibility.ts'
import { probeNvidia, type NvidiaCapability } from './gpuCapability.ts'

export const TEST_CLUSTER = 'homeops-regression'
export const TEST_VOLUME = 'homeops-regression-kubeconfig'
export const TEST_LOCK = 'homeops-regression-lock'
const OWNER_LABEL = 'homeops.regression.run'
const TOOLS_IMAGE = 'homeops-regression-tools:1'

export interface CommandResult { code: number; stdout: string }
export type DockerCommand = (args: string[], cleanup?: boolean) => Promise<CommandResult>
export interface StageResult { id: string; ok: boolean; errors: string[] }
export interface CaseResult { id: string; stages: StageResult[]; errors: string[]; skipped?: string; skipKind?: 'hardware' }
export interface RegressionSummary {
  format: 'homeops-incident-regression'
  runId: string
  startedAt: string
  finishedAt: string
  cluster: string
  ok: boolean
  cases: CaseResult[]
  errors: string[]
  cleanupErrors: string[]
  compatibility?: CompatibilityResult
}

interface Options {
  sourceDir: string
  outputDir: string
  /** Bind source каталога отчётов на стороне демона Docker, не путь внутри runner. */
  hostOutputDir: string
  cases: RegressionCase[]
  examCompatibility?: boolean
  docker: DockerCommand
  log?: (line: string) => void
}

/** Docker Compose принимает JSON как YAML; bind paths формируем явно для демона на хосте. */
export function standOverride(hostWork: string, id: string, runId: string) {
  const service = {
    image: TOOLS_IMAGE,
    environment: { DASHBOARD_URL: 'off', KIND_CLUSTER_NAME: TEST_CLUSTER },
    labels: { [OWNER_LABEL]: runId },
    volumes: [
      { type: 'bind', source: path.join(hostWork, '_tools'), target: '/tools', read_only: true },
      { type: 'bind', source: path.join(hostWork, id), target: '/scenario' },
      { type: 'volume', source: 'kubeconfig', target: '/kube', read_only: true },
    ],
  }
  return { services: { kubectl: service, verify: service, reset: service }, volumes: { kubeconfig: { name: TEST_VOLUME, external: true } } }
}

/** Имена узлов в манифестах/проверках заменяются только в копии, включая .original. */
async function isolateNodeNames(dir: string): Promise<void> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name)
    if (entry.isDirectory()) await isolateNodeNames(file)
    else if (entry.isFile() && /\.(?:yaml|yml|py|sh|json|txt)$/.test(entry.name)) {
      const text = await readFile(file, 'utf8')
      const isolated = text.replaceAll('homeops-control-plane', `${TEST_CLUSTER}-control-plane`).replaceAll('homeops-worker', `${TEST_CLUSTER}-worker`)
      if (text !== isolated) await writeFile(file, isolated)
    }
  }
}

/** Имя one-off известно до запуска: отменённый CLI может оставить контейнер и его flock живыми. */
export function oneOffCommand(args: string[], runId: string, serial: number): { args: string[]; name?: string; project?: string } {
  if (args[0] !== 'compose') return { args }
  const valued = new Set(['--ansi', '--progress', '-p', '--project-name', '-f', '--file', '--profile', '--env-file'])
  let project: string | undefined
  for (let i = 1; i < args.length; i++) {
    const arg = args[i]
    if (valued.has(arg)) {
      if (arg === '-p' || arg === '--project-name') project = args[i + 1]
      i++
      continue
    }
    if (arg.startsWith('-')) continue
    if (arg !== 'run' || !project?.startsWith(`${TEST_CLUSTER}-`)) return { args }
    const name = `${TEST_CLUSTER}-run-${runId}-${serial}`
    return { args: [...args.slice(0, i + 1), '--name', name, ...args.slice(i + 1)], name, project }
  }
  return { args }
}

export async function runRegression(options: Options): Promise<{ summary: RegressionSummary; reportDir: string }> {
  const { sourceDir, outputDir, hostOutputDir, cases, docker } = options
  const startedAt = new Date().toISOString()
  const runId = `${startedAt.replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`
  const reportDir = path.join(outputDir, runId)
  const work = path.join(reportDir, 'work')
  const hostWork = path.join(hostOutputDir, runId, 'work')
  const summary: RegressionSummary = { format: 'homeops-incident-regression', runId, startedAt, finishedAt: '', cluster: TEST_CLUSTER, ok: false, cases: [], errors: [], cleanupErrors: [] }
  await mkdir(reportDir, { recursive: true })
  let leaseAttempted = false
  let ownedLease = false
  let ownedVolume = false
  let clusterAttempted = false
  let clusterRunning = false
  let existingKindNetwork = true
  let gpuCapability: NvidiaCapability | undefined
  const clusterArgs = ['compose', '--ansi', 'never', '--progress', 'plain', '-p', `${TEST_CLUSTER}-cluster`, '-f', path.join(work, '_shared/k8s/compose.yaml'), '-f', path.join(work, 'cluster.override.json')]

  let commandSerial = 0
  const stopOneOff = async (name: string, project: string) => cleanup(`Остановка отменённого one-off ${name}`, async () => {
    const inspected = await command(['inspect', name, '--format', '{{json .Config.Labels}}'], true)
    if (inspected.code !== 0) {
      if (/no such (object|container)/i.test(inspected.stdout)) return
      throw new Error(`Не удалось проверить владельца one-off ${name}: ${inspected.stdout.slice(-500)}`)
    }
    const labels = JSON.parse(inspected.stdout) as Record<string, string>
    if (labels[OWNER_LABEL] !== runId || labels['com.docker.compose.project'] !== project || labels['com.docker.compose.oneoff']?.toLowerCase() !== 'true')
      throw new Error(`Метки владельца one-off ${name} не совпадают — контейнер сохранён`)
    await required(['rm', '-f', name], true)
  })
  const command = async (args: string[], cleanup = false): Promise<CommandResult> => {
    const prepared = oneOffCommand(args, runId, ++commandSerial)
    options.log?.(`▸ docker ${prepared.args.join(' ')}`)
    let result: CommandResult
    try { result = await docker(prepared.args, cleanup) }
    catch (error) {
      if (prepared.name && prepared.project) await stopOneOff(prepared.name, prepared.project)
      throw error
    }
    await appendFile(path.join(reportDir, 'commands.log'), `\n▸ docker ${prepared.args.join(' ')}\n${result.stdout}\n[exit ${result.code}]\n`)
    if (prepared.name && prepared.project && [124, 127, 130, 137, 143].includes(result.code))
      await stopOneOff(prepared.name, prepared.project)
    return result
  }
  const required = async (args: string[], cleanup = false) => {
    const result = await command(args, cleanup)
    if (result.code !== 0) throw new Error(`docker ${args.join(' ')}: код ${result.code}\n${result.stdout.slice(-1200)}`)
    return result.stdout
  }
  const cleanup = async (label: string, fn: () => Promise<unknown>) => {
    try { await fn() } catch (error) { summary.cleanupErrors.push(`${label}: ${error instanceof Error ? error.message : String(error)}`) }
  }
  const errorMessage = (error: unknown) => error instanceof Error ? error.message : String(error)

  try {
    // Глобальная аренда в Docker защищает и от второго checkout, и от двух одновременных запусков.
    leaseAttempted = true
    await required(['create', '--name', TEST_LOCK, '--label', `${OWNER_LABEL}=${runId}`, '--network', 'none', '--entrypoint', '/bin/true', 'homeops-labs:latest'])
    ownedLease = true
    const existing = (await required(['ps', '-a', '--filter', `name=${TEST_CLUSTER}`, '--format', '{{.Names}}'])).trim().split('\n').filter((name) => name && name !== TEST_LOCK)
    if (existing.length) throw new Error(`Тестовые ресурсы уже существуют: ${existing.join(', ')}. Они сохранены; сначала проверьте предыдущий прогон.`)
    const volumes = (await required(['volume', 'ls', '--filter', `name=${TEST_VOLUME}`, '--format', '{{.Name}}'])).split('\n')
    if (volumes.includes(TEST_VOLUME)) throw new Error(`Том ${TEST_VOLUME} уже существует и сохранён; автоматическое переиспользование запрещено.`)
    existingKindNetwork = (await required(['network', 'ls', '--filter', 'name=kind', '--format', '{{.Name}}'])).split('\n').includes('kind')

    await mkdir(path.join(work, '_shared'), { recursive: true })
    const filter = (file: string) => !file.split(path.sep).some((part) => part === '.reports' || part === '__pycache__')
    await cp(path.join(sourceDir, '_tools'), path.join(work, '_tools'), { recursive: true, filter })
    await cp(path.join(sourceDir, '_shared'), path.join(work, '_shared'), { recursive: true, filter })
    for (const test of cases) {
      const dir = path.join(work, test.id)
      await cp(path.join(sourceDir, test.id), dir, { recursive: true, filter })
      // Тестируем каноническую поломку, а не текущие пользовательские правки.
      if (await stat(path.join(dir, '.original')).then(() => true, () => false)) await cp(path.join(dir, '.original'), dir, { recursive: true })
      if (!test.kind || test.kind === 'k8s') await isolateNodeNames(dir)
      await mkdir(path.join(dir, '.reports'), { recursive: true })
      if (!test.kind || test.kind === 'k8s') await writeFile(path.join(dir, 'regression.override.json'), JSON.stringify(standOverride(hostWork, test.id, runId)))
      else {
        const config = await required(['compose', '--ansi', 'never', '--profile', '*', ...(test.envFile ? ['--env-file', path.join(dir, test.envFile)] : []), '-p', `${TEST_CLUSTER}-${test.id}`, '-f', path.join(dir, 'compose.yaml'), 'config', '--format', 'json'])
        const raw = JSON.parse(config.slice(config.indexOf('{'), config.lastIndexOf('}') + 1)) as RegressionCompose
        await writeFile(path.join(dir, 'regression.compose.json'), JSON.stringify(isolateCompose(raw, work, hostWork, `${TEST_CLUSTER}-${test.id}`, runId, test.offline)))
      }
    }
    await writeFile(path.join(work, 'cluster.override.json'), JSON.stringify({
      // Служебный kind использует только сокет Docker и docker exec. Ему не нужна сеть:
      // compose run/down в некоторых версиях оставляет пустую default-сеть после one-off.
      services: { cluster: { image: TOOLS_IMAGE, labels: { [OWNER_LABEL]: runId }, network_mode: 'none', environment: { KIND_CLUSTER_NAME: TEST_CLUSTER, DASHBOARD_URL: 'off' }, volumes: [{ type: 'bind', source: path.join(hostWork, '_shared/k8s'), target: '/k8s', read_only: true }, { type: 'bind', source: hostWork, target: '/incidents', read_only: true }] } },
      volumes: { kubeconfig: { name: TEST_VOLUME, external: true } },
    }))
    if (cases.some((test) => !test.kind || test.kind === 'k8s')) {
      await required([...clusterArgs, 'build', 'cluster'])
      await required(['volume', 'create', '--label', `${OWNER_LABEL}=${runId}`, TEST_VOLUME])
      ownedVolume = true
      if (!cases.find((test) => !test.kind || test.kind === 'k8s')?.nodeAccess) {
        clusterAttempted = true
        await required([...clusterArgs, 'run', '--rm', '-T', 'cluster', 'up'])
        clusterRunning = true
      }
    }

    for (const test of options.examCompatibility ? [] : cases) {
      const result: CaseResult = { id: test.id, stages: [], errors: [] }
      summary.cases.push(result)
      const dir = path.join(work, test.id)
      const k8s = !test.kind || test.kind === 'k8s'
      const base = ['compose', '--ansi', 'never', '--progress', 'plain', '-p', `${TEST_CLUSTER}-${test.id}`, '-f', path.join(dir, k8s ? 'compose.yaml' : 'regression.compose.json'), ...(k8s ? ['-f', path.join(dir, 'regression.override.json')] : [])]
      const exec = (...args: string[]) => required([...base, 'exec', '-T', 'kubectl', ...args])
      let standAttempted = false
      try {
        if (test.requires === 'nvidia-gpu') {
          gpuCapability ??= await probeNvidia((args) => command(args))
          if (!gpuCapability.available) {
            result.skipped = gpuCapability.reason
            result.skipKind = 'hardware'
            continue
          }
        }
        for (const image of test.requiredImages ?? []) {
          const inspected = await command(['image', 'inspect', image])
          if (inspected.code !== 0) { result.skipped = `Нет локального образа ${image}; сборка/скачивание не выполнялись`; break }
        }
        if (result.skipped) continue
        if (test.nodeAccess) {
          clusterAttempted = true
          await required([...clusterArgs, 'run', '--rm', '-T', 'cluster', 'down'])
          await required([...clusterArgs, 'run', '--rm', '-T', 'cluster', 'up'])
          await required([...clusterArgs, 'run', '--rm', '-T', 'cluster', 'prepare', test.id])
        }
        if (k8s && !test.nodeAccess && !clusterRunning) {
          clusterAttempted = true
          await required([...clusterArgs, 'run', '--rm', '-T', 'cluster', 'up'])
          clusterRunning = true
        }
        standAttempted = true
        if (test.start?.length !== 0) await required([...base, 'up', '-d', '--no-build', ...(k8s || test.waitForStart ? ['--wait', '--wait-timeout', '180'] : []), ...(test.start ?? [])])
        if (test.kind === 'server') await required([...base, 'exec', '-T', 'server', 'sh', '-ec', 'for i in $(seq 1 60); do test -f /var/lib/homeops/setup.done && exit 0; sleep 1; done; exit 1'])
        for (const stage of test.stages) {
          options.log?.(`\n${test.id} / ${stage.id}: ${stage.title}`)
          if (stage.workspaceReset) {
            if (!k8s) throw new Error('Пересоздание рабочего места поддержано только для Kubernetes')
            await required([...base, 'run', '--rm', '-T', '-e', 'DASHBOARD_URL=off', 'reset'])
            await required([...base, 'up', '-d', '--no-build', '--force-recreate', '--wait', '--wait-timeout', '180'])
          }
          if (stage.resetStand) {
            if (!test.nodeAccess || !k8s) throw new Error('Независимый сброс поддержан только для nodeAccess')
            await required([...base, 'down', '--remove-orphans'])
            await required([...clusterArgs, 'run', '--rm', '-T', 'cluster', 'down'])
            await required([...clusterArgs, 'run', '--rm', '-T', 'cluster', 'up'])
            await required([...clusterArgs, 'run', '--rm', '-T', 'cluster', 'prepare', test.id])
            await required([...base, 'up', '-d', '--no-build', '--wait', '--wait-timeout', '180'])
          }
          if (stage.patch && test.namespace && test.deployment) {
            await exec('kubectl', '-n', test.namespace, 'patch', 'deployment', test.deployment, '--type=strategic', '-p', JSON.stringify(stage.patch))
            await exec('kubectl', '-n', test.namespace, 'rollout', 'status', `deployment/${test.deployment}`, '--timeout=120s')
          }
          for (const file of stage.files ?? []) {
            const target = path.resolve(dir, file.path)
            if (!target.startsWith(dir + path.sep)) throw new Error('Файл исправления вне тестовой копии')
            await mkdir(path.dirname(target), { recursive: true })
            await writeFile(target, file.text)
          }
          for (const edit of stage.edits ?? []) {
            const target = path.resolve(dir, edit.path)
            if (!target.startsWith(dir + path.sep)) throw new Error('Файл исправления вне тестовой копии')
            const text = await readFile(target, 'utf8')
            if (!text.includes(edit.from)) throw new Error(`Контрольное исправление не совпало с исходником: ${test.id}/${edit.path}`)
            await writeFile(target, edit.all ? text.replaceAll(edit.from, edit.to) : text.replace(edit.from, edit.to))
          }
          if (stage.services) {
            const configFile = path.join(dir, 'regression.compose.json')
            const config = JSON.parse(await readFile(configFile, 'utf8')) as RegressionCompose
            for (const [service, patch] of Object.entries(stage.services)) config.services[service] = { ...config.services[service], ...patch, environment: { ...config.services[service].environment, ...(patch.environment as Record<string, string> ?? {}), DASHBOARD_URL: 'off' } }
            await writeFile(configFile, JSON.stringify(config))
          }
          if (stage.start) await required([...base, 'up', '-d', '--no-build', ...stage.start])
          for (const action of stage.commands ?? []) {
            if (action.node) await required(['exec', '-e', 'DASHBOARD_URL=off', `${TEST_CLUSTER}-${action.node}`, ...action.args])
            else if (action.args.length === 1 && action.args[0] === 'restart') await required([...base, 'restart', action.service])
            else await required([...base, ...(action.run ? ['run', '--rm', '-T', '-e', 'DASHBOARD_URL=off'] : ['exec', '-T']), action.service, ...action.args])
          }
          const last = path.join(dir, '.reports/last.json')
          await rm(last, { force: true }) // исключаем принятие старого отчёта при сбое verify
          const verified = await command([...base, ...(test.kind === 'server' ? ['exec', '-T', '-e', 'DASHBOARD_URL=off', 'server', 'verify'] : ['run', '--rm', '-T', '-e', 'DASHBOARD_URL=off', 'verify'])])
          const raw: unknown = JSON.parse(await readFile(last, 'utf8'))
          await writeFile(path.join(reportDir, `${test.id}-${stage.id}.json`), JSON.stringify(raw, null, 2) + '\n')
          const errors = validateStage(raw, test, stage, verified.code)
          result.stages.push({ id: stage.id, ok: !errors.length, errors })
          options.log?.(`${errors.length ? 'ОШИБКА' : 'OK'}: ${test.id} / ${stage.id}`)
          if (errors.length) break
        }
      } catch (error) {
        result.errors.push(errorMessage(error))
      } finally {
        if (standAttempted) {
          // Сохраняем диагностику до сброса; reset меняет только нашу копию файлов.
          await cleanup(`${test.id}: логи`, () => required([...base, 'logs', '--no-color', '--tail', '100'], true))
          if (test.kind !== 'server') await cleanup(`${test.id}: reset`, () => required([...base, 'run', '--rm', '-T', '-e', 'DASHBOARD_URL=off', 'reset'], true))
          const containers = await command([...base, 'ps', '--status', 'running', '--services'], true)
          if (containers.code !== 0) summary.cleanupErrors.push(`${test.id}: не удалось получить состояние рабочего места`)
          if (k8s && containers.stdout.split('\n').includes('kubectl')) await cleanup(`${test.id}: teardown`, () => required([...base, 'exec', '-T', 'kubectl', 'homeops-level', 'teardown'], true))
          if (k8s && test.teardownObjects && containers.stdout.split('\n').includes('kubectl')) await cleanup(`${test.id}: объекты после teardown`, () => required([...base, 'exec', '-T', 'kubectl', 'python3', '-c', `import json,subprocess,time
objects=json.loads(${JSON.stringify(JSON.stringify(test.teardownObjects))})
for attempt in range(30):
    remaining=[]
    for kind,names in objects.items():
        if kind=='gatewayclass':
            continue # удаление CRD gatewayclasses удаляет и все GatewayClass
        raw=subprocess.check_output(['kubectl','get',kind,'-o','json'],text=True)
        remaining += [kind+'/'+x['metadata']['name'] for x in json.loads(raw)['items'] if x['metadata']['name'] in names]
    if not remaining:
        break
    time.sleep(2)
else:
    raise SystemExit('После teardown остались: '+', '.join(remaining))
print('Объекты стенда удалены')`], true))
          // One-off verify/reset могут создать сеть профиля tools, невидимую обычному down.
          await cleanup(`${test.id}: down`, () => required([...base, '--profile', '*', 'down', '--remove-orphans', ...(!k8s ? ['--volumes'] : [])], true))
          await cleanup(`${test.id}: оставшиеся контейнеры`, async () => {
            const ids = (await required(['ps', '-aq', '--filter', `label=com.docker.compose.project=${TEST_CLUSTER}-${test.id}`, '--filter', `label=${OWNER_LABEL}=${runId}`], true)).trim().split('\n').filter(Boolean)
            if (ids.length) await required(['rm', '-f', ...ids], true)
          })
        }
        if (test.nodeAccess && !result.skipped) await cleanup(`${test.id}: отдельный кластер`, async () => {
          await required([...clusterArgs, 'run', '--rm', '-T', 'cluster', 'down'], true)
          clusterRunning = false
        })
      }
    }
    if (options.examCompatibility) {
      summary.compatibility = await runExamCompatibility(work, reportDir, cases, command)
      summary.cleanupErrors.push(...summary.compatibility.cleanupErrors)
      if (!summary.compatibility.ok) summary.errors.push(...summary.compatibility.errors, 'Проверка совместимости не завершена успешно')
    }
  } catch (error) {
    summary.errors.push(errorMessage(error))
  } finally {
    if (clusterAttempted) {
      await cleanup('Удаление тестового кластера', () => required([...clusterArgs, 'run', '--rm', '-T', 'cluster', 'down'], true))
      await cleanup('Остановка служебного compose', () => required([...clusterArgs, 'down', '--remove-orphans'], true))
      await cleanup('Оставшиеся служебные контейнеры', async () => {
        const ids = (await required(['ps', '-aq', '--filter', `label=com.docker.compose.project=${TEST_CLUSTER}-cluster`, '--filter', `label=${OWNER_LABEL}=${runId}`], true)).trim().split('\n').filter(Boolean)
        if (ids.length) await required(['rm', '-f', ...ids], true)
      })
      await cleanup('Узлы тестового кластера', async () => {
        const remaining = (await required(['ps', '-a', '--filter', `label=io.x-k8s.kind.cluster=${TEST_CLUSTER}`, '--format', '{{.Names}}'], true)).trim()
        if (remaining) throw new Error(`Остались узлы: ${remaining}`)
      })
      if (!existingKindNetwork) await cleanup('Сеть kind', async () => {
        const inspected = await command(['network', 'inspect', 'kind', '--format', '{{json .Containers}}'], true)
        // Если во время прогона пользователь запустил другой кластер, сеть оставляем ему.
        if (inspected.code === 0 && Object.keys(JSON.parse(inspected.stdout) as object).length === 0) await required(['network', 'rm', 'kind'], true)
      })
    }
    if (ownedVolume) await cleanup('Тестовый kubeconfig', async () => {
      const labels = JSON.parse(await required(['volume', 'inspect', TEST_VOLUME, '--format', '{{json .Labels}}'], true)) as Record<string, string>
      if (labels[OWNER_LABEL] !== runId) throw new Error('Метка владельца изменилась — том сохранён')
      await required(['volume', 'rm', TEST_VOLUME], true)
    })
    if (leaseAttempted) await cleanup('Аренда Docker', async () => {
      const inspected = await command(['inspect', TEST_LOCK, '--format', '{{json .Config.Labels}}'], true)
      if (inspected.code !== 0) { if (ownedLease) throw new Error('Не удалось проверить владельца аренды'); return }
      const labels = JSON.parse(inspected.stdout) as Record<string, string>
      if (labels[OWNER_LABEL] === runId) await required(['rm', '-f', TEST_LOCK], true)
    })
    // При ошибке очистки сохраняем копию compose и kubeconfig-путей для ручной диагностики.
    if (!summary.cleanupErrors.length) await rm(work, { recursive: true, force: true })
    summary.finishedAt = new Date().toISOString()
    summary.ok = summary.errors.length === 0 && summary.cleanupErrors.length === 0 && (options.examCompatibility ? summary.compatibility?.ok === true : summary.cases.length === cases.length && summary.cases.every((c, i) => !c.errors.length && (c.skipKind === 'hardware' && cases[i].requires === 'nvidia-gpu' || !c.skipped && c.stages.length === cases[i].stages.length && c.stages.every((s) => s.ok))))
    await writeFile(path.join(reportDir, 'summary.json'), JSON.stringify(summary, null, 2) + '\n')
  }
  return { summary, reportDir }
}
