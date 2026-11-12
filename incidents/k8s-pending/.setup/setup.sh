# Исходное состояние: квота платформенной команды (её пользователь не правит) и манифесты сервиса
set -e
kubectl apply -f .setup/quota.yaml
kubectl apply -f manifests/
