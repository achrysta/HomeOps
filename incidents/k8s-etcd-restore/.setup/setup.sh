# Сервис учёта платежей уже удалён «ночным скриптом» (homeops-cluster prepare); снапшот — на узле control plane.
# Namespace etcd-ops служебный: его создаёт рабочее место, восстановление etcd его удалит — это нормально.
set -e
echo "namespace payments удалён; снапшот etcd — в /var/lib/etcd-backup на узле homeops-control-plane"
