# Зал начинается с веб-сервиса web без Service и двух клиентов: frontend (role=frontend) и intruder (без роли).
# Ответы — в /answers рабочего места, папка очищается при каждой подготовке.
set -e
mkdir -p /answers
rm -f /answers/*
kubectl apply -f .setup/net.yaml
kubectl -n gym-net rollout status deployment web --timeout=120s >/dev/null
kubectl -n gym-net wait pod/frontend pod/intruder --for=condition=Ready --timeout=120s >/dev/null
echo "В namespace gym-net — Deployment web и клиенты frontend и intruder; Service создаётся в первом подходе"
