# Убрать KServe и cert-manager перед повторной подготовкой в том же кластере: релизы Helm и вебхуки
# (вебхук, указывающий на удалённый сервис, блокирует создание объектов). Пул serving на узле не трогаем:
# его готовит homeops-cluster prepare, а кластер стенда пересоздаётся при сбросе и удаляется при остановке.
# InferenceService удаляем, пока контроллер KServe жив: он снимает финализатор, иначе namespace зависнет
kubectl -n ml-serve delete inferenceservice --all --ignore-not-found --wait=true --timeout=60s >/dev/null 2>&1 || true
helm uninstall kserve-resources -n kserve >/dev/null 2>&1 || true
helm uninstall kserve-crd -n kserve >/dev/null 2>&1 || true
helm uninstall cert-manager -n cert-manager >/dev/null 2>&1 || true
kubectl delete validatingwebhookconfiguration,mutatingwebhookconfiguration -l app.kubernetes.io/instance=cert-manager --ignore-not-found >/dev/null 2>&1 || true
for w in $(kubectl get validatingwebhookconfiguration,mutatingwebhookconfiguration -o name 2>/dev/null | grep -i -e kserve -e inferenceservice -e servingruntime); do kubectl delete "$w" --ignore-not-found >/dev/null 2>&1 || true; done
