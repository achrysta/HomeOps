"""Автопроверка инцидента k8s-probes: model-server в namespace inference."""

import time

from incident_kit import check, fail, finalizer, log, plural
from k8s_kit import Traffic, container, deployment_status, kubectl, require, wait_deployment, watch_ready

NS = "inference"
STATE = {"restarted": False}


@check("stable", "Поды model-server работают и не перезапускаются")
def stable():
    c = container(require("deployment", "model-server", NS), "server")
    if not c.get("livenessProbe"):
        fail("livenessProbe убрана. Зависший процесс (deadlock, утечка) тогда никто не перезапустит — проба нужна, но должна проверять правильную вещь.")
    ok, msg = wait_deployment(NS, "model-server", timeout=60)
    if not ok:
        fail(msg)
    log("наблюдаю за подами 25 секунд")
    problem = watch_ready(NS, "app=model-server", 25)
    if problem:
        fail(f"Поды не держатся: {problem}")
    return f"{msg}, 25 секунд все поды готовы и без перезапусков"


@check("rollout", "Во время выкатки клиенты не получают ошибок", needs=["stable"])
def rollout():
    log("перезапускаю model-server (kubectl rollout restart) и шлю запросы /predict во время выкатки")
    with Traffic(NS, "model-server", 80, "/predict") as t:
        kubectl("-n", NS, "rollout", "restart", "deployment/model-server")
        STATE["restarted"] = True
        time.sleep(2)
        ok, msg = wait_deployment(NS, "model-server", timeout=120)
        time.sleep(2)
    if not ok:
        fail(f"Выкатка не завершилась за 2 минуты: {msg}")
    if t.failed:
        fail(f"Во время выкатки {t.summary()}, например: {t.examples[0]}. Клиенты не должны видеть ошибок, пока поды перезапускаются.")
    if t.total < 20:
        fail(f"Удалось отправить только {t.total} запросов — проверка не показательна, запустите ещё раз")
    return f"выкатка прошла, {plural(t.total, 'запрос', 'запроса', 'запросов')} без ошибок"


@finalizer
def settle():
    # Если проверка запустила выкатку и упала посреди неё — дождаться конца, чтобы стенд остался рабочим
    if STATE["restarted"] and not deployment_status(NS, "model-server")[0]:
        wait_deployment(NS, "model-server", timeout=60)
