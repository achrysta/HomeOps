# Объекты уровня кластера переживают удаление namespace стенда: убираем их сами
kubectl delete clusterrolebinding,clusterrole homeops-gw-traefik --ignore-not-found >/dev/null
kubectl delete ingressclass traefik --ignore-not-found >/dev/null
kubectl delete gatewayclass traefik --ignore-not-found >/dev/null 2>&1 || true
kubectl delete -f /scenario/.setup/gateway-api-v1.6.3.yaml --ignore-not-found --wait=false >/dev/null 2>&1 || true
