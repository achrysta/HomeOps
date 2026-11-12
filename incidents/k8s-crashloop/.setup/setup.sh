# Исходное состояние стенда: код приложения в ConfigMap и манифесты из manifests/
set -e
kubectl -n notify create configmap notify-app --from-file=app.py=.setup/app.py
kubectl apply -f manifests/
