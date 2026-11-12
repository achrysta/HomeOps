# Исходное состояние. metrics-server в кластере — часть задачи: если остался от прошлого
# прохождения (через Helm или манифестом), убираем его вместе с APIService
set -e
helm uninstall metrics-server -n kube-system --wait >/dev/null 2>&1 || true
kubectl -n kube-system delete deployment,service,serviceaccount metrics-server --ignore-not-found >/dev/null
kubectl delete apiservice v1beta1.metrics.k8s.io --ignore-not-found >/dev/null
kubectl -n search create configmap search-app --from-file=app.py=.setup/search.py
kubectl apply -f manifests/
