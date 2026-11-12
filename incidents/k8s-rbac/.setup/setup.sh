# Исходное состояние: сервисы запущены до включения Pod Security, затем платформенная команда
# переводит namespace models на профиль restricted. Уже работающие поды остаются,
# а новые (при выкатке) admission проверяет по профилю.
set -e
kubectl -n models create configmap server-app --from-file=app.py=.setup/server.py
kubectl -n models create configmap sync-app --from-file=app.py=.setup/sync.py
kubectl apply -f manifests/
kubectl -n models rollout status deployment/model-server --timeout=180s
kubectl -n models rollout status deployment/model-sync --timeout=180s
kubectl label namespace models pod-security.kubernetes.io/enforce=restricted pod-security.kubernetes.io/enforce-version=latest --overwrite
