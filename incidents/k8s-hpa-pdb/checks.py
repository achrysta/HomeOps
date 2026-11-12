"""Автопроверка инцидента k8s-hpa-pdb: search-api, HPA и PDB в namespace search, metrics-server в кластере."""

import json
import math
import time

from incident_kit import check, fail, finalizer, log, plural
from k8s_kit import KubectlError, api, get, kubectl, pod_problem, pods, require

NS = "search"
LOAD_POD = "search-load"
STATE = {"load": False}

# Нагрузка изнутри кластера: 8 потоков без пауз шлют запросы к Service search-api
LOAD_CODE = """
import threading, urllib.request
def hit():
    while True:
        try:
            urllib.request.urlopen('http://search-api/search?q=sale', timeout=5).read()
        except Exception:
            pass
for _ in range(8):
    threading.Thread(target=hit, daemon=True).start()
threading.Event().wait()
"""


def _age(pod: dict) -> float:
    from datetime import datetime, timezone

    started = pod["metadata"]["creationTimestamp"].replace("Z", "+00:00")
    return (datetime.now(timezone.utc) - datetime.fromisoformat(started)).total_seconds()


def hpa_condition(hpa: dict, kind: str) -> dict:
    return next((c for c in hpa.get("status", {}).get("conditions", []) or [] if c.get("type") == kind), {})


def cpu_utilization(hpa: dict) -> int | None:
    for m in hpa.get("status", {}).get("currentMetrics", []) or []:
        value = m.get("resource", {}).get("current", {}).get("averageUtilization")
        if m.get("resource", {}).get("name") == "cpu" and value is not None:
            return value
    return None


@check("metrics", "Metrics API работает: kubectl top видит поды поиска")
def metrics():
    svc = get("apiservice", "v1beta1.metrics.k8s.io")
    if svc is None:
        fail("Metrics API в кластере нет: kubectl top отвечает «Metrics API not available», и HPA нечем считать загрузку CPU.")
    # Сразу после установки метрики появляются через 15–30 с; если metrics-server работает дольше минуты — ждать нечего
    server_pods = pods("kube-system", "app.kubernetes.io/name=metrics-server") or pods("kube-system", "k8s-app=metrics-server")
    settled = server_pods and all(_age(p) > 60 for p in server_pods)
    deadline = time.monotonic() + (5 if settled else 45)
    while True:
        r = api.request("GET", f"/apis/metrics.k8s.io/v1beta1/namespaces/{NS}/pods")
        items = r.json().get("items", []) if r.status == 200 else []
        if any(i["metadata"]["name"].startswith("search-api") for i in items):
            return f"метрики есть для {plural(len(items), 'пода', 'подов', 'подов')} в namespace {NS}"
        if time.monotonic() > deadline:
            break
        time.sleep(3)
    available = next((c for c in svc.get("status", {}).get("conditions", []) if c.get("type") == "Available"), {})
    if available.get("status") != "True":
        unready = [p["metadata"]["name"] for p in server_pods if pod_problem(p) != "Running"]
        hint = f" Под {unready[0]} не готов — что он пишет в логах?" if unready else ""
        fail(f"Metrics API зарегистрирован, но недоступен: {available.get('reason', '?')} — {available.get('message', '')[:300]}.{hint}")
    fail("Metrics API отвечает, но метрик подов search-api нет. Посмотрите логи metrics-server: получает ли он данные от kubelet на узлах?")


@check("hpa", "HPA видит загрузку CPU", needs=["metrics"])
def hpa():
    deadline = time.monotonic() + 60
    while True:
        h = require("hpa", "search-api", NS)
        active = hpa_condition(h, "ScalingActive")
        util = cpu_utilization(h)
        # Условие HPA обновляется позже rollout: оно ещё может ссылаться на старый под.
        # Быстрый отказ допустим только если CPU request отсутствует у текущих подов.
        current = [p for p in pods(NS, "app=search-api") if not p.get("metadata", {}).get("deletionTimestamp")]
        missing = any(not c.get("resources", {}).get("requests", {}).get("cpu")
                      for p in current for c in p.get("spec", {}).get("containers", []))
        if missing:
            fail("В текущих подах search-api у контейнера нет requests.cpu — HPA не может вычислить процент загрузки.")
        if active.get("status") == "True" and util is not None and current:
            return f"загрузка CPU {util}% при цели {h['spec']['metrics'][0]['resource']['target'].get('averageUtilization')}%"
        if time.monotonic() > deadline:
            fail(f"HPA не может посчитать загрузку: {active.get('reason', '?')} — {active.get('message', 'нет данных')[:300]}")
        time.sleep(5)


def scaled(value: int | str, total: int) -> int:
    """minAvailable / maxUnavailable в подах: проценты округляются вверх, как в disruption controller."""
    if isinstance(value, str) and value.endswith("%"):
        return math.ceil(int(value[:-1]) * total / 100)
    return int(value)


@check("pdb", "Бюджет нарушений разрешает вытеснять поды по одному", live=True)
def pdb():
    d = require("deployment", "search-api", NS)
    labels = d["spec"]["template"]["metadata"].get("labels", {})
    covering = [p for p in get("pdb", ns=NS) if all(labels.get(k) == v for k, v in p["spec"].get("selector", {}).get("matchLabels", {}).items())]
    if not covering:
        fail("Ни один PodDisruptionBudget не защищает поды search-api: при обслуживании узлов можно потерять все реплики разом. Бюджет нужен — но такой, чтобы drain проходил.")
    p = covering[0]
    h = get("hpa", "search-api", NS)
    least = (h or {}).get("spec", {}).get("minReplicas", d["spec"].get("replicas", 1))
    spec = p["spec"]
    if "maxUnavailable" in spec:
        allowed, rule = scaled(spec["maxUnavailable"], least), f"maxUnavailable: {spec['maxUnavailable']}"
    else:
        allowed, rule = least - scaled(spec.get("minAvailable", 0), least), f"minAvailable: {spec.get('minAvailable')}"
    if allowed < 1:
        fail(f"При {plural(least, 'реплике', 'репликах', 'репликах')} (минимум HPA) бюджет {p['metadata']['name']} с {rule} не разрешает вытеснить ни одного пода — kubectl drain узла зависнет на этих подах.")
    if allowed >= least:
        fail(f"Бюджет {p['metadata']['name']} с {rule} разрешает вытеснить все {plural(least, 'под', 'пода', 'подов')} сразу — он ничего не защищает.")
    # Живое подтверждение: пробное вытеснение (dryRun) одного пода через Eviction API, как делает drain
    victims = pods(NS, "app=search-api")
    if victims:
        name = victims[0]["metadata"]["name"]
        body = {"apiVersion": "policy/v1", "kind": "Eviction", "metadata": {"name": name, "namespace": NS}, "deleteOptions": {"dryRun": ["All"]}}
        r = api.request("POST", f"/api/v1/namespaces/{NS}/pods/{name}/eviction?dryRun=All", body)
        if r.status == 429:
            fail(f"Пробное вытеснение пода {name} отклонено: {json.loads(r.text).get('message', r.text)[:240]}")
    return f"при {plural(least, 'реплике', 'репликах', 'репликах')} бюджет ({rule}) разрешает вытеснить {plural(allowed, 'под', 'пода', 'подов')}; пробное вытеснение прошло"


@check("scale", "Под нагрузкой HPA добавляет реплики", needs=["hpa"])
def scale():
    h = require("hpa", "search-api", NS)
    least = h["spec"].get("minReplicas", 1)
    target = h["spec"]["metrics"][0]["resource"]["target"].get("averageUtilization", 0)
    before = h.get("status", {}).get("desiredReplicas", 0)
    kubectl("-n", NS, "delete", "pod", LOAD_POD, "--ignore-not-found", "--grace-period=1", "--wait=true")
    kubectl("-n", NS, "run", LOAD_POD, "--image=python:3.12-alpine", "--restart=Never", "--labels=app=search-load", "--", "python", "-c", LOAD_CODE)
    STATE["load"] = True
    log("даю нагрузку на search-api изнутри кластера и жду, пока HPA увидит её и добавит реплики (до 3 минут)")
    deadline = time.monotonic() + 180
    last_log = time.monotonic()
    util, desired = None, before
    while time.monotonic() < deadline:
        h = require("hpa", "search-api", NS)
        desired = h.get("status", {}).get("desiredReplicas", 0)
        util = cpu_utilization(h)
        # засчитываем, только когда HPA увидел именно эту нагрузку: загрузка выше цели и реплик больше минимума
        if util is not None and util > target and desired > least:
            return f"под нагрузкой загрузка CPU {util}% при цели {target}% — HPA держит {plural(desired, 'реплику', 'реплики', 'реплик')} (было {before}). Без нагрузки вернёт {least} примерно через 5 минут (окно стабилизации)."
        if time.monotonic() - last_log > 30:
            log(f"загрузка CPU {util if util is not None else '?'}%, желаемых реплик {desired}")
            last_log = time.monotonic()
        time.sleep(5)
    fail(f"За 3 минуты под нагрузкой HPA не добавил реплик: загрузка CPU {util}% при цели {target}%, желаемых реплик {desired}. Проверьте цель HPA и requests контейнера.")


@finalizer
def stop_load():
    if STATE["load"]:
        try:
            kubectl("-n", NS, "delete", "pod", LOAD_POD, "--ignore-not-found", "--grace-period=1", "--wait=false")
        except KubectlError:
            pass
