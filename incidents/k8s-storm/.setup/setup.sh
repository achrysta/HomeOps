# Исходное состояние: правила платформы (квота, default deny), код приложений, манифесты команд из manifests/
set -e
kubectl apply -f .setup/platform.yaml
kubectl -n bazaar create configmap api-app --from-file=api.py=.setup/api.py
kubectl -n bazaar create configmap web-app --from-file=web.py=.setup/web.py
kubectl apply -f manifests/
