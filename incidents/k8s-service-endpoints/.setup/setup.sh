# Исходное состояние: код приложений в ConfigMap и манифесты из manifests/
set -e
kubectl -n catalog create configmap catalog-app --from-file=app.py=.setup/catalog.py
kubectl -n storefront create configmap web-app --from-file=app.py=.setup/web.py
kubectl apply -f manifests/
