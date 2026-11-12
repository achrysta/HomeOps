# Исходное состояние: код приложений в ConfigMap и манифесты из manifests/
set -e
kubectl -n payments create configmap ledger-db-app --from-file=app.py=.setup/ledger.py
kubectl -n payments create configmap payments-api-app --from-file=app.py=.setup/payments.py
kubectl apply -f manifests/
