# Пул serving (выполняется внутри узла homeops-control-plane: homeops-cluster prepare kserve-isvc).
# Рабочий узел — пул онлайн-инференса: метка пула, по ней платформа размещает сервисы моделей.
set -e
export KUBECONFIG=/etc/kubernetes/admin.conf
WORKER=$(kubectl get nodes -l '!node-role.kubernetes.io/control-plane' -o jsonpath='{.items[0].metadata.name}')
kubectl label node "$WORKER" ml.example.test/pool=serving --overwrite >/dev/null
echo "Пул serving подготовлен: $WORKER"
