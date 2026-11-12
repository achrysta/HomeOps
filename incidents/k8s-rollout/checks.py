"""Автопроверка инцидента k8s-rollout: checkout в namespace checkout."""

import time

from incident_kit import check, fail, finalizer, log, plural
from k8s_kit import Traffic, container, get, kubectl, proxy_error, require, service_get, wait_deployment

NS = "checkout"
BROKEN_IMAGE = "python:3.12-alpine3.99"
STATE: dict = {}


@check("serving", "checkout отвечает: все 3 реплики на рабочем образе", live=True)
def serving():
    ok, msg = wait_deployment(NS, "checkout", timeout=40)
    if not ok:
        fail(msg)
    r = service_get(NS, "checkout", 80, "/")
    if r.status != 200:
        fail(f"Запрос к Service checkout не прошёл — {proxy_error(r)}")
    return f"{msg}, отвечает версия {r.json().get('version')}"


@check("safe-rollout", "Неудачная выкатка больше не кладёт сервис", needs=["serving"])
def safe_rollout():
    d = require("deployment", "checkout", NS)
    c = container(d)
    replicas = d["spec"].get("replicas", 1)
    STATE.update(name=c["name"], image=c["image"])
    log(f"тестовая выкатка: образ {BROKEN_IMAGE}, которого нет в реестре; 25 секунд слежу за сервисом")
    lowest = replicas
    with Traffic(NS, "checkout", 80, "/") as t:
        kubectl("-n", NS, "set", "image", "deployment/checkout", f"{c['name']}={BROKEN_IMAGE}")
        STATE["broken"] = True
        deadline = time.monotonic() + 25
        while time.monotonic() < deadline:
            st = (get("deployment", "checkout", NS) or {}).get("status", {})
            lowest = min(lowest, st.get("availableReplicas", 0))
            time.sleep(1)
    if t.failed or lowest < replicas - 1:
        fail(f"Во время тестовой выкатки доступных реплик стало {lowest} из {replicas}, {t.summary()}. Неудачный релиз должен застревать, не трогая работающие поды.")
    return f"тестовая выкатка застряла, а сервис работал: минимум {lowest} из {replicas} реплик доступно, {plural(t.total, 'запрос', 'запроса', 'запросов')} без ошибок"


@finalizer
def restore():
    # Вернуть рабочий образ после тестовой выкатки (тот же шаблон пода — тот же ReplicaSet)
    if not STATE.get("broken"):
        return
    kubectl("-n", NS, "set", "image", "deployment/checkout", f"{STATE['name']}={STATE['image']}")
    ok, _ = wait_deployment(NS, "checkout", timeout=60)
    log("тестовая выкатка отменена, рабочий образ возвращён" if ok else "тестовая выкатка отменена, поды ещё поднимаются")
