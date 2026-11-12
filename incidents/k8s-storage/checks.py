"""Автопроверка инцидента k8s-storage: векторная база vectordb (StatefulSet) в namespace vectors хранит индекс на томе."""

import json
import random
import time

import incident_kit as kit
from incident_kit import check, fail
from k8s_kit import KubectlError, get, kubectl, pod_problem, proxy_error, require, service_get

NS = "vectors"
POD = "vectordb-0"
PVC = "index-vectordb-0"


def pvc_events() -> str:
    """Последнее предупреждение по PVC — так провизионер объясняет, почему том не выделен."""
    try:
        out = kubectl("get", "events", "-n", NS, "--field-selector", f"involvedObject.name={PVC},type=Warning", "-o", "json")
    except KubectlError:
        return ""
    items = sorted(json.loads(out).get("items", []), key=lambda e: e.get("lastTimestamp") or e.get("eventTime") or "")
    return items[-1].get("message", "") if items else ""


def wait_ready(timeout: float, old_uid: str | None = None) -> dict:
    """Под vectordb-0 готов (и, если задан old_uid, это уже новый под после перезапуска)."""
    # в живой проверке — одна попытка без ожидания
    deadline = time.monotonic() + (0 if kit.LIVE else timeout)
    pod = None
    while True:
        pod = get("pod", POD, NS)
        if pod and pod["metadata"]["uid"] != old_uid and not pod["metadata"].get("deletionTimestamp"):
            if any(c.get("type") == "Ready" and c.get("status") == "True" for c in pod.get("status", {}).get("conditions", []) or []):
                return pod
        if time.monotonic() >= deadline:
            break
        time.sleep(2)
    fail(f"Под {POD} не стал готов за {timeout:.0f} с: {pod_problem(pod) if pod else 'пода нет'}")
    return {}


@check("pvc", "Том индекса выделен: PVC index-vectordb-0 в состоянии Bound", live=True)
def pvc():
    sts = require("statefulset", "vectordb", NS)
    if not sts["spec"].get("volumeClaimTemplates"):
        fail("У StatefulSet vectordb нет volumeClaimTemplates — у реплик нет своих томов для индекса.")
    claim = get("pvc", PVC, NS)
    if claim is None:
        fail(f"PVC {PVC} не создан. Его создаёт StatefulSet по volumeClaimTemplates, когда запускает под {POD}.")
    phase = claim.get("status", {}).get("phase")
    if phase != "Bound":
        why = pvc_events()
        fail(f"PVC {PVC} в состоянии {phase} — тома нет, под {POD} не запускается." + (f" Последнее событие: {why[:300]}" if why else ""))
    return f"{PVC}: Bound, том {claim['spec'].get('volumeName')}"


@check("ready", "vectordb запущена и отвечает", needs=["pvc"], live=True)
def ready():
    wait_ready(60)
    r = service_get(NS, "vectordb", 80, "/healthz")
    if r.status != 200:
        fail(f"vectordb не ответила через Service vectordb:80 — {proxy_error(r)}")
    return f"/healthz: документов в индексе — {r.json().get('docs')}"


@check("persist", "Индекс переживает перезапуск пода", needs=["ready"])
def persist():
    doc = f"doc-{random.randint(10000, 99999)}"
    r = service_get(NS, "vectordb", 80, f"/put?id={doc}&text=refund+policy")
    if r.status != 200:
        fail(f"Не удалось записать документ в индекс — {proxy_error(r)}")
    old = require("pod", POD, NS)["metadata"]["uid"]
    kubectl("delete", "pod", POD, "-n", NS, "--wait=true", timeout=90)
    wait_ready(90, old_uid=old)
    r = service_get(NS, "vectordb", 80, f"/get?id={doc}")
    if r.status == 404:
        data_dir = service_get(NS, "vectordb", 80, "/healthz").json().get("data_dir", "?")
        fail(f"Документ {doc} записан, но после перезапуска пода {POD} его в индексе нет: индекс пропадает вместе с подом (vectordb хранит индекс в {data_dir}).")
    if r.status != 200:
        fail(f"После перезапуска vectordb не ответила — {proxy_error(r)}")
    return f"документ {doc} на месте после пересоздания пода {POD}"


@check("retain", "Данные индекса переживут удаление PVC", needs=["pvc"], live=True)
def retain():
    claim = require("pvc", PVC, NS)
    pv = get("pv", claim["spec"].get("volumeName"))
    policy = (pv or {}).get("spec", {}).get("persistentVolumeReclaimPolicy")
    if policy != "Retain":
        fail(f"У тома {claim['spec'].get('volumeName')} reclaimPolicy {policy}: если PVC удалят (например, вместе с namespace), том с индексом удалится тоже.")
    return f"том {pv['metadata']['name']}: reclaimPolicy Retain"
