# Зал начинается с ServiceAccount deployer и его роли. Право удалять Deployment выдаётся случайно —
# ответ подхода can-i нельзя запомнить, только проверить. Ответы — в /answers рабочего места.
set -e
mkdir -p /answers
rm -f /answers/*
VERBS='"get", "list", "watch", "create", "update", "patch"'
if [ $((RANDOM % 2)) -eq 0 ]; then VERBS="$VERBS, \"delete\""; fi
kubectl apply -f - >/dev/null <<YAML
apiVersion: v1
kind: ServiceAccount
metadata: { name: deployer, namespace: gym-rbac }
---
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata: { name: deploy-manager, namespace: gym-rbac }
rules:
  - apiGroups: ["apps"]
    resources: ["deployments"]
    verbs: [$VERBS]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata: { name: deployer, namespace: gym-rbac }
roleRef: { apiGroup: rbac.authorization.k8s.io, kind: Role, name: deploy-manager }
subjects:
  - { kind: ServiceAccount, name: deployer, namespace: gym-rbac }
YAML
echo "В namespace gym-rbac — ServiceAccount deployer с ролью deploy-manager; reporter создаётся в первом подходе"
