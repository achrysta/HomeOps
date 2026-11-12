"""Автопроверка инцидента k8s-storm (финал блока Kubernetes): витрина показывает заказы из API.

Поломки идут цепочкой, поэтому проверки связаны: квота → поды API → их стабильность → Service → сеть витрины.
Ограничения условия: квоту платформы не поднимают, default deny не убирают и всё подряд не открывают,
пробы API на месте.
"""

import json

import incident_kit as kit
from incident_kit import check, fail
from k8s_kit import deployment_status, get, pod_probe, pods, probe_text, ready_endpoints, require, watch_ready

NS = "bazaar"
QUOTA = {"limits.memory": "448Mi", "requests.memory": "256Mi"}


@check("platform", "Правила платформы на месте: квота и default deny", live=True)
def platform():
    quota = get("resourcequota", "bazaar-quota", NS)
    if quota is None or quota["spec"].get("hard") != QUOTA:
        fail(f"Квота bazaar-quota изменена или удалена: {(quota or {}).get('spec', {}).get('hard')}. Квоту выдаёт платформа — в неё нужно уложиться.")
    deny = get("networkpolicy", "default-deny-ingress", NS)
    if deny is None or deny["spec"].get("podSelector") != {} or deny["spec"].get("ingress"):
        fail("NetworkPolicy default-deny-ingress изменена или удалена: входящий трафик в namespace закрыт по умолчанию, открывают только нужное.")
    for np in get("networkpolicy", ns=NS) or []:
        for rule in np["spec"].get("ingress") or []:
            if not rule.get("from"):
                fail(f"NetworkPolicy {np['metadata']['name']} пускает входящий трафик от кого угодно: открывают только витрину к API.")
    return "Квота bazaar-quota и default deny на месте, лишнего не открыто."


@check("api", "Поды API заказов запущены", live=True)
def api():
    ok, text = deployment_status(NS, "api")
    if ok:
        return "api: 2 из 2 подов готовы."
    dep = require("deployment", "api", NS)
    selector = ",".join(f"{k}={v}" for k, v in dep["spec"]["selector"]["matchLabels"].items())
    current = [p for p in pods(NS, selector) if not p["metadata"].get("deletionTimestamp")]
    if not current:
        # Подов нет вовсе — почему их не создаёт самый новый ReplicaSet (условие у Deployment бывает устаревшим)
        sets = [rs for rs in get("replicaset", ns=NS, selector=selector) or [] if any(o.get("uid") == dep["metadata"]["uid"] for o in rs["metadata"].get("ownerReferences", []))]
        newest = max(sets, key=lambda rs: int(rs["metadata"].get("annotations", {}).get("deployment.kubernetes.io/revision", 0)), default=None)
        for c in (newest or {}).get("status", {}).get("conditions", []):
            if c.get("type") == "ReplicaFailure" and c.get("status") == "True":
                fail(f"api не создаёт поды: {c.get('message', c.get('reason'))}")
    # Причины по актуальным подам: условие Deployment о квоте бывает устаревшим после исправления
    problems = []
    for p in current:
        for cs in p.get("status", {}).get("containerStatuses", []):
            waiting = cs.get("state", {}).get("waiting") or {}
            if waiting.get("reason"):
                problems.append(f"{p['metadata']['name']}: {waiting['reason']}" + (f" — {waiting['message']}" if waiting.get("message") else ""))
    fail(f"api не готов: {'; '.join(problems[:2]) if problems else text}")


@check("stable", "API работает стабильно, пробы на месте", needs=["api"], live=True)
def stable():
    dep = require("deployment", "api", NS)
    c = next((c for c in dep["spec"]["template"]["spec"]["containers"] if c["name"] == "api"), {})
    if not c.get("livenessProbe") or not c.get("readinessProbe"):
        fail("У API убрана liveness- или readiness-проба: без них Kubernetes не узнает о зависшем или неготовом поде.")
    selector = ",".join(f"{k}={v}" for k, v in dep["spec"]["selector"]["matchLabels"].items())
    if kit.LIVE:
        restarting = [p["metadata"]["name"] for p in pods(NS, selector) if any(s.get("restartCount", 0) and s.get("state", {}).get("waiting") for s in p.get("status", {}).get("containerStatuses", []))]
        if restarting:
            fail(f"Поды API перезапускаются: {', '.join(restarting)}.")
        return "Пробы на месте, поды API сейчас не перезапускаются."
    problem = watch_ready(NS, selector, 25)
    if problem:
        fail(f"API нестабилен: {problem}")
    return "Пробы на месте, поды API готовы всё окно проверки (25 с)."


@check("service", "Service api ведёт на поды API", needs=["api"], live=True)
def service():
    if not ready_endpoints(NS, "api"):
        svc = require("service", "api", NS)
        fail(f"У Service api нет готовых адресов: селектор {svc['spec'].get('selector')} не находит готовых подов.")
    return f"Service api → {', '.join(ready_endpoints(NS, 'api'))}."


@check("orders", "Витрина показывает заказы из API", needs=["stable", "service", "platform"], live=True)
def orders():
    ok, text = deployment_status(NS, "web")
    if not ok:
        fail(f"Витрина не готова: {text}")
    r = pod_probe(NS, "app=web", "http", "http://localhost:8080/api/orders", timeout=6)
    if r["result"] != "ok":
        fail(f"Витрина отвечает на /api/orders: {probe_text(r)}")
    try:
        body = json.loads(r.get("body", ""))
    except ValueError:
        fail("Витрина вернула на /api/orders не JSON.")
    if body.get("db") != "orders-db.bazaar.svc" or not body.get("orders"):
        fail(f"API отвечает не с той базой: {body.get('db')!r}.")
    return f"Витрина показывает {len(body['orders'])} заказа из API (база {body['db']})."
