"""Автопроверка инцидента k8s-statefulset: реплики хранилища kv находят лидера по стабильному имени kv-0.kv.

Ограничения условия: данные лидера, записанные до поломки, на месте (контрольная сумма из ConfigMap kv-seed —
тома не пересоздавали), адрес лидера в приложении и readiness-проба не изменены.
"""

import json

from incident_kit import check, fail
from k8s_kit import KubectlError, get, kubectl, pod_probe, probe_text, require

NS = "ledger"
LEADER_FQDN = f"kv-0.kv.{NS}.svc.cluster.local"
LEADER_URL = "http://kv-0.kv:8080"
STATS = "import urllib.request; print(urllib.request.urlopen('http://localhost:8080/stats', timeout=3).read().decode())"


def pod_stats(name: str) -> dict:
    try:
        return json.loads(kubectl("exec", "-n", NS, name, "-c", "kv", "--", "python", "-c", STATS, timeout=20).strip().splitlines()[-1])
    except (KubectlError, json.JSONDecodeError, IndexError) as e:
        fail(f"Под {name} не отвечает на /stats: {e}")


def labels_match(selector: dict, labels: dict) -> bool:
    return bool(selector) and all(labels.get(k) == v for k, v in selector.items())


@check("headless", "Service kv — headless и выбирает поды StatefulSet", live=True)
def headless():
    svc = require("service", "kv", NS)
    sts = require("statefulset", "kv", NS)
    if svc["spec"].get("clusterIP") != "None":
        fail(f"У Service kv адрес {svc['spec'].get('clusterIP')}: это обычный Service с виртуальным IP — DNS-имён отдельных подов (kv-0.kv) у него нет.")
    pod_labels = sts["spec"]["template"]["metadata"].get("labels", {})
    selector = svc["spec"].get("selector") or {}
    if not labels_match(selector, pod_labels):
        fail(f"Селектор Service kv {selector} не совпадает с метками подов StatefulSet {pod_labels}: в Service нет ни одного пода.")
    return "Service kv без виртуального IP, селектор совпадает с метками подов."


@check("dns", f"Имя лидера {LEADER_FQDN} разрешается в адрес пода kv-0", live=True)
def dns():
    leader = get("pod", "kv-0", NS)
    if not leader or not leader.get("status", {}).get("podIP"):
        fail("Пода kv-0 нет или у него ещё нет адреса.")
    # Спрашиваем из реплики: у самого kv-0 его полное имя прописано в /etc/hosts, DNS там не участвует
    r = pod_probe(NS, "app=kv,statefulset.kubernetes.io/pod-name!=kv-0", "dns", LEADER_FQDN)
    if r["result"] != "ok":
        fail(f"Из реплики хранилища имя {LEADER_FQDN}: {probe_text(r)}.")
    if leader["status"]["podIP"] not in r.get("addrs", []):
        fail(f"{LEADER_FQDN} разрешается в {', '.join(r.get('addrs', []))}, а под kv-0 — {leader['status']['podIP']}.")
    return f"{LEADER_FQDN} → {leader['status']['podIP']} (под kv-0)."


@check("replicas", "Все три реплики StatefulSet готовы", live=True)
def replicas():
    sts = require("statefulset", "kv", NS)
    ready = sts.get("status", {}).get("readyReplicas", 0)
    want = sts["spec"].get("replicas", 0)
    if want != 3:
        fail(f"У StatefulSet kv {want} реплик вместо трёх: лидер и две реплики нужны для отказоустойчивости.")
    if ready != 3:
        created = len([p for p in (get("pod", ns=NS, selector="app=kv") or []) if not p["metadata"].get("deletionTimestamp")])
        fail(f"Готово реплик: {ready} из 3, подов создано: {created}.")
    return "kv-0, kv-1, kv-2 готовы."


@check("sync", "Реплики хранят те же данные, что и лидер", needs=["replicas"])
def sync():
    leader = pod_stats("kv-0")
    behind = [f"{s['name']}: {s['keys']} ключей" for s in (pod_stats(f"kv-{i}") for i in (1, 2)) if s["sha"] != leader["sha"]]
    if behind:
        fail(f"У лидера {leader['keys']} ключей, а реплики отстают — {'; '.join(behind)}.")
    return f"Данные kv-1 и kv-2 совпадают с лидером ({leader['keys']} ключей)."


@check("data", "Данные, записанные до поломки, на месте")
def data():
    seed = require("configmap", "kv-seed", NS).get("data", {})
    leader = pod_stats("kv-0")
    if leader["sha"] != seed.get("sha256"):
        fail(f"У лидера {leader['keys']} ключей, и они не совпадают с данными до поломки ({seed.get('keys')} счетов): тома с данными пересоздавали.")
    return f"{leader['keys']} счетов лидера — те же, что до поломки."


@check("config", "Адрес лидера в приложении и readiness-проба не изменены", live=True)
def config():
    sts = require("statefulset", "kv", NS)
    containers = sts["spec"]["template"]["spec"].get("containers", [])
    kv = next((c for c in containers if c.get("name") == "kv"), {})
    env = {e.get("name"): e.get("value") for e in kv.get("env", [])}
    if env.get("LEADER_URL") != LEADER_URL:
        fail(f"LEADER_URL в StatefulSet — {env.get('LEADER_URL')!r} вместо {LEADER_URL}: реплики должны находить лидера по стабильному имени, чинить нужно сеть, а не приложение.")
    probe = (kv.get("readinessProbe") or {}).get("httpGet", {})
    if probe.get("path") != "/ready":
        fail("Readiness-проба реплик изменена или убрана: без неё в Service попадут реплики, которые не получили данные лидера.")
    return f"LEADER_URL={LEADER_URL}, readiness — /ready."
