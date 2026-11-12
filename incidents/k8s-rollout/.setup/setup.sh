# Исходное состояние: работающий релиз 1.4.2, поверх него — выкатка 2.0.0 из manifests/
set -e
kubectl -n checkout create configmap checkout-app --from-file=app.py=.setup/checkout.py
kubectl apply -f .setup/v1.yaml
kubectl -n checkout rollout status deployment/checkout --timeout=120s
kubectl apply -f manifests/
