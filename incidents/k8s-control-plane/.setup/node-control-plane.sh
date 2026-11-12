# Поломка control plane (выполняется внутри узла homeops-control-plane: homeops-cluster prepare k8s-control-plane).
# После «ночных работ»: опечатка в пути к kubeconfig controller-manager, а манифест scheduler
# перенесли из каталога static pods «на время» и забыли вернуть.
set -e
M=/etc/kubernetes/manifests
sed -i 's#--kubeconfig=/etc/kubernetes/controller-manager.conf#--kubeconfig=/etc/kubernetes/controller-manager.cfg#' $M/kube-controller-manager.yaml
grep -q 'controller-manager.cfg' $M/kube-controller-manager.yaml
mkdir -p /root/maintenance
mv $M/kube-scheduler.yaml /root/maintenance/kube-scheduler.yaml
echo "control plane подготовлен"
