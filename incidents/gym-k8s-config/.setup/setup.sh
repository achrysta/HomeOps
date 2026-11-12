# Зал начинается с Secret db-creds (пароль новый в каждой сессии) и Deployment api без конфигурации.
# Ответы пишутся в /answers рабочего места — папка очищается при каждой подготовке.
set -e
mkdir -p /answers
rm -f /answers/*
PASS=$(head -c 6 /dev/urandom | od -An -tx1 | tr -d ' \n')
kubectl create secret generic db-creds -n gym-config --from-literal=username=app --from-literal=password="$PASS" >/dev/null
kubectl apply -f .setup/api.yaml
echo "В namespace gym-config — Secret db-creds и Deployment api; ConfigMap app-config создаётся в первом подходе"
