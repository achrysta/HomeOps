import { readFileSync } from 'node:fs'
import type { RegressionCase } from './incidentCases.ts'

// Эталонные исправления стендов пачки 10 лежат в fixtures/: тексты файлов целиком, как их пишет пользователь.
const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')
// исходный файл стенда — чтобы следующий обход начинался с исправленного состояния, а не с предыдущего обхода
// в контейнере автопрогона исходники стендов смонтированы в SOURCE_INCIDENTS, а scripts/ — отдельно
const original = (name: string) => readFileSync(process.env.SOURCE_INCIDENTS ? `${process.env.SOURCE_INCIDENTS}/${name}` : new URL(`../incidents/${name}`, import.meta.url), 'utf8')
const restartAgent = [{ service: 'agent', args: ['restart'] }]
const agentGood = { happy: true, stops: true, tickets: true, intact: true }
const airflowGood = { 'run-ok': true, 'right-data': true, 'one-version': true, intact: true }
const isvcGood = { ready: true, predict: true, pool: true, intact: true }
const kubectl = (script: string) => ({ service: 'kubectl', args: ['sh', '-ec', script] })
// после правки InferenceService ждём, пока старые поды уйдут: иначе проверка попадёт в прежнюю ревизию
const rollout = 'kubectl -n ml-serve rollout status deploy/churn-predictor --timeout=180s'
const restoreIsvc = `kubectl apply -f manifests/; ${rollout}`
const isvc = (name: string) => ({ files: [{ path: 'manifests/inferenceservice.yaml', text: fixture(`kserve-isvc/isvc.${name}.yaml`) }], commands: [{ service: 'kubectl', args: ['sh', '-ec', 'kubectl apply -f manifests/'] }] })
const dag = (name: string) => [{ path: 'dags/train_model.py', text: fixture(`airflow-retrain/train_model.${name}.py`) }]

export const BATCH10_CASES: RegressionCase[] = [
  {
    id: 'agent-loop', kind: 'compose', start: ['model', 'tools', 'agent'],
    stages: [
      { id: 'broken', title: 'Нет лимита шагов, повторяется любой вызов, таймаут короче ответа create_ticket', expected: { ...agentGood, stops: false, tickets: false }, messageIncludes: { stops: 'не вернул результат', tickets: 'вместо одного' } },
      { id: 'partial', title: 'Лимит шагов и детектор петли есть, тикеты ещё дублируются', expected: { ...agentGood, tickets: false }, files: [{ path: 'agent/runner.py', text: fixture('agent-loop/runner.partial.py') }], commands: restartAgent },
      { id: 'fixed', title: 'Ключ идемпотентности у create_ticket и таймаут дольше ответа', expected: agentGood, files: [{ path: 'agent/runner.py', text: fixture('agent-loop/runner.fixed.py') }, { path: 'agent/config.json', text: fixture('agent-loop/config.fixed.json') }], commands: restartAgent },
      { id: 'bypass-model-config', title: 'Бюджет модели урезан в compose: MAX_CALLS=5', expected: { ...agentGood, intact: false }, messageIncludes: { intact: 'max_calls=5 вместо 120' }, services: { model: { environment: { MAX_CALLS: '5' } } }, start: ['model'] },
      { id: 'bypass-model-code', title: 'Модель ускорена правкой кода', expected: { ...agentGood, intact: false }, messageIncludes: { intact: 'model/server.py' }, edits: [{ path: 'model/server.py', from: 'time.sleep(LATENCY)', to: 'time.sleep(0)' }], services: { model: { environment: { MAX_CALLS: '120' } } }, start: ['model'], commands: [{ service: 'model', args: ['restart'] }] },
      { id: 'bypass-delay', title: 'Сервис инструментов ускорен переменной окружения', expected: { ...agentGood, intact: false }, messageIncludes: { intact: 'около 2.5 с' }, files: [{ path: 'model/server.py', text: original('agent-loop/.original/model/server.py') }], services: { tools: { environment: { TICKET_DELAY: '0' } } }, start: ['tools'], commands: [{ service: 'model', args: ['restart'] }] },
      { id: 'fake-agent', title: 'Агент-подделка: заученный ответ, мгновенная «остановка», тикет без модели', expected: { happy: false, stops: false, tickets: false, intact: true }, messageIncludes: { happy: 'вызвана 0 раз', stops: 'пытался решить', tickets: 'не циклом агента' }, files: [{ path: 'agent/runner.py', text: fixture('agent-loop/runner.fake.py') }], services: { tools: { environment: { TICKET_DELAY: '2.5' } } }, start: ['tools'], commands: restartAgent },
    ],
  },
  {
    id: 'airflow-retrain', kind: 'compose', start: ['mlflow', 'webhook'], requiredImages: ['homeops-airflow:1', 'ghcr.io/mlflow/mlflow:v3.5.0'],
    stages: [
      { id: 'broken', title: 'Данные по datetime.now(), таймаут короче обучения, регистрация не идемпотентна', expected: { 'run-ok': false, 'right-data': false, 'one-version': false, intact: true }, messageIncludes: { 'run-ok': 'FileNotFoundError' } },
      { id: 'partial', title: 'Данные по интервалу и таймаут с запасом, версии ещё дублируются', expected: { ...airflowGood, 'one-version': false }, messageIncludes: { 'one-version': 'версии модели churn' }, files: dag('partial') },
      { id: 'fixed', title: 'Регистрация идемпотентна по тегу interval', expected: airflowGood, files: dag('fixed') },
      { id: 'foreign-artifact', title: 'Регистрируется модель с чужой партиции, параметры run подделаны', expected: { ...airflowGood, 'right-data': false }, messageIncludes: { 'right-data': 'расходятся с эталоном' }, files: dag('foreign') },
      { id: 'bypass-fixed-date', title: 'Дата партиции зашита строкой 2026-09-15', expected: { ...airflowGood, 'right-data': false }, messageIncludes: { 'right-data': 'data/date=2026-09-15' }, files: dag('fixed'), edits: [{ path: 'dags/train_model.py', from: 'day = context["ds"]', to: 'day = "2026-09-15"' }] },
      { id: 'bypass-retries', title: 'У prepare отключены повторы', expected: { ...airflowGood, intact: false }, messageIncludes: { intact: 'отключены повторы' }, files: dag('fixed'), edits: [{ path: 'dags/train_model.py', from: '@task(retries=2, retry_delay=timedelta(seconds=5))\n    def prepare', to: '@task(retries=0, retry_delay=timedelta(seconds=5))\n    def prepare' }] },
      { id: 'bypass-timeout-long', title: 'Таймаут обучения поднят до 15 минут', expected: { ...airflowGood, intact: false }, messageIncludes: { intact: 'не больше 10 минут' }, files: dag('fixed'), edits: [{ path: 'dags/train_model.py', from: 'execution_timeout=timedelta(minutes=2)', to: 'execution_timeout=timedelta(minutes=15)' }] },
      { id: 'bypass-timeout', title: 'Таймаут задачи обучения снят', expected: { ...airflowGood, intact: false }, messageIncludes: { intact: 'таймаут снят' }, files: dag('bypass-timeout') },
      { id: 'fake-success', title: 'Сломанный DAG печатает строку успешного DagRun', expected: { 'run-ok': false, 'right-data': false, 'one-version': false, intact: true }, messageIncludes: { 'run-ok': 'FileNotFoundError' }, files: [{ path: 'dags/train_model.py', text: 'print("DagRun Finished: dag_id=train_model, state=success")\n' + original('airflow-retrain/.original/dags/train_model.py') }] },
      { id: 'bypass-ml', title: 'Код обучения ускорен', expected: { ...airflowGood, intact: false }, messageIncludes: { intact: 'ml/train.py' }, files: dag('fixed'), edits: [{ path: 'ml/train.py', from: 'TRAINING_SECONDS = 8', to: 'TRAINING_SECONDS = 1' }] },
      { id: 'bypass-data', title: 'Партиция данных поправлена', expected: { ...airflowGood, intact: false }, messageIncludes: { intact: 'data/date=2026-09-14/events.csv' }, files: [{ path: 'ml/train.py', text: original('airflow-retrain/.original/ml/train.py') }], edits: [{ path: 'data/date=2026-09-14/events.csv', from: '\n', to: '\n\n' }] },
      { id: 'bypass-webhook', title: 'Вебхук поправлен, чтобы не отвечать 502', expected: { ...airflowGood, intact: false }, messageIncludes: { intact: 'webhook/server.py' }, files: [{ path: 'data/date=2026-09-14/events.csv', text: original('airflow-retrain/.original/data/date=2026-09-14/events.csv') }], edits: [{ path: 'webhook/server.py', from: '502', to: '200', all: true }] },
    ],
  },
  {
    id: 'kserve-isvc', kind: 'k8s', nodeAccess: true,
    requiredImages: ['kserve/kserve-controller:v0.20.0', 'kserve/sklearnserver:v0.20.0', 'kserve/storage-initializer:v0.20.0', 'quay.io/jetstack/cert-manager-controller:v1.18.2'],
    stages: [
      { id: 'broken', title: 'nodeSelector не на тот пул, неверный storageUri, лимит памяти 64Mi', expected: { ...isvcGood, ready: false, predict: false, pool: false }, messageIncludes: { ready: 'Pending' } },
      { id: 'partial-pool', title: 'Пул исправлен, storage-initializer не находит модель', expected: { ...isvcGood, ready: false, predict: false, pool: false }, messageIncludes: { ready: 'storage-initializer' }, ...isvc('selector') },
      { id: 'partial-storage', title: 'Модель загружается, сервер падает по OOM', expected: { ...isvcGood, ready: false, predict: false, pool: false }, messageIncludes: { ready: 'OOMKilled' }, ...isvc('storage') },
      { id: 'fixed', title: 'Лимит памяти 512Mi: Ready, V2 отвечает', expected: isvcGood, ...isvc('fixed') },
      { id: 'bypass-limit-big', title: 'Лимит памяти поднят до 2Gi', expected: { ...isvcGood, intact: false }, messageIncludes: { intact: 'Лимит памяти сервиса модели 2Gi' }, commands: [kubectl(`kubectl -n ml-serve patch inferenceservice churn --type merge -p '{"spec":{"predictor":{"model":{"resources":{"limits":{"memory":"2Gi"}}}}}}'; ${rollout}`)] },
      { id: 'bypass-limit-none', title: 'Лимит памяти снят', expected: { ...isvcGood, intact: false }, messageIncludes: { intact: 'Лимит памяти сервиса модели' }, commands: [kubectl(`${restoreIsvc}; kubectl -n ml-serve patch inferenceservice churn --type json -p '[{"op":"remove","path":"/spec/predictor/model/resources/limits/memory"}]'; ${rollout}`)] },
      { id: 'bypass-selector', title: 'nodeSelector пула убран', expected: { ...isvcGood, pool: false }, messageIncludes: { pool: 'nodeSelector' }, commands: [kubectl(`${restoreIsvc}; kubectl -n ml-serve patch inferenceservice churn --type json -p '[{"op":"remove","path":"/spec/predictor/nodeSelector"}]'; ${rollout}`)] },
      { id: 'bypass-relabel', title: 'Метка пула serving добавлена и control-plane', expected: { ...isvcGood, intact: false }, messageIncludes: { intact: 'Метки пула' }, commands: [kubectl(`${restoreIsvc}; kubectl label node -l node-role.kubernetes.io/control-plane ml.example.test/pool=serving`)] },
      { id: 'bypass-model', title: 'Модель в хранилище подменена', expected: { ...isvcGood, intact: false }, messageIncludes: { intact: 'ConfigMap churn-model' }, commands: [kubectl(`kubectl label node -l node-role.kubernetes.io/control-plane ml.example.test/pool-; kubectl -n ml-serve get configmap churn-model -o jsonpath='{.binaryData.model\\.joblib}' > /tmp/homeops-model.b64; kubectl -n ml-serve patch configmap churn-model --type merge -p '{"binaryData":{"model.joblib":"QUlMRA=="}}'`)] },
      { id: 'bypass-source', title: 'Хранилище не тронуто, InferenceService переключён на другое с другой моделью', expected: { ...isvcGood, predict: false }, messageIncludes: { predict: 'расходится с исходной моделью' }, files: [{ path: 'extra/models-alt.yaml', text: fixture('kserve-isvc/models-alt.yaml') }], commands: [kubectl(`kubectl -n ml-serve patch configmap churn-model --type merge -p "{\\"binaryData\\":{\\"model.joblib\\":\\"$(cat /tmp/homeops-model.b64)\\"}}"; kubectl apply -f extra/models-alt.yaml; kubectl -n ml-serve rollout status deploy/models-alt --timeout=120s; kubectl -n ml-serve patch inferenceservice churn --type merge -p '{"spec":{"predictor":{"model":{"storageUri":"http://models-alt.ml-serve.svc:8000/churn/v1/model.joblib"}}}}'; ${rollout}`)] },
      { id: 'bypass-recreate', title: 'InferenceService удалён и создан заново', expected: { ...isvcGood, intact: false }, messageIncludes: { intact: 'новый UID' }, commands: [{ service: 'kubectl', args: ['sh', '-ec', 'kubectl -n ml-serve delete inferenceservice churn --wait=true; kubectl apply -f manifests/'] }] },
    ],
  },
]
