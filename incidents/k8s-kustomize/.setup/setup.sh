# Исходное состояние: в прод когда-то выкатили base напрямую — одна реплика, отладочные логи
set -e
kubectl apply -k app/base -n orders-prod
