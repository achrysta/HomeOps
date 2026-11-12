import { COMPOSE_CASES } from './composeCases.ts'
import { LINUX_CASES } from './linuxCases.ts'
import { NAMESPACE_CASES } from './namespaceCases.ts'
import { NODE_CASES } from './nodeCases.ts'
import { BATCH6_CASES } from './batch6Cases.ts'
import { BATCH7_CASES } from './batch7Cases.ts'
import { GPU_CASES } from './gpuCases.ts'
import { BATCH10_CASES } from './batch10Cases.ts'

/** Контрольные исправления доступны только автопрогону, не UI и не сервису стендов. */
export interface RegressionStage {
  id: string
  title: string
  expected: Record<string, boolean>
  messageIncludes?: Record<string, string>
  patch?: Record<string, unknown>
  commands?: { service: string; args: string[]; run?: boolean; node?: 'control-plane' | 'worker' }[]
  edits?: { path: string; from: string; to: string; all?: boolean }[]
  files?: { path: string; text: string }[]
  services?: Record<string, Record<string, unknown>>
  start?: string[]
  /** Свежий кластер перед независимым отрицательным сценарием nodeAccess. */
  resetStand?: boolean
  /** Сброс файлов и пересоздание только kubectl: проверяет повторную поломку на тех же узлах. */
  workspaceReset?: boolean
}

export interface RegressionCase {
  id: string
  requires?: 'nvidia-gpu'
  kind?: 'k8s' | 'server' | 'compose'
  namespace?: string
  deployment?: string
  start?: string[]
  waitForStart?: boolean
  envFile?: string
  nodeAccess?: boolean
  requiredImages?: string[]
  offline?: boolean
  /** Все проверки зависят от ещё сломанной первой: полезный частичный шаг остаётся красным. */
  allowRedPartial?: boolean
  /** После teardown эти объекты уровня кластера должны исчезнуть. */
  teardownObjects?: Record<string, string[]>
  stages: RegressionStage[]
}

const deploymentPatch = (container: Record<string, unknown>) => ({ spec: { template: { spec: { containers: [container] } } } })

export const REGRESSION_CASES: RegressionCase[] = [
  {
    id: 'k8s-crashloop', namespace: 'notify', deployment: 'notify',
    stages: [
      { id: 'broken', title: 'Исходная поломка', expected: { running: false, stable: false, config: false, limits: true } },
      {
        id: 'partial', title: 'Сервис работает, но лимит памяти снят',
        expected: { running: true, stable: true, config: true, limits: false },
        patch: deploymentPatch({ name: 'notify', command: ['python', '-u', '/app/app.py'], env: [{ name: 'NOTIFY_QUEUE_URL', value: 'amqp://rabbitmq.messaging:5672/notifications' }], resources: { limits: { memory: null } } }),
      },
      {
        id: 'fixed', title: 'Исправление с разумным лимитом памяти',
        expected: { running: true, stable: true, config: true, limits: true },
        patch: deploymentPatch({ name: 'notify', resources: { limits: { memory: '128Mi' } } }),
      },
    ],
  },
  {
    id: 'k8s-probes', namespace: 'inference', deployment: 'model-server',
    stages: [
      { id: 'broken', title: 'Исходная поломка', expected: { stable: false, rollout: false } },
      {
        id: 'partial', title: 'Liveness исправлена, readiness ещё пропускает запросы при загрузке',
        expected: { stable: true, rollout: false },
        patch: deploymentPatch({ name: 'server', livenessProbe: { httpGet: { path: '/health' } } }),
      },
      {
        id: 'fixed', title: 'Liveness и readiness проверяют свои условия',
        expected: { stable: true, rollout: true },
        patch: deploymentPatch({ name: 'server', readinessProbe: { httpGet: { path: '/ready' } } }),
      },
    ],
  },
  {
    id: 'k8s-service-endpoints',
    stages: [
      { id: 'broken', title: 'Селектор, порт и DNS витрины сломаны', expected: { endpoints: false, catalog: false, 'web-ready': false, web: false, placement: true } },
      { id: 'partial', title: 'Каталог доступен, витрина всё ещё ждёт DNS в своём namespace', expected: { endpoints: true, catalog: true, 'web-ready': false, web: false, placement: true }, commands: [{ service: 'kubectl', args: ['kubectl', '-n', 'catalog', 'patch', 'service', 'catalog', '--type=merge', '-p', JSON.stringify({ spec: { selector: { app: 'catalog-api' }, ports: [{ port: 80, targetPort: 8080 }] } })] }] },
      { id: 'fixed', title: 'Витрина использует FQDN каталога', expected: { endpoints: true, catalog: true, 'web-ready': true, web: true, placement: true }, commands: [
        { service: 'kubectl', args: ['kubectl', '-n', 'storefront', 'patch', 'deployment', 'web', '--type=strategic', '-p', JSON.stringify({ spec: { template: { spec: { initContainers: [{ name: 'wait-catalog', command: ['sh', '-c', 'until getent hosts catalog.catalog.svc.cluster.local; do sleep 2; done'] }], containers: [{ name: 'web', env: [{ name: 'CATALOG_URL', value: 'http://catalog.catalog.svc.cluster.local/products' }] }] } } } })] },
        { service: 'kubectl', args: ['kubectl', '-n', 'storefront', 'rollout', 'status', 'deployment/web', '--timeout=120s'] },
      ] },
    ],
  },
  {
    id: 'linux-systemd-unit', kind: 'server',
    stages: [
      { id: 'broken', title: 'Неверный User, закрытые права, нет enable и Restart', expected: { running: false, user: false, enabled: false, restart: false } },
      { id: 'partial', title: 'Сервис доступен от reportsvc, автозапуск и восстановление ещё сломаны', expected: { running: true, user: true, enabled: false, restart: false }, commands: [{ service: 'server', args: ['sh', '-ec', "sed -i 's/User=reports$/User=reportsvc/' /etc/systemd/system/reports.service; chown -R reportsvc:reportsvc /opt/reports; chmod 750 /opt/reports; chmod 640 /opt/reports/app.py; systemctl daemon-reload; systemctl reset-failed reports; systemctl start reports"] }] },
      { id: 'fixed', title: 'Сервис включён и восстанавливается после kill', expected: { running: true, user: true, enabled: true, restart: true }, commands: [{ service: 'server', args: ['sh', '-ec', "sed -i 's/Restart=no/Restart=always/' /etc/systemd/system/reports.service; systemctl daemon-reload; systemctl enable reports; systemctl reset-failed reports; systemctl restart reports"] }] },
    ],
  },
  {
    id: 'docker-oom-healthcheck', kind: 'compose', start: ['worker'],
    stages: [
      { id: 'broken', title: 'OOM воркера и отсутствующий curl в healthcheck', expected: { api: false, limit: false, stable: false } },
      { id: 'partial', title: 'Кэш уложился в 96 МБ, healthcheck ещё не исправлен', expected: { api: false, limit: true, stable: true }, services: { worker: { environment: { PRELOAD_MB: '40' } } }, start: ['worker'] },
      { id: 'fixed', title: 'Healthcheck использует Python, API дождался здорового воркера', expected: { api: true, limit: true, stable: true }, services: { worker: { healthcheck: { test: ['CMD', 'python', '-c', "import urllib.request; urllib.request.urlopen('http://localhost:8000/health', timeout=2)"] } } }, start: ['worker', 'api'] },
    ],
  },
  {
    id: 'train-serve-skew', kind: 'compose', start: ['model-api'],
    stages: [
      { id: 'broken', title: 'Порядок признаков, единицы и пропуски отличаются', expected: { parity: false, missing: false } },
      { id: 'partial', title: 'Порядок и единицы исправлены, пропуски ещё заполняются нулём', expected: { parity: true, missing: false }, files: [{ path: 'serving/features.toml', text: '[[feature]]\nname="monthly_spend"\nsource="monthly_spend_rub"\nscale=0.001\n[[feature]]\nname="tenure_months"\nsource="tenure_months"\n[[feature]]\nname="support_tickets"\nsource="support_tickets"\nfill_missing=0\n' }], commands: [{ service: 'model-api', args: ['restart'] }] },
      { id: 'fixed', title: 'Пропуски заполняются средним из артефакта модели', expected: { parity: true, missing: true }, files: [{ path: 'serving/features.toml', text: '[[feature]]\nname="monthly_spend"\nsource="monthly_spend_rub"\nscale=0.001\n[[feature]]\nname="tenure_months"\nsource="tenure_months"\n[[feature]]\nname="support_tickets"\nsource="support_tickets"\nfill_missing="mean"\n' }], commands: [{ service: 'model-api', args: ['restart'] }] },
    ],
  },
  ...COMPOSE_CASES,
  ...LINUX_CASES,
  ...NAMESPACE_CASES,
  ...NODE_CASES,
  ...BATCH6_CASES,
  ...BATCH7_CASES,
  ...GPU_CASES,
  ...BATCH10_CASES,
]

export function selectCases(args: string[]): { plan: boolean; cases: RegressionCase[]; examCompatibility: boolean } {
  const plan = args.includes('--plan')
  const final = args.includes('--exam-final-compatibility')
  if (final && args.includes('--exam-compatibility')) throw new Error('Выберите один режим совместимости')
  const examCompatibility = final || args.includes('--exam-compatibility')
  const ids = args.filter((a) => a !== '--plan' && a !== '--exam-compatibility' && a !== '--exam-final-compatibility')
  const peers = final ? ['k8s-storm', 'k8s-operator', 'k8s-storage'] : ['k8s-gateway', 'k8s-operator']
  if (examCompatibility && ids.some((id) => !peers.includes(id))) throw new Error('Проверка совместимости поддерживает только ' + peers.join(', '))
  const unknown = ids.find((id) => !REGRESSION_CASES.some((c) => c.id === id))
  if (unknown) throw new Error(`Нет сценария автопрогона «${unknown}». Доступны: ${REGRESSION_CASES.map((c) => c.id).join(', ')}`)
  return { plan, examCompatibility, cases: examCompatibility ? peers.map((id) => REGRESSION_CASES.find((c) => c.id === id)!) : ids.length ? REGRESSION_CASES.filter((c) => ids.includes(c.id)) : REGRESSION_CASES }
}

/** Проверяем конкретные проверки и код выхода, а не доверяем агрегату passed. */
export function validateStage(raw: unknown, test: RegressionCase, stage: RegressionStage, exitCode: number): string[] {
  if (!raw || typeof raw !== 'object') return ['Отчёт не является объектом']
  const report = raw as Record<string, unknown>
  if (report.format !== 'homeops-incident-report' || report.incidentId !== test.id || !Array.isArray(report.checks)) return ['Неверный формат или id отчёта']
  const errors: string[] = []
  const checks = report.checks as { id?: unknown; ok?: unknown; message?: unknown }[]
  const ids = checks.map((c) => c?.id)
  const expectedIds = Object.keys(stage.expected)
  if (new Set(ids).size !== ids.length || ids.length !== expectedIds.length || expectedIds.some((id) => !ids.includes(id))) errors.push('Набор id проверок не совпадает с контрольным сценарием')
  for (const id of expectedIds) {
    const check = checks.find((c) => c?.id === id)
    if (check?.ok !== stage.expected[id]) errors.push(`${id}: ожидалось ${stage.expected[id] ? 'успешно' : 'ошибка'}, получено ${String(check?.ok)} — ${String(check?.message ?? '')}`)
    if (typeof check?.message !== 'string' || !check.message.trim()) errors.push(`${id}: нет сообщения о результате`)
    else if (/Вернуть:\s*kubectl|Удалите их\s*\(kubectl/.test(check.message)) errors.push(`${id}: сообщение проверки раскрывает команду исправления`)
    else if (stage.messageIncludes?.[id] && !check.message.includes(stage.messageIncludes[id])) errors.push(`${id}: сообщение не описывает ожидаемый симптом «${stage.messageIncludes[id]}»`)
  }
  const passed = checks.length > 0 && checks.every((c) => c?.ok === true)
  if (exitCode !== (passed ? 0 : 1)) errors.push(`Код verify ${exitCode} не соответствует проверкам`)
  if (report.passed !== passed) errors.push('Поле passed не соответствует проверкам')
  return errors
}
