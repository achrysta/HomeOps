# Исходное состояние (GPU-узел уже подготовлен: homeops-cluster prepare): классы приоритета, ночное обучение
# занимает GPU, затем инференс из manifests/
set -e
kubectl apply -f .setup/platform.yaml >/dev/null
kubectl -n training create configmap train-app --from-file=train.py=.setup/train.py
kubectl -n serving create configmap llm-api-app --from-file=llm_api.py=.setup/llm_api.py
kubectl apply -f .setup/training.yaml
kubectl -n training wait pod -l app=train-ranker --for=condition=Ready --timeout=120s >/dev/null
# отметка до поломки: Job обучения не пересоздают
kubectl -n training create configmap homeops-marks --from-literal=job-uid="$(kubectl -n training get job train-ranker -o jsonpath='{.metadata.uid}')" >/dev/null
kubectl apply -f manifests/
