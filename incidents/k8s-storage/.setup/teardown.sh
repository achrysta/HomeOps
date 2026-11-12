# Тома с reclaimPolicy Retain переживают удаление namespace и PVC: убираем PersistentVolume
# стенда, иначе они копятся в кластере после каждого сброса
kubectl get pv -o json | python3 -c '
import json, sys
for pv in json.load(sys.stdin)["items"]:
    if (pv["spec"].get("claimRef") or {}).get("namespace") == "vectors":
        print(pv["metadata"]["name"])
' | xargs -r kubectl delete pv --wait=false
