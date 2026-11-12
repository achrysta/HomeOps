# Классы приоритета — объекты уровня кластера: setup создаёт их заново (value у PriorityClass не меняется).
# Узел не трогаем: homeops-level setup вызывает teardown перед setup, а GPU-пул готовит prepare; кластер стенда
# пересоздаётся при сбросе и удаляется при остановке.
kubectl delete priorityclass inference-critical batch-low --ignore-not-found >/dev/null
