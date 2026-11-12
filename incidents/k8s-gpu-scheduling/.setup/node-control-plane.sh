# GPU-пул (выполняется внутри узла homeops-control-plane: homeops-cluster prepare k8s-gpu-scheduling).
# worker — GPU-узел: метка пула, taint для подов без GPU, один GPU как расширенный ресурс узла
# (так его объявил бы device plugin; здесь он эмулирован патчем статуса).
set -e
export KUBECONFIG=/etc/kubernetes/admin.conf
WORKER=$(kubectl get nodes -l '!node-role.kubernetes.io/control-plane' -o jsonpath='{.items[0].metadata.name}')
kubectl label node "$WORKER" node.example.test/pool=gpu nvidia.com/gpu.product=GeForce-RTX-4060 --overwrite >/dev/null
kubectl taint node "$WORKER" nvidia.com/gpu=present:NoSchedule --overwrite >/dev/null
kubectl patch node "$WORKER" --subresource=status --type=json -p '[{"op":"add","path":"/status/capacity/nvidia.com~1gpu","value":"1"}]' >/dev/null
for _ in $(seq 1 30); do [ "$(kubectl get node "$WORKER" -o jsonpath='{.status.allocatable.nvidia\.com/gpu}')" = "1" ] && break; sleep 1; done
echo "GPU-пул подготовлен: $WORKER"
