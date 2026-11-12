# Исходное состояние: код хранилища в ConfigMap, манифесты из manifests/, данные лидера (записаны до поломки)
set -e
kubectl -n ledger create configmap kv-app --from-file=app.py=.setup/kv.py
kubectl apply -f manifests/
for _ in $(seq 1 90); do kubectl -n ledger get pod kv-0 >/dev/null 2>&1 && break; sleep 2; done
kubectl -n ledger wait pod/kv-0 --for=condition=Ready --timeout=180s
python3 .setup/seed.py
