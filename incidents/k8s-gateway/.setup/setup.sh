# Исходное состояние: CRD Gateway API, контроллер Traefik, приложения, затем манифесты из manifests/
set -e
kubectl apply --server-side --force-conflicts -f .setup/gateway-api-v1.6.3.yaml >/dev/null
kubectl wait --for=condition=Established --timeout=60s crd/gatewayclasses.gateway.networking.k8s.io crd/gateways.gateway.networking.k8s.io crd/httproutes.gateway.networking.k8s.io >/dev/null
# команде API заказов разрешено подключать маршруты к общему Gateway
kubectl label namespace market-api gateway-access=true >/dev/null
kubectl -n market create configmap storefront-app --from-file=app.py=.setup/storefront.py
kubectl -n market-api create configmap orders-app --from-file=app.py=.setup/orders.py
kubectl apply -f .setup/traefik.yaml -f .setup/apps.yaml
kubectl apply -f manifests/
kubectl -n gw-system rollout status deploy/traefik --timeout=180s
