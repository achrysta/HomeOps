"""Проверки инцидента docker-network-dns. Проверка работает из сети frontend, как внешний клиент."""

import socket

from incident_kit import RequestError, check, fail, get, wait_for


@check("deps", "API корзины подключается к Redis")
def deps():
    def ok():
        try:
            return get("http://api:8000/health/deps", timeout=4).status == 200
        except RequestError:
            return False

    if not wait_for(ok, timeout=15, interval=1):
        try:
            r = get("http://api:8000/health/deps", timeout=4)
            fail(f"API отвечает HTTP {r.status}: {r.text[:200]}")
        except RequestError as e:
            fail(f"API корзины не отвечает из сети frontend: {e}.")
    return "GET /health/deps → 200, Redis отвечает PONG."


@check("isolation", "Redis остаётся во внутренней сети: из frontend он недоступен")
def isolation():
    try:
        addr = socket.gethostbyname("redis")
    except OSError:
        return "Имя redis из сети frontend не резолвится — хранилище изолировано."
    try:
        with socket.create_connection((addr, 6379), timeout=2):
            pass
    except OSError:
        return "Из сети frontend Redis недоступен."
    fail("Redis доступен из публичной сети frontend. Хранилище корзин должно быть только во внутренней сети backend.")
