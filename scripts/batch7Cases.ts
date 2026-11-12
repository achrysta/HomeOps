import type { RegressionCase } from './incidentCases.ts'

const shell = (service: string, script: string) => ({ service, args: ['sh', '-ec', script] })
const k = (script: string) => shell('kubectl', script)
const node = (script: string) => ({ ...shell('unused', script), node: 'worker' as const })
const server = (script: string) => shell('server', script)
const edit = (path: string, from: string, to: string) => ({ path, from, to })
const tlsGood = { nginx: true, shop: true, api: true, expiry: true, trust: true, partner: true }
const tlsBad = { ...tlsGood, shop: false, api: false, expiry: false, partner: false }
const sites = '/etc/nginx/sites-available/shop.conf /etc/nginx/sites-available/api.conf'
const shopPath = '/etc/ssl/renewed/shop.example.test'
const reload = 'nginx -t; systemctl reload nginx; sleep 6'
const cniBad = { kindnet: true, placement: true, reports: false, network: false }
const cniGood = { kindnet: true, placement: true, reports: true, network: true }
const cniFix = 'sed -i \'s|bin_dir = "/opt/cni/bin-1.6"|bin_dir = "/opt/cni/bin"|\' /etc/containerd/config.toml; systemctl restart containerd'
const cniWait = 'kubectl -n netops rollout status deploy/reports --timeout=150s; kubectl -n netops rollout status deploy/dashboard --timeout=150s'
const nodeUids = 'kubectl get nodes -o json | python3 -c \'import json,sys; print(sorted((n["metadata"]["name"],n["metadata"]["uid"]) for n in json.load(sys.stdin)["items"]))\''
const stormBad = { platform: true, api: false, stable: false, service: false, orders: false }
const stormGood = { platform: true, api: true, stable: true, service: true, orders: true }
const apply = k('kubectl apply -f manifests/')
const rollout = k('kubectl -n bazaar rollout status deploy/api --timeout=150s')
const apiPatch = (patch: Record<string, unknown>) => k('kubectl -n bazaar patch deploy api --type=strategic -p \'' + JSON.stringify({ spec: { template: { spec: { containers: [{ name: 'api', ...patch }] } } } }) + '\'; kubectl -n bazaar rollout status deploy/api --timeout=150s')

export const BATCH7_CASES: RegressionCase[] = [
  { id: 'linux-tls', kind: 'server', stages: [
    { id: 'broken', title: 'nginx отдаёт истёкший сертификат', expected: tlsBad, messageIncludes: { shop: 'certificate has expired' } },
    { id: 'partial-cert', title: 'Новый cert.pem со старым ключом: nginx -t не проходит', expected: { ...tlsBad, nginx: false }, messageIncludes: { nginx: 'key values mismatch' }, commands: [server("sed -i 's|/etc/nginx/tls/shop.crt|" + shopPath + "/cert.pem|' " + sites)] },
    { id: 'partial-key', title: 'Парный ключ, но без промежуточного CA', expected: tlsBad, messageIncludes: { shop: 'unable to get local issuer certificate' }, commands: [server("sed -i 's|/etc/nginx/tls/shop.key|" + shopPath + "/privkey.pem|' " + sites + '; ' + reload)] },
    { id: 'partial-chain', title: 'Витрина с fullchain; API отдаёт сертификат чужого имени', expected: { ...tlsBad, shop: true }, messageIncludes: { api: 'Hostname mismatch' }, commands: [server("sed -i 's|" + shopPath + '/cert.pem|' + shopPath + "/fullchain.pem|' " + sites + '; ' + reload)] },
    { id: 'fixed', title: 'API использует собственную пару fullchain/privkey, partner-sync ok', expected: tlsGood, messageIncludes: { partner: 'ok:' }, commands: [server("sed -i 's|renewed/shop.example.test/|renewed/api.shop.example.test/|g' /etc/nginx/sites-available/api.conf; " + reload)] },
    { id: 'bypass-client', title: 'Обход: выключить проверку сертификатов в sync.py', expected: { ...tlsGood, trust: false, partner: false }, commands: [server('cp /opt/partner-sync/sync.py /run/regr-sync-original.py; sed -i \'s|ssl.create_default_context(cafile="/etc/partner-sync/ca.pem")|ssl._create_unverified_context()|\' /opt/partner-sync/sync.py; systemctl restart partner-sync; sleep 6')] },
  ] },
  { id: 'k8s-cni', nodeAccess: true, allowRedPartial: true, stages: [
    { id: 'broken', title: 'Старый flannel и пустой каталог CNI: приложения не запускаются', expected: cniBad, commands: [k(nodeUids + ' > /scenario/.reports/node-uids.txt')] },
    { id: 'partial', title: 'Конфиг flannel убран, runtime не находит ptp в bin-1.6', expected: cniBad, messageIncludes: { reports: 'failed to find plugin "ptp" in path [/opt/cni/bin-1.6]' }, commands: [node('rm /etc/cni/net.d/00-flannel.conflist'), k('for i in $(seq 1 90); do kubectl -n netops get events -o json | python3 -c \'import json,sys; sys.exit(not any("failed to find plugin" in e.get("message", "") and "ptp" in e.get("message", "") for e in json.load(sys.stdin)["items"]))\' && exit 0; sleep 1; done; exit 1')] },
    { id: 'workspace-reset', title: 'Рабочее место пересоздано на тех же узлах; приложения снова сломаны', expected: cniBad, workspaceReset: true, commands: [k(nodeUids + ' > /tmp/regr-node-uids.txt; cmp /scenario/.reports/node-uids.txt /tmp/regr-node-uids.txt; echo "UID узлов не изменились"')] },
    { id: 'fixed', title: 'Правильный каталог плагинов и restart containerd', expected: cniGood, commands: [node(cniFix), k(cniWait)] },
    { id: 'bypass-taint', title: 'Обход: снять taint с control-plane', expected: { ...cniGood, placement: false, reports: false, network: false }, commands: [k('kubectl taint node homeops-regression-control-plane node-role.kubernetes.io/control-plane-')] },
    { id: 'bypass-kindnet', title: 'Обход: изменить DaemonSet kindnet (generation)', expected: { ...cniGood, kindnet: false, network: false }, commands: [k('kubectl taint node homeops-regression-control-plane node-role.kubernetes.io/control-plane=:NoSchedule; kubectl -n kube-system patch ds kindnet --type=strategic -p \'{"spec":{"template":{"metadata":{"annotations":{"regr-regression":"bypass"}}}}}\'; kubectl -n kube-system rollout status ds/kindnet --timeout=150s')] },
  ] },
  { id: 'k8s-storm', stages: [
    { id: 'broken', title: 'Лимит API больше всей квоты: поды не создаются', expected: stormBad, messageIncludes: { api: 'exceeded quota' } },
    { id: 'partial-memory', title: 'Лимит 128Mi: теперь видна ошибка ключа ConfigMap', expected: stormBad, messageIncludes: { api: 'CreateContainerConfigError' }, edits: [edit('manifests/api.yaml', 'limits: { memory: 512Mi }', 'limits: { memory: 128Mi }')], commands: [apply, k('for i in $(seq 1 45); do kubectl -n bazaar get pods -l app=orders-api -o json | python3 -c \'import json,sys; sys.exit(not any(s.get("state",{}).get("waiting",{}).get("reason")=="CreateContainerConfigError" for p in json.load(sys.stdin)["items"] for s in p.get("status",{}).get("containerStatuses",[])))\' && exit 0; sleep 1; done; exit 1')] },
    { id: 'partial-key', title: 'DB_HOST правильный, liveness всё ещё перезапускает API', expected: { ...stormBad, api: true }, edits: [edit('manifests/api.yaml', 'key: db_host', 'key: DB_HOST')], commands: [apply, rollout] },
    { id: 'partial-liveness', title: 'API стабилен, Service ещё выбирает чужие метки', expected: { ...stormBad, api: true, stable: true }, edits: [edit('manifests/api.yaml', 'path: /healthz', 'path: /health')], commands: [apply, rollout] },
    { id: 'partial-service', title: 'Service правильный, политика ещё не пускает витрину', expected: { ...stormGood, orders: false }, edits: [edit('manifests/api.yaml', 'selector: { app: api }', 'selector: { app: orders-api }')], commands: [apply] },
    { id: 'fixed', title: 'NetworkPolicy пускает только web к API; заказы видны', expected: stormGood, edits: [edit('manifests/network.yaml', 'app: frontend', 'app: web')], commands: [apply] },
    { id: 'bypass-quota', title: 'Обход: поднять квоту до 2Gi', expected: { ...stormGood, platform: false, orders: false }, commands: [k('kubectl -n bazaar patch quota bazaar-quota --type=merge -p \'{"spec":{"hard":{"limits.memory":"2Gi"}}}\'')] },
    { id: 'bypass-deny', title: 'Обход: удалить default deny', expected: { ...stormGood, platform: false, orders: false }, commands: [k('kubectl apply -f .setup/platform.yaml; kubectl -n bazaar delete networkpolicy default-deny-ingress')] },
    { id: 'bypass-allow-all', title: 'Обход: разрешить вход всем', expected: { ...stormGood, platform: false, orders: false }, commands: [k('kubectl apply -f .setup/platform.yaml; printf \'apiVersion: networking.k8s.io/v1\nkind: NetworkPolicy\nmetadata:\n  name: regr-allow-all\n  namespace: bazaar\nspec:\n  podSelector: {}\n  policyTypes: [Ingress]\n  ingress: [{}]\n\' | kubectl apply -f -')] },
    { id: 'bypass-liveness', title: 'Обход: убрать liveness API', expected: { ...stormGood, stable: false, orders: false }, commands: [k('kubectl -n bazaar delete networkpolicy regr-allow-all'), apiPatch({ livenessProbe: null })] },
    { id: 'bypass-readiness', title: 'Обход: убрать readiness API', expected: { ...stormGood, stable: false, orders: false }, commands: [apiPatch({ livenessProbe: { httpGet: { path: '/health', port: 'http' }, initialDelaySeconds: 5, periodSeconds: 5, failureThreshold: 2 }, readinessProbe: null })] },
  ] },
]
