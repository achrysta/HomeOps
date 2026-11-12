# Приложения в namespace netops (поломка CNI на worker уже подготовлена: homeops-cluster prepare k8s-cni).
# Поды не дожидаемся: на сломанном узле они висят в ContainerCreating
set -e
kubectl apply -f .setup/apps.yaml
