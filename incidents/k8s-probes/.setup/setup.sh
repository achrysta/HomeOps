# Исходное состояние: код сервера в ConfigMap и манифесты из manifests/
set -e
kubectl -n inference create configmap model-server-app --from-file=server.py=.setup/model_server.py
kubectl apply -f manifests/
