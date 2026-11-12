# Исходное состояние: CRD и оператор (платформа), права и настройки оператора, манифест Backup команды
set -e
kubectl apply -f .setup/crd.yaml >/dev/null
kubectl wait --for=condition=Established --timeout=60s crd/backups.ops.example.test >/dev/null
kubectl -n ops-system create configmap backup-operator-app --from-file=backup_operator.py=.setup/backup_operator.py
kubectl apply -f manifests/operator-rbac.yaml -f manifests/operator-config.yaml -f .setup/operator.yaml
# манифест команды под старую версию API: apply падает — так его и застаёт пользователь
kubectl apply -f manifests/backup.yaml 2>/dev/null || true
kubectl -n ops-system rollout status deploy/backup-operator --timeout=120s
