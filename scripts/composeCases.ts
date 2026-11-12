import type { RegressionCase } from './incidentCases.ts'

const edit = (path: string, from: string, to: string) => ({ path, from, to })
const restart = (service: string) => ({ service, args: ['restart'] })
const reloadProm = { service: 'vllm', args: ['python', '-c', "import urllib.request; urllib.request.urlopen(urllib.request.Request('http://prometheus:9090/-/reload',data=b''),timeout=5)"] }
const llmCommand = (parallel: number) => ['--hf-repo', 'Qwen/Qwen2.5-0.5B-Instruct-GGUF:Q4_K_M', '--host', '0.0.0.0', '--port', '8080', '--ctx-size', '8192', '--parallel', String(parallel), '--metrics']

const pg = (service: string, sql: string) => ({
  service, args: ['psql', '-X', '-U', 'lab', '-d', 'shop', '-v', 'ON_ERROR_STOP=1', '-c', sql],
})
const waitRestore = (condition: string) => ({
  service: 'restore',
  args: ['sh', '-ec', `for i in $(seq 1 40); do
    result=$(PGPASSWORD=lab PGCONNECT_TIMEOUT=2 psql -h 127.0.0.1 -XAtq -U lab -d shop -c "${condition}" 2>/dev/null) || result=
    [ "$result" = t ] && exit 0
    sleep 0.25
  done
  exit 1`],
})
const waitPromoted = waitRestore('SELECT NOT pg_is_in_recovery()')

const waitSync = { service: 'primary', args: ['sh', '-ec', `for i in $(seq 1 120); do
    n=$(psql -XAtq -U lab -d shop -c "SELECT count(*) FROM pg_stat_replication WHERE state = 'streaming' AND sync_state IN ('sync', 'quorum')")
    [ "$n" -ge 1 ] && exit 0
    sleep 0.5
  done
  exit 1`] }

const billing = (service: string, sql: string) => ({
  service, args: ['psql', '-X', '-U', 'lab', '-d', 'billing', '-v', 'ON_ERROR_STOP=1', '-c', sql],
})
const waitInvoice = (id: number, customer: string) => ({ service: 'subscriber', args: ['sh', '-ec', `for i in $(seq 1 60); do
    [ "$(psql -XAtq -U lab -d billing -c "SELECT customer FROM invoices WHERE id = ${id}")" = '${customer}' ] && exit 0
    sleep 0.5
  done
  exit 1`] })

const redisCli = (service: string, ...args: string[]) => ({ service, args: ['redis-cli', ...args] })
const SENTINEL_CONFIG = '"sentinel": {"master": "orders", "nodes": ["sentinel-1:26379", "sentinel-2:26379", "sentinel-3:26379"]}'
// Sentinel узнаёт о готовности реплики из INFO раз в 10 с: повторять FAILOVER, пока он не согласится
const forcedFailover = { service: 'sentinel-1', args: ['sh', '-ec', `for i in $(seq 1 40); do
    [ "$(redis-cli -p 26379 SENTINEL FAILOVER orders)" = OK ] && exit 0
    sleep 1
  done
  exit 1`] }
const dropCache = { service: 'redis', args: ['sh', '-ec', "redis-cli --scan --pattern 'cache:*' | xargs -r -n 500 redis-cli UNLINK >/dev/null"] }
const linkedReplica = (service: string) => ({ service, args: ['sh', '-ec', `for i in $(seq 1 80); do
    redis-cli INFO replication | grep -q '^master_link_status:up' && exit 0
    sleep 0.5
  done
  exit 1`] })

export const COMPOSE_CASES: RegressionCase[] = [
  { id: 'sse-streaming', kind: 'compose', stages: [
    { id: 'broken', title: 'Буферизация и таймаут prefill', expected: { ttft: false, incremental: false, 'long-prompt': false } },
    { id: 'partial', title: 'SSE идёт по частям, длинный prefill ещё обрывается', expected: { ttft: true, incremental: true, 'long-prompt': false }, edits: [edit('nginx/llm.conf', 'proxy_buffer_size 16k;', 'proxy_buffering off;\n        proxy_buffer_size 16k;')], commands: [{ service: 'proxy', args: ['nginx', '-s', 'reload'] }] },
    { id: 'fixed', title: 'Таймаут покрывает prefill и генерацию', expected: { ttft: true, incremental: true, 'long-prompt': true }, edits: [edit('nginx/llm.conf', 'proxy_read_timeout 5s;', 'proxy_read_timeout 300s;')], commands: [{ service: 'proxy', args: ['nginx', '-s', 'reload'] }] },
  ] },
  { id: 'gateway-fallback', kind: 'compose', stages: [
    { id: 'broken', title: 'Основная здорова — работает, зависание и 503 не переживает', expected: { healthy: true, hang: false, overload: false } },
    { id: 'partial', title: 'Таймаут и адрес резерва исправлены, 503 ещё не переключает', expected: { healthy: true, hang: true, overload: false }, edits: [edit('gateway/config.toml', 'timeout = 60', 'timeout = 3'), edit('gateway/config.toml', 'max_retries = 2', 'max_retries = 0'), edit('gateway/config.toml', 'fallback:8001', 'fallback:8000')], commands: [restart('gateway')] },
    { id: 'fixed', title: '503 входит в условия переключения', expected: { healthy: true, hang: true, overload: true }, edits: [edit('gateway/config.toml', '[429, 500, 502, 504]', '[429, 500, 502, 503, 504]')], commands: [restart('gateway')] },
  ] },
  { id: 'vllm-metrics', kind: 'compose', stages: [
    { id: 'broken', title: 'Target down, правила формально загружены', expected: { scrape: false, rules: true, ttft: false, alert: false } },
    { id: 'partial', title: 'Scrape исправлен, формула и алерт ещё неверны', expected: { scrape: true, rules: true, ttft: false, alert: false }, edits: [edit('prometheus/prometheus.yml', 'vllm:8080', 'vllm:8000')], commands: [reloadProm] },
    { id: 'fixed', title: 'Histogram сохраняет le, алерт реагирует на очередь', expected: { scrape: true, rules: true, ttft: true, alert: true }, edits: [edit('prometheus/rules.yml', 'sum by (model_name)', 'sum by (le, model_name)'), edit('prometheus/rules.yml', 'vllm:num_requests_waiting{model_name="Qwen/Qwen2.5-1.5B"}', 'vllm:num_requests_waiting'), edit('prometheus/rules.yml', 'for: 15m', 'for: 30s')], commands: [reloadProm] },
    { id: 'bypass-name', title: 'Обход: переименовать recording rule вместо сохранения контракта', expected: { scrape: true, rules: false, ttft: false, alert: false }, edits: [edit('prometheus/rules.yml', 'job:vllm_ttft_seconds:p95', 'renamed_ttft_seconds')], commands: [reloadProm] },
  ] },
  { id: 'rag-retrieval', kind: 'compose', start: ['qdrant', 'embedder', 'api'], stages: [
    { id: 'broken', title: 'Полный индекс, другая модель запроса и высокий порог', expected: { index: true, recall: false, 'off-topic': true }, commands: [{ service: 'ingest', run: true, args: ['python', '-u', '/app/ingest.py'] }] },
    { id: 'partial', title: 'Модели совпадают, порог ещё отсекает релевантное', expected: { index: true, recall: false, 'off-topic': true }, services: { api: { environment: { EMBED_MODEL: 'hash-v2' } } }, start: ['api'] },
    { id: 'fixed', title: 'Порог отделяет релевантное от вопросов не по теме', expected: { index: true, recall: true, 'off-topic': true }, edits: [edit('api/config.toml', 'score_threshold = 0.85', 'score_threshold = 0.3')], commands: [restart('api')] },
  ] },
  { id: 'eval-gate', kind: 'compose', start: [], stages: [
    { id: 'broken', title: 'Gate игнорируется, единицы и знак неверны', expected: { 'blocks-accuracy': false, 'blocks-latency': false, 'ships-good': true } },
    { id: 'partial', title: 'Pipeline останавливается и единицы исправлены, знак задержки неверен', expected: { 'blocks-accuracy': true, 'blocks-latency': false, 'ships-good': true }, edits: [edit('ci/pipeline.sh', '|| echo "WARNING: quality gate reported problems, see output above"', '|| exit 1'), edit('eval/gate.toml', 'max_drop = 3', 'max_drop = 0.03')] },
    { id: 'fixed', title: 'Рост задержки считается относительно baseline', expected: { 'blocks-accuracy': true, 'blocks-latency': true, 'ships-good': true }, edits: [edit('eval/gate.py', '(b - c) / b * 100', '(c - b) / b * 100')] },
  ] },
  { id: 'llm-context', kind: 'compose', envFile: 'models/qwen2.5-0.5b.env', start: ['llm'], stages: [
    { id: 'broken', title: '2048 токенов разделены на восемь слотов', expected: { 'memory-limit': true, ready: true, 'long-prompt': false, parallel: false, 'long-answer': false } },
    { id: 'partial', title: 'Контекст достаточный, слот пока один', expected: { 'memory-limit': true, ready: true, 'long-prompt': true, parallel: false, 'long-answer': true }, services: { llm: { command: llmCommand(1) } }, start: ['llm'] },
    { id: 'fixed', title: '8192 токенов, четыре слота, лимит пресета сохранён', expected: { 'memory-limit': true, ready: true, 'long-prompt': true, parallel: true, 'long-answer': true }, services: { llm: { command: llmCommand(4) } }, start: ['llm'] },
    { id: 'bypass-memory', title: 'Обход: поднять лимит через .env и Compose', expected: { 'memory-limit': false, ready: true, 'long-prompt': true, parallel: true, 'long-answer': true }, files: [{ path: '.env', text: 'LLM_MEM_LIMIT=2g\n' }], services: { llm: { mem_limit: '2g' } }, start: ['llm'] },
  ] },
  { id: 'docker-network-dns', kind: 'compose', stages: [
    { id: 'broken', title: 'API обращается к localhost, Redis изолирован', expected: { deps: false, isolation: true } },
    { id: 'partial', title: 'Имя и сети исправлены, Redis ещё слушает loopback', expected: { deps: false, isolation: true }, services: { api: { environment: { REDIS_HOST: 'redis' }, networks: { frontend: {}, backend: {} } } }, start: ['api'] },
    { id: 'fixed', title: 'Redis слушает backend, frontend его не видит', expected: { deps: true, isolation: true }, edits: [edit('redis/redis.conf', 'bind 127.0.0.1', 'bind 0.0.0.0'), edit('redis/redis.conf', 'protected-mode yes', 'protected-mode no')], commands: [restart('redis')] },
  ] },
  { id: 'pg-slow-query', kind: 'compose', waitForStart: true, start: ['db', 'reporter'], stages: [
    { id: 'broken', title: 'База и исходный запрос доступны, индекс невалиден', expected: { db: true, query: true, invalid: false, plan: false, fast: false } },
    { id: 'partial', title: 'Невалидный индекс удалён, подходящего пока нет', expected: { db: true, query: true, invalid: true, plan: false, fast: false }, commands: [{ service: 'db', args: ['psql', '-U', 'shop', '-d', 'shop', '-v', 'ON_ERROR_STOP=1', '-c', 'DROP INDEX CONCURRENTLY orders_customer_id_idx'] }] },
    { id: 'fixed', title: 'Составной индекс поддерживает исходный запрос', expected: { db: true, query: true, invalid: true, plan: true, fast: true }, commands: [{ service: 'db', args: ['psql', '-U', 'shop', '-d', 'shop', '-v', 'ON_ERROR_STOP=1', '-c', 'CREATE INDEX CONCURRENTLY orders_customer_created_idx ON orders (customer_id, created_at)'] }] },
    { id: 'bypass-query', title: 'Обход: изменить принадлежащий приложению запрос', expected: { db: true, query: false, invalid: true, plan: false, fast: false }, edits: [edit('app/report.sql', 'LIMIT 20;', 'LIMIT 1;')] },
  ] },
  { id: 'pg-wal-retention', kind: 'compose', waitForStart: true, start: ['db'], stages: [
    { id: 'broken', title: 'Старый слот держит сегмент', expected: { db: true, retired: false, protected: true, released: false } },
    { id: 'partial', title: 'Слот удалён, старый WAL ещё на диске', expected: { db: true, retired: true, protected: true, released: false }, commands: [pg('db', "SELECT pg_drop_replication_slot('legacy_export')")] },
    { id: 'fixed', title: 'Контрольная точка освобождает сегмент', expected: { db: true, retired: true, protected: true, released: true }, commands: [pg('db', 'CHECKPOINT')] },
    { id: 'bypass-recreate', title: 'Новый слот с тем же именем не сохраняет LSN', expected: { db: true, retired: true, protected: false, released: false }, commands: [pg('db', "SELECT pg_drop_replication_slot('orders_dr')"), pg('db', "SELECT * FROM pg_create_physical_replication_slot('orders_dr', true)")] },
  ] },
  { id: 'pg-pitr', kind: 'compose', waitForStart: true, stages: [
    { id: 'broken', title: 'Архив проигран до конца и удаление повторилось', expected: { source: true, copy: true, boundary: false, data: false, promoted: false }, commands: [waitPromoted] },
    { id: 'partial', title: 'Нужные записи доступны, копия ещё на паузе', expected: { source: true, copy: true, boundary: true, data: true, promoted: false }, files: [{ path: 'restore/recovery.conf', text: "recovery_target_name = 'before_bad_delete'\nrecovery_target_action = 'pause'\n" }], commands: [restart('restore'), waitRestore("SELECT pg_get_wal_replay_pause_state() = 'paused'")] },
    { id: 'fixed', title: 'Восстановленная копия готова к записи', expected: { source: true, copy: true, boundary: true, data: true, promoted: true }, edits: [edit('restore/recovery.conf', "recovery_target_action = 'pause'", "recovery_target_action = 'promote'")], commands: [restart('restore'), waitPromoted] },
    { id: 'bypass-source', title: 'Изменение данных исходного узла отклонено', expected: { source: false, copy: true, boundary: true, data: true, promoted: true }, commands: [pg('source', "INSERT INTO ledger(event) VALUES ('unexpected')")] },
  ] },
  { id: 'pg-sync-replica', kind: 'compose', waitForStart: true, allowRedPartial: true, stages: [
    { id: 'broken', title: 'Синхронной назначена выведенная standby1, касса ждёт SyncRep', expected: { payments: true, durability: true, sync: false, pending: false, write: false } },
    { id: 'partial', title: 'Список включает standby2, но реплика представляется как walreceiver', expected: { payments: true, durability: true, sync: false, pending: false, write: false }, commands: [pg('primary', "ALTER SYSTEM SET synchronous_standby_names = 'ANY 1 (standby1, standby2)'"), pg('primary', 'SELECT pg_reload_conf()')] },
    { id: 'fixed', title: 'standby2 под своим именем подтверждает коммиты, чеки проведены сами', expected: { payments: true, durability: true, sync: true, pending: true, write: true }, edits: [edit('standby/standby2.conf', 'hot_standby = on', "hot_standby = on\ncluster_name = 'standby2'")], commands: [restart('standby2'), waitSync] },
    { id: 'bypass-async', title: 'Обход: выключить синхронную репликацию', expected: { payments: true, durability: true, sync: false, pending: true, write: false }, commands: [pg('primary', "ALTER SYSTEM SET synchronous_standby_names = ''"), pg('primary', 'SELECT pg_reload_conf()')] },
    { id: 'bypass-local', title: 'Обход: synchronous_commit = local для кассы', expected: { payments: true, durability: false, sync: true, pending: true, write: false }, commands: [pg('primary', "ALTER SYSTEM SET synchronous_standby_names = 'ANY 1 (standby1, standby2)'"), pg('primary', 'SELECT pg_reload_conf()'), waitSync, pg('primary', 'ALTER ROLE cashier SET synchronous_commit = local')] },
    { id: 'bypass-duplicate', title: 'Обход: пробить зависший чек повторно', expected: { payments: false, durability: true, sync: true, pending: true, write: false }, commands: [pg('primary', 'ALTER ROLE cashier RESET synchronous_commit'), pg('primary', "INSERT INTO payments (receipt, amount) VALUES ('R-2002', 990)")] },
  ] },
  { id: 'pg-logical-conflict', kind: 'compose', waitForStart: true, allowRedPartial: true, stages: [
    { id: 'broken', title: 'Ручные строки 4 и 6 на витрине, подписка встала на insert_exists', expected: { publisher: true, data: false, flow: false } },
    { id: 'partial', title: 'Строка 4 убрана, подписка дошла до следующего конфликта', expected: { publisher: true, data: false, flow: false }, messageIncludes: { data: 'отличается счёт 6' }, commands: [billing('subscriber', 'DELETE FROM invoices WHERE id = 4'), waitInvoice(5, 'ИП Борисов')] },
    { id: 'fixed', title: 'Ручные правки убраны, витрина догнала биллинг', expected: { publisher: true, data: true, flow: true }, commands: [billing('subscriber', 'DELETE FROM invoices WHERE id = 6'), waitInvoice(6, 'ООО Гамма')] },
    { id: 'bypass-resubscribe', title: 'Обход: новый конфликт снят пересозданием подписки без copy_data', expected: { publisher: true, data: false, flow: true }, commands: [billing('subscriber', "INSERT INTO invoices VALUES (7, 'Ручная правка', 0)"), billing('publisher', "INSERT INTO invoices VALUES (7, 'ООО Дельта', 4100)"), billing('subscriber', 'DROP SUBSCRIPTION sub_billing'), billing('subscriber', "CREATE SUBSCRIPTION sub_billing CONNECTION 'host=publisher dbname=billing user=lab password=lab' PUBLICATION pub_billing WITH (copy_data = false)")] },
    { id: 'bypass-publisher', title: 'Обход: удалить счёт в биллинге', expected: { publisher: false, data: false, flow: false }, commands: [billing('publisher', 'DELETE FROM invoices WHERE id = 5')] },
  ] },
  { id: 'redis-sentinel-failover', kind: 'compose', waitForStart: true, stages: [
    { id: 'broken', title: 'Обе реплики с replica-priority 0, учения не стартуют', expected: { cluster: true, analytics: true, candidate: false, app: true, drill: false } },
    { id: 'partial', title: 'redis-2 пригодна, приложение после переключения пишет в бывший мастер', expected: { cluster: true, analytics: true, candidate: true, app: true, drill: false }, commands: [redisCli('redis-2', 'CONFIG', 'SET', 'replica-priority', '100'), redisCli('redis-2', 'CONFIG', 'REWRITE')] },
    { id: 'fixed', title: 'Приложение находит мастер через Sentinel', expected: { cluster: true, analytics: true, candidate: true, app: true, drill: true }, edits: [edit('app/config.json', '"redis_url": "redis://redis-1:6379/0"', SENTINEL_CONFIG)] },
    { id: 'bypass-static', title: 'Обход: ручное переключение и адрес нового мастера в конфиге', expected: { cluster: true, analytics: true, candidate: true, app: true, drill: false }, commands: [forcedFailover, linkedReplica('redis-1')], edits: [edit('app/config.json', SENTINEL_CONFIG, '"redis_url": "redis://redis-2:6379/0"')] },
    { id: 'bypass-analytics', title: 'Обход: аналитическая реплика тоже стала кандидатом', expected: { cluster: true, analytics: false, candidate: true, app: true, drill: false }, commands: [redisCli('redis-3', 'CONFIG', 'SET', 'replica-priority', '100')] },
  ] },
  { id: 'redis-eviction', kind: 'compose', waitForStart: true, stages: [
    { id: 'broken', title: 'Вечные карточки заполнили память, noeviction отказывает в записи', expected: { jobs: true, limit: true, checkout: false, cache: false, load: false } },
    { id: 'partial', title: 'volatile-lru и очистка кэша, карточки ещё без срока жизни', expected: { jobs: true, limit: true, checkout: true, cache: false, load: false }, commands: [redisCli('redis', 'CONFIG', 'SET', 'maxmemory-policy', 'volatile-lru'), dropCache] },
    { id: 'fixed', title: 'Карточки живут 5 минут и вытесняются, задания остаются', expected: { jobs: true, limit: true, checkout: true, cache: true, load: true }, edits: [edit('app/config.json', '"cache_ttl_seconds": 0', '"cache_ttl_seconds": 300')] },
    { id: 'bypass-noeviction', title: 'Обход: срок жизни без политики вытеснения', expected: { jobs: true, limit: true, checkout: true, cache: true, load: false }, commands: [redisCli('redis', 'CONFIG', 'SET', 'maxmemory-policy', 'noeviction')] },
    { id: 'bypass-limit', title: 'Обход: поднять лимит памяти', expected: { jobs: true, limit: false, checkout: true, cache: true, load: false }, commands: [redisCli('redis', 'CONFIG', 'SET', 'maxmemory-policy', 'volatile-lru'), redisCli('redis', 'CONFIG', 'SET', 'maxmemory', '256mb')] },
    { id: 'bypass-allkeys', title: 'Обход: allkeys-lru вытесняет и задания', expected: { jobs: true, limit: true, checkout: true, cache: true, load: false }, commands: [redisCli('redis', 'CONFIG', 'SET', 'maxmemory', '32mb'), redisCli('redis', 'CONFIG', 'SET', 'maxmemory-policy', 'allkeys-lru')] },
  ] },
]
