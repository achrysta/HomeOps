# Подготовка инцидента k8s-etcd-restore (выполняется внутри узла homeops-control-plane: homeops-cluster prepare).
# Сервис учёта платежей в namespace payments → снапшот etcd «вечернего бэкапа» → «ночной скрипт» удаляет namespace.
set -e
export KUBECONFIG=/etc/kubernetes/admin.conf
# etcdctl и etcdutl — из контейнера etcd (в kubeadm они лежат в его образе)
ETCD_PID=$(pgrep -x etcd)
cp /proc/$ETCD_PID/root/usr/local/bin/etcdctl /proc/$ETCD_PID/root/usr/local/bin/etcdutl /usr/local/bin/

kubectl create namespace payments >/dev/null
TOKEN=$(head -c 8 /dev/urandom | od -An -tx1 | tr -d ' \n')
kubectl -n payments create configmap ledger-config --from-literal=LEDGER_TOKEN="$TOKEN" >/dev/null
kubectl apply -f - >/dev/null <<'YAML'
apiVersion: apps/v1
kind: Deployment
metadata:
  name: ledger
  namespace: payments
spec:
  replicas: 2
  selector:
    matchLabels: { app: ledger }
  template:
    metadata:
      labels: { app: ledger }
    spec:
      containers:
        - name: ledger
          image: python:3.12-alpine
          command: ["sh", "-c", "echo 'ledger: ready, token loaded'; exec python -m http.server 8080"]
          envFrom:
            - configMapRef: { name: ledger-config }
          readinessProbe:
            httpGet: { path: /, port: 8080 }
            periodSeconds: 3
          resources:
            requests: { cpu: 10m, memory: 32Mi }
            limits: { memory: 64Mi }
YAML
kubectl -n payments rollout status deployment ledger --timeout=120s >/dev/null

# Отметка стенда: UID исходных объектов. Попадает в снапшот, поэтому переживает восстановление,
# а объекты, созданные заново руками, получат другие UID
kubectl -n kube-system create configmap homeops-etcd-restore \
  --from-literal=namespace="$(kubectl get namespace payments -o jsonpath='{.metadata.uid}')" \
  --from-literal=config="$(kubectl -n payments get configmap ledger-config -o jsonpath='{.metadata.uid}')" \
  --from-literal=deployment="$(kubectl -n payments get deployment ledger -o jsonpath='{.metadata.uid}')" >/dev/null

mkdir -p /var/lib/etcd-backup
SNAP=/var/lib/etcd-backup/snapshot-$(date -u +%Y%m%d-2100).db
etcdctl --endpoints=https://127.0.0.1:2379 --cacert=/etc/kubernetes/pki/etcd/ca.crt \
  --cert=/etc/kubernetes/pki/etcd/server.crt --key=/etc/kubernetes/pki/etcd/server.key \
  snapshot save "$SNAP" >/dev/null 2>&1
test -s "$SNAP"

# «Ночной скрипт очистки»
kubectl delete namespace payments --wait=true --timeout=120s >/dev/null
echo "etcd подготовлен: снапшот $SNAP, namespace payments удалён"
