import type { RegressionCase } from './incidentCases.ts'

const edit = (path: string, from: string, to: string) => ({ path, from, to })
const shell = (service: string, script: string, run = false) => ({ service, args: ['sh', '-ec', script], run })
const k = (script: string) => shell('kubectl', script)
const ci = (script: string) => shell('shell', script, true)
const server = (script: string) => shell('server', `cd /srv/pricing; ${script}`)
const ciBad = { lock: false, upgrade: false, lint: false, tests: false, behavior: false, ci: false }
const ciGood = { lock: true, upgrade: true, lint: true, tests: true, behavior: true, ci: true }
const source = `"""Порядок релизов по git-тегам."""
from packaging.version import InvalidVersion, Version, parse


def release_versions(tags: list[str]) -> list[Version]:
    versions = []
    for tag in tags:
        try:
            version = parse(tag.removeprefix("v"))
        except InvalidVersion:
            continue
        versions.append(version)
    return sorted(versions)


def latest(tags: list[str]) -> Version | None:
    stable = [v for v in release_versions(tags) if not v.is_prerelease]
    return stable[-1] if stable else None
`
const code = (text = source) => ({ path: 'project/src/release_notes/versions.py', text })
const bisect = 'git bisect start main v1.3.0; git bisect run sh -c "make -s build || exit 125; make -s test"; git rev-parse refs/bisect/bad > /answers/culprit'
// Все reset/switch/revert ниже выполняются только внутри собственной серверной копии /srv/pricing.
const fixedMain = 'git reset --hard "$(cat /run/fixed-head)"'
const gitGood = { answer: true, history: true, fixed: true, rounding: true, clean: true }
const stsBad = { headless: false, dns: false, replicas: false, sync: false, data: true, config: true }
const stsGood = { headless: true, dns: true, replicas: true, sync: true, data: true, config: true }
const stsWait = 'kubectl -n ledger rollout status sts/kv --timeout=180s'
const gwBad = { controller: true, ingress: false, 'ingress-paths': false, route: false, api: false, scope: true }
const gwGood = { controller: true, ingress: true, 'ingress-paths': true, route: true, api: true, scope: true }
const gwApply = k('kubectl apply -f manifests/; sleep 8')
const opBad = { crd: true, backup: false, watched: false, cronjob: false, rbac: true }
const opGood = { crd: true, backup: true, watched: true, cronjob: true, rbac: true }
const gpuBad = { node: true, classes: true, inference: false, training: false }
const gpuGood = { node: true, classes: true, inference: true, training: true }
const gpuFix = `kubectl -n serving patch deploy llm-api --type=merge -p '{"spec":{"template":{"spec":{"nodeSelector":{"gpu-pool":null,"node.example.test/pool":"gpu"},"tolerations":[{"key":"nvidia.com/gpu","operator":"Equal","value":"present","effect":"NoSchedule"}],"priorityClassName":"inference-critical"}}}}'; kubectl -n serving rollout status deploy/llm-api --timeout=180s; sleep 8`

export const BATCH6_CASES: RegressionCase[] = [
  { id: 'ci-lockfile', kind: 'compose', start: [], offline: true, requiredImages: ['homeops-ci-python:1'], stages: [
    { id: 'broken', title: 'Lock устарел, F401 и LegacyVersion ещё в коде', expected: ciBad },
    { id: 'partial-lock', title: 'uv lock обновлён, ruff ловит F401', expected: { ...ciBad, lock: true, upgrade: true }, messageIncludes: { lint: 'F401' }, commands: [ci('uv lock')] },
    { id: 'partial-import', title: 'Убран только неиспользуемый импорт, LegacyVersion не импортируется', expected: { ...ciBad, lock: true, upgrade: true, lint: true }, messageIncludes: { tests: 'ImportError' }, edits: [edit('project/src/release_notes/versions.py', 'InvalidVersion, LegacyVersion', 'LegacyVersion')] },
    { id: 'fixed', title: 'InvalidVersion пропускает служебные теги, весь CI зелёный', expected: ciGood, files: [code()] },
    { id: 'bypass-conftest', title: 'Обход: свой conftest.py переопределяет тесты', expected: { ...ciGood, lint: false, tests: false, behavior: false, ci: false }, files: [{ path: 'project/conftest.py', text: 'def pytest_collection_modifyitems(items):\n    items.clear()\n' }] },
    { id: 'reset-extra', title: '.exact удаляет добавленный conftest и возвращает исходную поломку', expected: ciBad, commands: [ci('python /tools/reset.py; test ! -e conftest.py; cmp src/release_notes/versions.py /scenario/.original/project/src/release_notes/versions.py')] },
    { id: 'bypass-noqa', title: 'Обход: спрятать ошибку линтера через noqa', expected: { ...ciGood, lint: false, ci: false }, files: [code(source.replace('InvalidVersion, Version, parse', 'InvalidVersion, Version, parse  # noqa'))], commands: [ci('uv lock')] },
    { id: 'bypass-packaging', title: 'Обход: откатить требование packaging', expected: { ...ciGood, upgrade: false, tests: false, behavior: false, ci: false }, files: [code()], commands: [ci("sed -i 's/packaging>=24.2/packaging==21.3/' pyproject.toml; uv lock")] },
    { id: 'bypass-tests', title: 'Обход: изменить тесты', expected: { ...ciGood, tests: false, behavior: false, ci: false }, commands: [ci("cp /scenario/.original/project/pyproject.toml pyproject.toml; uv lock; printf '\n# тесты изменены\n' >> tests/test_versions.py")] },
    { id: 'bypass-ci', title: 'Обход: заменить ci.sh пустым успешным скриптом', expected: { ...ciGood, ci: false }, commands: [ci("cp /scenario/.original/project/tests/test_versions.py tests/test_versions.py; printf '#!/bin/sh\nexit 0\n' > ci.sh")] },
  ] },
  { id: 'git-bisect', kind: 'server', stages: [
    { id: 'broken', title: 'Ночного виновника ещё нет, main красный', expected: { ...gitGood, answer: false, fixed: false, rounding: false } },
    { id: 'partial', title: 'Наивный bisect нашёл несобирающийся WIP-коммит', expected: { ...gitGood, answer: false, fixed: false, rounding: false, clean: false }, messageIncludes: { answer: 'проект не собирается' }, commands: [server('git bisect start main v1.3.0; git bisect run make -s test; git rev-parse refs/bisect/bad > /answers/culprit')] },
    { id: 'fixed', title: 'Сборка с exit 125, правильный виновник, revert и завершённый bisect', expected: gitGood, commands: [server(`git bisect reset; ${bisect}; git bisect reset; git revert --no-edit "$(cat /answers/culprit)"; git rev-parse HEAD > /run/fixed-head`)] },
    { id: 'bypass-history', title: 'Обход: reset --hard до виноватого коммита', expected: { ...gitGood, history: false, fixed: false, rounding: false }, commands: [server('git reset --hard "$(cat /answers/culprit)^"')] },
    { id: 'bypass-tests', title: 'Обход: изменить тесты новым коммитом', expected: { ...gitGood, fixed: false, rounding: false }, commands: [server(`${fixedMain}; printf '\n# обход тестов\n' >> tests/test_money.py; git add tests/test_money.py; git commit -m 'Контрольный обход: изменены тесты'`)] },
    { id: 'bypass-uncommitted', title: 'Обход: исправление только в рабочей копии', expected: { ...gitGood, fixed: false, rounding: false, clean: false }, commands: [server('git reset --hard "$(cat /var/lib/homeops/git-bisect/orig-head)"; sed -i s/ROUND_HALF_EVEN/ROUND_HALF_UP/g pricing/money.py')] },
    { id: 'bypass-bisect', title: 'Обход: правильный main, но bisect не завершён', expected: { ...gitGood, clean: false }, commands: [server(`${fixedMain}; git bisect start "$(cat /var/lib/homeops/git-bisect/orig-head)" v1.3.0; git bisect run sh -c "make -s build || exit 125; make -s test"`)] },
  ] },
  { id: 'k8s-statefulset', stages: [
    { id: 'broken', title: 'Обычный Service и неверный selector', expected: stsBad },
    { id: 'partial', title: 'Service пересоздан headless, selector ещё неверный', expected: stsBad, edits: [edit('manifests/kv.yaml', 'spec:\n  selector:', 'spec:\n  clusterIP: None\n  selector:')], commands: [k('kubectl -n ledger delete svc kv; kubectl apply -f manifests/')] },
    { id: 'fixed', title: 'Селектор tier: store, реплики синхронизированы', expected: stsGood, edits: [edit('manifests/kv.yaml', 'tier: storage', 'tier: store')], commands: [k(`kubectl apply -f manifests/; ${stsWait}`)] },
    { id: 'bypass-leader', title: 'Обход: адрес лидера заменён общим Service', expected: { ...stsGood, config: false }, commands: [k(`kubectl -n ledger set env sts/kv LEADER_URL=http://kv:8080; ${stsWait}`)] },
    { id: 'bypass-readiness', title: 'Обход: readiness выдаёт готовность без синхронизации', expected: { ...stsGood, config: false }, commands: [k(`kubectl -n ledger set env sts/kv LEADER_URL=http://kv-0.kv:8080; kubectl -n ledger patch sts kv --type=strategic -p '{"spec":{"template":{"spec":{"containers":[{"name":"kv","readinessProbe":{"httpGet":{"path":"/stats"}}}]}}}}'; ${stsWait}`)] },
    { id: 'bypass-data', title: 'Обход: пересоздать StatefulSet и PVC, потеряв исходные данные', expected: { ...stsGood, data: false }, commands: [k(`kubectl -n ledger delete sts kv --wait=true; kubectl -n ledger delete pvc data-kv-0 data-kv-1 data-kv-2; kubectl apply -f manifests/; ${stsWait}`)] },
  ] },
  { id: 'k8s-gateway', teardownObjects: { crd: ['gatewayclasses.gateway.networking.k8s.io', 'gateways.gateway.networking.k8s.io', 'httproutes.gateway.networking.k8s.io', 'referencegrants.gateway.networking.k8s.io', 'grpcroutes.gateway.networking.k8s.io'], clusterrole: ['homeops-gw-traefik'], clusterrolebinding: ['homeops-gw-traefik'], ingressclass: ['traefik'], gatewayclass: ['traefik'] }, stages: [
    { id: 'broken', title: 'Ingress не обслуживается, HTTPRoute не принят', expected: gwBad },
    { id: 'partial-class', title: 'IngressClass исправлен, вложенные пути ещё 404', expected: { ...gwBad, ingress: true }, edits: [edit('manifests/market-ingress.yaml', 'ingressClassName: nginx', 'ingressClassName: traefik')], commands: [gwApply] },
    { id: 'partial-path', title: 'Prefix работает, Gateway ещё отвергает чужой namespace', expected: { ...gwBad, ingress: true, 'ingress-paths': true }, edits: [edit('manifests/market-ingress.yaml', 'pathType: Exact', 'pathType: Prefix')], commands: [gwApply] },
    { id: 'partial-scope', title: 'Selector допускает namespace, backend port ещё неправильный', expected: { ...gwGood, api: false }, edits: [edit('manifests/edge-gateway.yaml', '      port: 8000', '      port: 8000\n      allowedRoutes:\n        namespaces:\n          from: Selector\n          selector:\n            matchLabels:\n              gateway-access: "true"')], commands: [gwApply] },
    { id: 'fixed', title: 'HTTPRoute указывает порт Service 80', expected: gwGood, edits: [edit('manifests/orders-route.yaml', 'port: 8080', 'port: 80')], commands: [gwApply] },
    { id: 'bypass-all', title: 'Обход: Gateway допускает все namespace', expected: { ...gwGood, scope: false }, edits: [edit('manifests/edge-gateway.yaml', 'from: Selector', 'from: All')], commands: [gwApply] },
    { id: 'bypass-web-host', title: 'Обход: HTTPRoute забирает host витрины', expected: { ...gwGood, api: false, scope: false }, edits: [edit('manifests/edge-gateway.yaml', 'from: All', 'from: Selector'), edit('manifests/orders-route.yaml', 'api.market.example.test', 'market.example.test')], commands: [gwApply] },
    { id: 'bypass-copy', title: 'Обход: копия маршрута API у общего Gateway', expected: { ...gwGood, scope: false }, edits: [edit('manifests/orders-route.yaml', 'market.example.test', 'api.market.example.test')], commands: [gwApply, k(`kubectl -n market-api get httproute orders -o json | python3 -c 'import json,sys; r=json.load(sys.stdin); r["metadata"]={"name":"orders-copy","namespace":"gw-system"}; r.pop("status",None); print(json.dumps(r))' | kubectl apply -f -; sleep 8`)] },
  ] },
  { id: 'k8s-operator', teardownObjects: { crd: ['backups.ops.example.test'], clusterrole: ['backup-operator'], clusterrolebinding: ['backup-operator'] }, stages: [
    { id: 'broken', title: 'Backup по снятой версии API, CRD и узкие права на месте', expected: opBad },
    { id: 'partial-api', title: 'Backup v1 с прежними schedule и retentionDays', expected: { ...opBad, backup: true }, edits: [edit('manifests/backup.yaml', 'ops.example.test/v1beta1', 'ops.example.test/v1'), edit('manifests/backup.yaml', 'cron:', 'schedule:'), edit('manifests/backup.yaml', 'keepDays:', 'retentionDays:')], commands: [k('kubectl apply -f manifests/backup.yaml')] },
    { id: 'partial-watch', title: 'Оператор видит inventory, cronjobs ещё не в группе batch', expected: { ...opGood, cronjob: false }, edits: [edit('manifests/operator-config.yaml', 'billing payments', 'billing payments inventory')], commands: [k('kubectl apply -f manifests/operator-config.yaml; kubectl -n ops-system rollout restart deploy/backup-operator; kubectl -n ops-system rollout status deploy/backup-operator --timeout=120s; sleep 8')] },
    { id: 'fixed', title: 'Права на cronjobs в batch, CronJob создаёт оператор', expected: opGood, edits: [edit('manifests/operator-rbac.yaml', 'apiGroups: [apps]', 'apiGroups: [batch]')], commands: [k('kubectl apply -f manifests/operator-rbac.yaml; sleep 8')] },
    { id: 'bypass-admin', title: 'Обход: cluster-admin оператору', expected: { ...opGood, rbac: false }, commands: [k('kubectl create clusterrolebinding regr-operator-admin --clusterrole=cluster-admin --serviceaccount=ops-system:backup-operator')] },
    { id: 'bypass-manual', title: 'Обход: CronJob вручную без ownerReference', expected: { ...opGood, cronjob: false }, commands: [k(`kubectl delete clusterrolebinding regr-operator-admin; kubectl -n inventory get cronjob backup-inventory-db -o json > /tmp/regr-cj.json; kubectl -n inventory delete backup inventory-db; kubectl -n inventory wait --for=delete cronjob/backup-inventory-db --timeout=60s; python3 -c 'import json; r=json.load(open("/tmp/regr-cj.json")); r["metadata"]={"name":"backup-inventory-db","namespace":"inventory"}; r.pop("status",None); print(json.dumps(r))' | kubectl apply -f -; kubectl apply -f manifests/backup.yaml; sleep 8`)] },
    { id: 'bypass-crd', title: 'Обход: вернуть served v1beta1 в CRD', expected: { ...opGood, crd: false }, commands: [k(`kubectl -n inventory delete cronjob backup-inventory-db; sleep 8; kubectl patch crd backups.ops.example.test --type=json -p '[{"op":"replace","path":"/spec/versions/1/served","value":true}]'`)] },
  ] },
  { id: 'k8s-gpu-scheduling', nodeAccess: true, teardownObjects: { priorityclass: ['inference-critical', 'batch-low'] }, stages: [
    { id: 'broken', title: 'Нет toleration, неверная метка пула, GPU занят обучением', expected: gpuBad },
    { id: 'partial-toleration', title: 'Toleration добавлен, selector ещё неверный', expected: gpuBad, commands: [k(`kubectl -n serving patch deploy llm-api --type=merge -p '{"spec":{"template":{"spec":{"tolerations":[{"key":"nvidia.com/gpu","operator":"Equal","value":"present","effect":"NoSchedule"}]}}}}'`)] },
    { id: 'partial-selector', title: 'Пул выбран, без приоритета GPU не освобождается', expected: gpuBad, commands: [k(`kubectl -n serving patch deploy llm-api --type=merge -p '{"spec":{"template":{"spec":{"nodeSelector":{"gpu-pool":null,"node.example.test/pool":"gpu"}}}}}'`)] },
    { id: 'fixed', title: 'inference-critical вытесняет обучение без failed Job', expected: gpuGood, commands: [k(gpuFix)] },
    { id: 'workspace-reset', title: 'Пересоздание рабочего места без пересоздания кластера возвращает поломку', expected: gpuBad, workspaceReset: true },
    { id: 'bypass-delete-training', title: 'Обход: вручную удалить работающий под обучения', expected: { ...gpuGood, training: false }, commands: [k(`kubectl -n training delete pod -l app=train-ranker --wait=true; ${gpuFix}`)] },
    { id: 'bypass-taint', title: 'Обход: снять taint GPU-узла', expected: { ...gpuBad, node: false }, resetStand: true, commands: [k(`kubectl taint node homeops-regression-worker nvidia.com/gpu-; ${gpuFix}`)] },
    { id: 'bypass-capacity', title: 'Обход: объявить второй GPU в статусе узла', expected: { ...gpuBad, node: false }, resetStand: true, commands: [k(`kubectl patch node homeops-regression-worker --subresource=status --type=json -p '[{"op":"replace","path":"/status/capacity/nvidia.com~1gpu","value":"2"}]'; ${gpuFix}`)] },
    { id: 'bypass-class', title: 'Обход: поменять платформенный класс приоритета', expected: { ...gpuGood, classes: false, training: false }, resetStand: true, commands: [k(`kubectl delete priorityclass inference-critical; printf 'apiVersion: scheduling.k8s.io/v1\nkind: PriorityClass\nmetadata:\n  name: inference-critical\nvalue: 100001\n' | kubectl apply -f -; ${gpuFix}`)] },
    { id: 'bypass-job', title: 'Обход: пересоздать Job обучения', expected: { ...gpuGood, training: false }, resetStand: true, commands: [k(`${gpuFix}; kubectl -n training delete job train-ranker --wait=true; kubectl apply -f .setup/training.yaml; sleep 8`)] },
  ] },
]
