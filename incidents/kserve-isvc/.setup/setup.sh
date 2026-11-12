# Исходное состояние (пул serving уже размечен: homeops-cluster prepare): cert-manager и KServe 0.20 в режиме
# Standard из локальных чартов, хранилище модели, ServingRuntime для sklearn и InferenceService из manifests/
set -e
helm upgrade --install cert-manager .setup/charts/cert-manager-v1.18.2.tgz -n cert-manager \
  --set crds.enabled=true --set startupapicheck.enabled=false --wait --timeout 5m >/dev/null
helm upgrade --install kserve-crd .setup/charts/kserve-crd-v0.20.0.tgz -n kserve --wait --timeout 5m >/dev/null
# webhook cert-manager отвечает не сразу после готовности подов — устанавливаем KServe с повтором
for i in $(seq 1 20); do
  helm upgrade --install kserve-resources .setup/charts/kserve-resources-v0.20.0.tgz -n kserve \
    --set kserve.controller.deploymentMode=Standard --set kserve.controller.gateway.disableIngressCreation=true \
    --wait --timeout 5m >/dev/null 2>&1 && break
  sleep 6
done
helm status kserve-resources -n kserve >/dev/null
kubectl -n ml-serve create configmap churn-model --from-file=model.joblib=.setup/model/model.joblib >/dev/null
for i in $(seq 1 20); do kubectl apply -f .setup/platform.yaml >/dev/null 2>&1 && break; sleep 3; done
kubectl apply -f .setup/platform.yaml >/dev/null
kubectl -n ml-serve rollout status deploy/models --timeout=120s >/dev/null
# webhook KServe тоже готовится несколько секунд
for i in $(seq 1 20); do kubectl apply -f manifests/ >/dev/null 2>&1 && break; sleep 3; done
kubectl apply -f manifests/ >/dev/null
# отметки до поломки: InferenceService не пересоздают, модель в хранилище не меняют
kubectl -n ml-serve create configmap homeops-marks \
  --from-literal=isvc-uid="$(kubectl -n ml-serve get inferenceservice churn -o jsonpath='{.metadata.uid}')" \
  --from-literal=model-sha="$(sha256sum .setup/model/model.joblib | cut -d' ' -f1)" >/dev/null
