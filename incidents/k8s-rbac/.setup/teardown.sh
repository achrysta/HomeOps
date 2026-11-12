# Привязки уровня кластера не удаляются вместе с namespace: убираем те, что выдают права
# ServiceAccount стенда (например, cluster-admin агенту), иначе они переживут сброс
kubectl get clusterrolebindings -o json | python3 -c '
import json, sys
for b in json.load(sys.stdin)["items"]:
    if any(s.get("kind") == "ServiceAccount" and s.get("namespace") == "models" for s in b.get("subjects") or []):
        print(b["metadata"]["name"])
' | xargs -r kubectl delete clusterrolebinding
