# Подготовка узла к обновлению (homeops-cluster prepare k8s-kubeadm-upgrade): пакеты новой версии
# кладутся в /opt/k8s-v1.37.1 — в kind нет apt-репозитория, это замена apt-get install kubeadm=1.37.1-*.
set -e
DIR=/opt/k8s-v1.37.1
MNT=/mnt/homeops-upgrade
mkdir -p "$DIR" "$MNT"
ctr -n k8s.io images mount docker.io/library/homeops-k8s-upgrade:v1.37.1 "$MNT" >/dev/null
for b in kubeadm kubelet kubectl; do install -m 0755 "$MNT/upgrade/$b" "$DIR/$b"; done
ctr -n k8s.io images unmount "$MNT" >/dev/null
rmdir "$MNT"
cat > "$DIR/README" <<'TXT'
Пакеты Kubernetes v1.37.1 для этого узла (в kind нет apt-репозитория).
Аналог apt-get install kubeadm=1.37.1-*: install -m 0755 /opt/k8s-v1.37.1/kubeadm /usr/bin/kubeadm
Так же — kubelet и kubectl (после установки kubelet: systemctl daemon-reload и systemctl restart kubelet).
TXT
echo "узел $(hostname): бинарники v1.37.1 в $DIR"
