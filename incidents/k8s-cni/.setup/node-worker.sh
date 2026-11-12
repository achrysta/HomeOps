# Поломка CNI на узле worker (выполняется внутри узла homeops-worker: homeops-cluster prepare k8s-cni).
# Обслуживание узла не доделали: из бэкапа /etc вернулся конфиг flannel со старого кластера (по алфавиту он
# раньше конфига kindnet, а containerd берёт первый), и containerd переключили на каталог плагинов CNI 1.6,
# куда сами плагины так и не положили.
set -e
cat > /etc/cni/net.d/00-flannel.conflist <<'JSON'
{
  "name": "cbr0",
  "cniVersion": "0.3.1",
  "plugins": [
    { "type": "flannel", "delegate": { "hairpinMode": true, "isDefaultGateway": true } },
    { "type": "portmap", "capabilities": { "portMappings": true } }
  ]
}
JSON
install -d /opt/cni/bin-1.6
printf 'Плагины CNI 1.6 — положить сюда после проверки на тестовом узле (задача PLAT-1207).\n' > /opt/cni/bin-1.6/README
cat >> /etc/containerd/config.toml <<'TOML'

# PLAT-1207: плагины CNI 1.6 — отдельный каталог
[plugins."io.containerd.grpc.v1.cri".cni]
  bin_dir = "/opt/cni/bin-1.6"
TOML
systemctl restart containerd
for _ in $(seq 1 30); do crictl info >/dev/null 2>&1 && break; sleep 1; done
echo "CNI узла worker подготовлен"
