# Поломка DNS кластера (выполняется внутри узла homeops-control-plane: homeops-cluster prepare k8s-coredns).
# «Причесали» Corefile после обновления и опечатались в зоне плагина kubernetes:
# CoreDNS работает, но имена *.cluster.local больше не обслуживает.
set -e
export KUBECONFIG=/etc/kubernetes/admin.conf
kubectl -n kube-system get configmap coredns -o yaml > /tmp/coredns.yaml
sed -i 's/kubernetes cluster.local in-addr.arpa ip6.arpa/kubernetes cluster.locl in-addr.arpa ip6.arpa/' /tmp/coredns.yaml
grep -q 'cluster.locl' /tmp/coredns.yaml
kubectl replace -f /tmp/coredns.yaml >/dev/null
rm -f /tmp/coredns.yaml
kubectl -n kube-system rollout restart deployment coredns >/dev/null
kubectl -n kube-system rollout status deployment coredns --timeout=120s >/dev/null
echo "DNS кластера подготовлен"
