// Запускается только в docker compose --profile tools run --rm --build incident-regression.
import { spawn } from 'node:child_process'
import { hostname } from 'node:os'
import path from 'node:path'
import { selectCases } from './incidentCases.ts'
import { runRegression, type DockerCommand } from './incidentRegression.ts'

const controller = new AbortController()
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => {
  console.error(`\n${signal}: останавливаю прогон и очищаю его ресурсы…`)
  controller.abort()
})

const docker: DockerCommand = (args, cleanup = false) => new Promise((resolve) => {
  const child = spawn('docker', args, { env: { ...process.env, DASHBOARD_URL: 'off', NO_COLOR: '1', COMPOSE_MENU: 'false' }, signal: cleanup ? undefined : controller.signal })
  let stdout = ''
  let timedOut = false
  const timer = setTimeout(() => { timedOut = true; child.kill('SIGTERM') }, 300_000)
  const data = (chunk: Buffer) => { const text = chunk.toString('utf8'); stdout += text; if (!args.includes('--format')) process.stdout.write(text) }
  child.stdout.on('data', data)
  child.stderr.on('data', data)
  // AbortError приходит до close: дождёмся завершения CLI, чтобы cleanup не гонялся с созданием контейнера.
  child.on('error', (error) => {
    stdout += error.message
    if (child.pid === undefined) { clearTimeout(timer); resolve({ code: 127, stdout }) }
  })
  child.on('close', (code) => { clearTimeout(timer); resolve({ code: timedOut ? 124 : code ?? 130, stdout }) })
})

try {
  const selected = selectCases(process.argv.slice(2))
  if (selected.plan) {
    console.log(JSON.stringify(selected.cases.map((c) => ({ id: c.id, stages: c.stages.map(({ id, title, expected }) => ({ id, title, expected })) })), null, 2))
  } else {
    const outputDir = process.env.REGRESSION_OUTPUT ?? '/runs'
    const inspected = await docker(['inspect', hostname(), '--format', '{{json .Mounts}}'])
    if (inspected.code !== 0) throw new Error('Запускайте автопрогон в сервисе incident-regression, а не на хосте.')
    const mounts = JSON.parse(inspected.stdout) as { Destination: string; Source: string; RW: boolean }[]
    const output = mounts.find((m) => m.Destination === outputDir && m.RW)
    if (!output) throw new Error(`Нет bind mount для ${outputDir}`)
    console.log('Автопрогон: отдельный кластер homeops-regression, копии стендов, DASHBOARD_URL=off.')
    const { summary, reportDir } = await runRegression({ sourceDir: process.env.SOURCE_INCIDENTS ?? '/source/incidents', outputDir, hostOutputDir: output.Source, cases: selected.cases, examCompatibility: selected.examCompatibility, docker, log: console.log })
    console.log(`\n${summary.ok ? 'Прогон прошёл' : 'Прогон не прошёл'}. Отчёт: ${path.join(output.Source, path.relative(outputDir, reportDir), 'summary.json')}`)
    process.exitCode = summary.ok ? 0 : 1
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
