"""Проверки инцидента docker-oom-healthcheck: API работает, воркер стабилен в пределах лимита памяти."""

import time

from incident_kit import RequestError, STATE, check, fail, get, log, wait_for

LIMIT = 96 * 1024 * 1024


def worker_health() -> dict | None:
    try:
        r = get("http://worker:8000/health", timeout=3)
        return r.json() if r.status == 200 else None
    except RequestError:
        return None


@check("api", "API заказов запущен и видит воркер")
def api():
    def ok():
        try:
            return get("http://api:8000/status", timeout=3).status == 200
        except RequestError:
            return False

    if not wait_for(ok, timeout=30, interval=2):
        try:
            r = get("http://api:8000/status", timeout=3)
            fail(f"API отвечает HTTP {r.status}: {r.text[:160]}")
        except RequestError as e:
            fail(f"API заказов не отвечает ({e}): контейнер api не запущен или ещё стартует.")
    return "GET /status → 200."


@check("limit", "Лимит памяти воркера не меняли (96 МБ)")
def limit():
    h = wait_for(worker_health, timeout=20, interval=1)
    if not h:
        fail("Воркер не отвечает на /health — не удалось узнать его лимит памяти.")
    STATE["first"] = h
    if h.get("memory_limit") != LIMIT:
        got = h.get("memory_limit")
        fail(f"Лимит памяти воркера {'не задан' if got is None else f'{got // 2**20} МБ'}, а платформа выделяет 96 МБ.")
    return "Лимит памяти — 96 МБ."


@check("stable", "Воркер работает стабильно: без перезапусков за 40 секунд", needs=["limit"])
def stable():
    first = STATE["first"]
    log("наблюдаем за воркером 40 секунд")
    time.sleep(40)
    last = worker_health()
    if not last:
        fail("Воркер перестал отвечать во время наблюдения.")
    if last["starts"] != first["starts"]:
        fail(f"Воркер перезапускался во время проверки: запусков было {first['starts']}, стало {last['starts']}.")
    return f"За 40 с перезапусков не было, uptime {last['uptime']:.0f} с, всего запусков с начала инцидента: {last['starts']}."
