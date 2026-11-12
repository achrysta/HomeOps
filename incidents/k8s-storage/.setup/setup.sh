# Исходное состояние: код базы в ConfigMap и манифесты из manifests/
set -e
kubectl -n vectors create configmap vectordb-app --from-file=app.py=.setup/vectordb.py
kubectl apply -f manifests/
