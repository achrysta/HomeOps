# Поломка узла homeops-worker (выполняется внутри узла: homeops-cluster prepare k8s-node-notready).
# «Плановое обновление kubelet» оставило три следа: опечатку в пути к CA в конфиге kubelet,
# неверный флаг в /etc/default/kubelet и kubelet, остановленный и выключенный из автозапуска.
set -e
sed -i 's#clientCAFile: /etc/kubernetes/pki/ca.crt#clientCAFile: /etc/kubernetes/pki/ca.cert#' /var/lib/kubelet/config.yaml
grep -q 'ca.cert' /var/lib/kubelet/config.yaml
cat > /etc/default/kubelet <<'CONF'
# Тюнинг после обновления: больше подов на узле
KUBELET_EXTRA_ARGS="--max-pods=two-hundred"
CONF
systemctl disable --now kubelet
echo "узел homeops-worker подготовлен"
