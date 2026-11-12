# CRD и права оператора — объекты уровня кластера: убираем их сами
kubectl delete clusterrolebinding,clusterrole backup-operator --ignore-not-found >/dev/null
kubectl delete crd backups.ops.example.test --ignore-not-found --wait=false >/dev/null
