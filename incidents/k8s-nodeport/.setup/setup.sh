# Исходное состояние: код приложения в ConfigMap и манифесты из manifests/
set -e
kubectl -n partners create configmap partner-api-app --from-file=app.py=.setup/api.py
kubectl apply -f manifests/
