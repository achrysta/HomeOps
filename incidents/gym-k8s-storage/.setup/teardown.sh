# PersistentVolume живут на уровне кластера и переживают удаление namespace: статический том зала
# (gym-storage-pv) и тома, привязанные к PVC зала, удаляем — иначе они копятся после каждой сессии
kubectl get pv -o json | python3 -c '
import json, sys
for pv in json.load(sys.stdin)["items"]:
    ref = (pv["spec"].get("claimRef") or {}).get("namespace")
    if ref == "gym-storage" or pv["metadata"]["name"] == "gym-storage-pv":
        print(pv["metadata"]["name"])
' | xargs -r kubectl delete pv --wait=false
