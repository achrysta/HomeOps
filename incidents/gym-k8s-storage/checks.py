"""Зал gym-k8s-storage: PVC, том в поде, сохранность данных, статический PV и StatefulSet (namespace gym-storage).

Каждый подход зависит от предыдущего (needs): дашборд засчитывает подходы по порядку.
"""

from incident_kit import check, fail
from k8s_kit import KubectlError, get, kubectl, parse_quantity

NS = "gym-storage"
TEXT = "hello"


def pvc(name: str) -> dict:
    claim = get("pvc", name, NS)
    if claim is None:
        fail(f"PVC {name} в namespace gym-storage пока нет.")
    return claim


def mounts_claim(pod: dict, claim: str, path: str) -> bool:
    vols = {v["name"] for v in pod["spec"].get("volumes") or [] if (v.get("persistentVolumeClaim") or {}).get("claimName") == claim}
    return any(m["name"] in vols and m.get("mountPath", "").rstrip("/") == path for c in pod["spec"]["containers"] for m in c.get("volumeMounts") or [])


def running(pod: dict) -> bool:
    return pod.get("status", {}).get("phase") == "Running" and not pod["metadata"].get("deletionTimestamp")


def read_hello(pod: dict) -> str | None:
    try:
        return kubectl("exec", "-n", NS, pod["metadata"]["name"], "--", "cat", "/data/hello", timeout=15).strip()
    except KubectlError:
        return None


@check("pvc", "Заказать том", live=True)
def pvc_rep():
    claim = pvc("data")
    spec = claim["spec"]
    if parse_quantity(spec.get("resources", {}).get("requests", {}).get("storage")) != parse_quantity("128Mi"):
        fail(f"PVC data просит {spec.get('resources', {}).get('requests', {}).get('storage')}, а нужно 128Mi.")
    if spec.get("accessModes") != ["ReadWriteOnce"]:
        fail(f"У PVC data режим доступа {spec.get('accessModes')}, а нужен ReadWriteOnce.")
    return f"PVC data: 128Mi, ReadWriteOnce, {claim.get('status', {}).get('phase', 'Pending')}"


@check("mount", "Записать данные на том", needs=["pvc"], live=True)
def mount():
    if pvc("data").get("status", {}).get("phase") != "Bound":
        fail("PVC data ещё не привязан к тому: том создаётся, когда его впервые использует под.")
    users = [p for p in get("pods", ns=NS) if running(p) and mounts_claim(p, "data", "/data")]
    if not users:
        fail("Нет запущенного пода, который монтирует PVC data в /data.")
    for p in users:
        if read_hello(p) == TEXT:
            return f"/data/hello на томе data содержит «{TEXT}»"
    fail(f"В /data/hello на томе data нет строки «{TEXT}».")


@check("persist", "Данные переживают под", needs=["mount"], live=True)
def persist():
    if get("pod", "writer", NS) is not None:
        fail("Под writer ещё есть — удалите его, чтобы проверить, что данные живут на томе, а не в поде.")
    reader = get("pod", "reader", NS)
    if reader is None or not running(reader):
        fail("Пода reader нет или он ещё не запущен.")
    if not mounts_claim(reader, "data", "/data"):
        fail("reader не монтирует PVC data в /data.")
    got = read_hello(reader)
    if got != TEXT:
        fail(f"reader видит в /data/hello «{got or 'нет файла'}», а writer записывал «{TEXT}».")
    return "reader видит данные, записанные writer"


@check("static-pv", "Статический том", needs=["persist"], live=True)
def static_pv():
    pv = get("pv", "gym-storage-pv")
    if pv is None:
        fail("PersistentVolume gym-storage-pv пока нет.")
    if pv["spec"].get("storageClassName") != "manual":
        fail(f"У gym-storage-pv storageClassName {pv['spec'].get('storageClassName') or 'не задан'}, а нужен manual.")
    claim = pvc("manual-claim")
    if claim["spec"].get("volumeName") != "gym-storage-pv" or claim.get("status", {}).get("phase") != "Bound":
        fail(f"PVC manual-claim не привязан к gym-storage-pv (сейчас: {claim.get('status', {}).get('phase')}, том {claim['spec'].get('volumeName') or 'нет'}).")
    return "manual-claim привязан к gym-storage-pv"


@check("statefulset", "Свой том у каждой реплики", needs=["static-pv"], live=True)
def statefulset():
    sts = get("statefulset", "db", NS)
    if sts is None:
        fail("StatefulSet db пока нет.")
    templates = [t["metadata"]["name"] for t in sts["spec"].get("volumeClaimTemplates") or []]
    if "data" not in templates:
        fail("У StatefulSet db нет volumeClaimTemplates с именем data.")
    want = sts["spec"].get("replicas", 1)
    if want != 2:
        fail(f"У db {want} реплик, а нужно 2.")
    if sts.get("status", {}).get("readyReplicas", 0) != 2:
        fail(f"Готово {sts.get('status', {}).get('readyReplicas', 0)} из 2 реплик db.")
    for i in range(2):
        if pvc(f"data-db-{i}").get("status", {}).get("phase") != "Bound":
            fail(f"PVC data-db-{i} не привязан к тому.")
    return "db-0 и db-1 готовы, у каждой свой PVC"
