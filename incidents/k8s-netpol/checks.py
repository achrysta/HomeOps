"""Автопроверка инцидента k8s-netpol: поиск RAG (rag) ходит к сервису эмбеддингов (embeddings) под политиками default deny.

Сетевые политики действуют на трафик подов, поэтому запросы делаются изнутри подов стенда (kubectl exec).
"""

import json

from incident_kit import check, fail
from k8s_kit import get, pod_probe, probe_text, running_pod, wait_deployment

EMBEDDER = "embedder.embeddings.svc.cluster.local"
SEARCH = ("rag", "app=search-api")
RESTORE = "Объекты платформенной команды должны оставаться на месте: без них проверить изоляцию нельзя."


def pod_ip(ns: str, selector: str, who: str) -> str:
    pod = running_pod(ns, selector)
    ip = pod and pod.get("status", {}).get("podIP")
    if not ip:
        fail(f"Нет запущенного пода {who} в namespace {ns} — без него проверить доступ нельзя. {RESTORE}")
    return ip


@check("dns", "search-api разрешает имена сервисов", live=True)
def dns():
    ok, msg = wait_deployment("rag", "search-api", timeout=40)
    if not ok:
        fail(msg)
    r = pod_probe(*SEARCH, "dns", EMBEDDER)
    if r["result"] != "ok":
        fail(f"Из пода search-api имя {EMBEDDER} не разрешается ({r.get('error') or probe_text(r)}) — поиск не находит embedder по имени.")
    return f"{EMBEDDER} → {', '.join(r['addrs'])}"


@check("search", "Поиск получает эмбеддинги от embedder", needs=["dns"], live=True)
def search():
    ok, msg = wait_deployment("embeddings", "embedder", timeout=40)
    if not ok:
        fail(msg)
    r = pod_probe(*SEARCH, "http", "http://127.0.0.1:8080/search?q=refund+policy", timeout=8)
    if r["result"] == "ok":
        data = json.loads(r["body"])
        return f"/search → эмбеддинг {data['model']}, размерность {data['dim']}"
    if r["result"] == "http":
        try:
            data = json.loads(r.get("body", ""))
        except json.JSONDecodeError:
            data = {}
        what = {"dns": "не разрешил имя embedder", "connect": "не смог подключиться к embedder", "http": "получил ошибку от embedder"}.get(data.get("stage"), "не получил эмбеддинг")
        fail(f"search-api {what} ({data.get('embedder', EMBEDDER)}): {data.get('error') or r.get('body', '')[:200]}")
    fail(f"search-api не ответил на /search: {probe_text(r)}")


@check("embedder-closed", "embedder принимает запросы только от search-api", needs=["search"])
def embedder_closed():
    target = f"{pod_ip('embeddings', 'app=embedder', 'embedder')}:8080"
    leaks = []
    for ns, selector, who in (("rag", "app=notebook", "ноутбук rag/notebook"), ("sandbox", "app=experiments", "песочница sandbox/experiments")):
        r = pod_probe(ns, selector, "tcp", target)
        if r["result"] == "nopod":
            fail(f"{r['error']} — он нужен, чтобы проверить изоляцию embedder. {RESTORE}")
        if r["result"] == "open":
            leaks.append(who)
    if leaks:
        fail(f"К поду embedder ({target}) подключаются посторонние: {', '.join(leaks)}. Доступ к сервису эмбеддингов должен быть только у search-api.")
    return f"из rag/notebook и sandbox/experiments под embedder ({target}) недоступен"


@check("egress-closed", "search-api ходит только к embedder и DNS", needs=["search"])
def egress_closed():
    target = f"{pod_ip('sandbox', 'app=experiments', 'experiments')}:8080"
    r = pod_probe(*SEARCH, "tcp", target)
    if r["result"] == "open":
        fail(f"search-api подключается к песочнице sandbox/experiments ({target}): исходящий трафик поиска открыт шире, чем нужно — по условию только к embedder и DNS.")
    return f"песочница sandbox/experiments ({target}) из search-api недоступна"


@check("default-deny", "Политики default deny платформенной команды на месте", live=True)
def default_deny():
    for ns in ("rag", "embeddings"):
        p = get("networkpolicy", "default-deny", ns)
        if p is None:
            fail(f"В namespace {ns} нет политики default-deny. Её выставляет платформенная команда — удалять нельзя. {RESTORE}")
        spec = p["spec"]
        if spec.get("podSelector") or sorted(spec.get("policyTypes", [])) != ["Egress", "Ingress"] or spec.get("ingress") or spec.get("egress"):
            fail(f"Политику default-deny в namespace {ns} меняли. Её выставляет платформенная команда — нужный трафик разрешают отдельными политиками. {RESTORE}")
    return "default-deny в rag и embeddings не тронуты: всё, что не разрешено явно, запрещено"
