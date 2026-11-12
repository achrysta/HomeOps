# Исходное состояние: политики и поды платформенной команды (.setup/platform.yaml),
# код сервисов в ConfigMap и манифесты команд из manifests/
set -e
kubectl apply -f .setup/platform.yaml
kubectl -n embeddings create configmap embedder-app --from-file=app.py=.setup/embedder.py
kubectl -n rag create configmap search-app --from-file=app.py=.setup/search.py
kubectl apply -f manifests/
