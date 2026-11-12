"""Автопроверка: кэш каталога и очередь заданий на доставку в одном Redis с лимитом памяти.

Живые проверки читают Redis, делают пробную запись /health и запрашивают одну пробную карточку.
Нагрузка — только в полной проверке: каталог вдвое больше лимита памяти и оформление заказов по ходу;
карточки, записанные нагрузкой, проверка после себя удаляет.
"""

from __future__ import annotations

import socket

from incident_kit import STATE, check, fail, finalizer, get, log, post, RequestError

APP = "http://app:8000"
LIMIT = 32 * 1024 * 1024
SEEDED = 300
PROBE = 990001
LOAD_FROM, LOAD_PAGES, PAGE = 100001, 60, 500


class RedisError(Exception):
    pass


def _encode(args: tuple) -> bytes:
    out = [b"*%d\r\n" % len(args)]
    for arg in args:
        data = str(arg).encode()
        out.append(b"$%d\r\n%s\r\n" % (len(data), data))
    return b"".join(out)


def _reply(f):
    line = f.readline()
    if not line:
        raise RedisError("соединение закрыто")
    kind, rest = line[:1], line[1:-2]
    if kind == b"+":
        return rest.decode()
    if kind == b"-":
        return RedisError(rest.decode())
    if kind == b":":
        return int(rest)
    if kind == b"$":
        size = int(rest)
        return None if size < 0 else f.read(size + 2)[:-2].decode()
    if kind == b"*":
        size = int(rest)
        return None if size < 0 else [_reply(f) for _ in range(size)]
    raise RedisError("неизвестный ответ Redis")


def pipeline(*commands: tuple) -> list:
    try:
        with socket.create_connection(("redis", 6379), timeout=5) as sock:
            sock.settimeout(5)
            sock.sendall(b"".join(_encode(c) for c in commands))
            f = sock.makefile("rb")
            return [_reply(f) for _ in commands]
    except OSError as e:
        fail(f"Redis не отвечает ({e}).")


def cmd(*args):
    result = pipeline(args)[0]
    if isinstance(result, RedisError):
        fail(f"Redis отклонил {args[0]}: {result}")
    return result


def missing_jobs(ids: list[int]) -> list[int]:
    """Задания, которых нет в хеше job:<id> или в очереди jobs:pending."""
    queued = set(cmd("LRANGE", "jobs:pending", 0, -1) or [])
    exists = pipeline(*[("EXISTS", f"job:{i}") for i in ids])
    return [i for i, e in zip(ids, exists) if e != 1 or str(i) not in queued]


def lost_message(lost: list[int], total: int) -> str:
    shown = ", ".join(map(str, lost[:5])) + ("…" if len(lost) > 5 else "")
    return f"пропало заданий на доставку: {len(lost)} из {total} (например, {shown})"


@check("jobs", "Очередь заданий на доставку цела", live=True)
def jobs():
    lost = missing_jobs(list(range(1, SEEDED + 1)))
    if lost:
        fail(lost_message(lost, SEEDED).capitalize() + ".")
    return f"Все {SEEDED} заданий на месте."


@check("limit", "Лимит памяти Redis — 32 МБ", live=True)
def limit():
    value = int(cmd("CONFIG", "GET", "maxmemory")[1])
    if value != LIMIT:
        shown = "без ограничения" if value == 0 else f"{value / 1024 / 1024:g} МБ"
        fail(f"Лимит памяти Redis изменён: {shown} вместо 32 МБ.")
    return "maxmemory 32 МБ."


@check("checkout", "Запись в Redis проходит, заказы можно оформлять", live=True)
def checkout():
    try:
        r = get(APP + "/health", timeout=3)
    except RequestError as e:
        fail(f"Приложение не отвечает ({e}).")
    if r.status != 200:
        fail(f"/health отвечает {r.status}: {str(r.json().get('error', r.text[:200])).rstrip('.')}.")
    return "Пробная запись прошла."


@check("cache", "Карточки берутся из кэша и живут в нём от минуты до суток", live=True)
def cache():
    cmd("DEL", f"cache:product:{PROBE}")
    try:
        first = get(f"{APP}/catalog/{PROBE}", timeout=3)
        second = get(f"{APP}/catalog/{PROBE}", timeout=3)
    except RequestError as e:
        fail(f"Каталог не отвечает ({e}).")
    if first.status != 200 or second.status != 200:
        fail(f"Каталог отвечает {first.status} и {second.status}.")
    if second.headers.get("x-cache") != "hit":
        fail(f"Повторный запрос карточки не попал в кэш: {first.headers.get('x-cache', 'нет X-Cache').rstrip('.')}.")
    ttl = cmd("TTL", f"cache:product:{PROBE}")
    if ttl < 0:
        fail("Карточка лежит в кэше без срока жизни: устаревшая цена останется там навсегда.")
    if not 60 <= ttl <= 86400:
        fail(f"Карточка живёт в кэше {ttl} с, а нужно от минуты до суток.")
    return f"Повторный запрос из кэша, срок жизни карточки {ttl} с."


@check("load", "Нагрузка: каталог вдвое больше лимита, заказы оформляются, задания целы", needs=["jobs", "limit", "checkout", "cache"])
def load():
    STATE["load"] = True
    created = []
    for page in range(LOAD_PAGES):
        start = LOAD_FROM + page * PAGE
        try:
            r = get(f"{APP}/catalog?from={start}&count={PAGE}", timeout=15)
        except RequestError as e:
            fail(f"Под нагрузкой каталог перестал отвечать ({e}).")
        body = r.json()
        if r.status != 200 or body.get("errors"):
            fail(f"Под нагрузкой Redis отказал в записи кэша: {str(body.get('error', r.text[:200])).rstrip('.')}.")
        if page % 10 == 9:
            log(f"записано страниц каталога: {page + 1} из {LOAD_PAGES}")
            try:
                r = post(APP + "/checkout", {"order_id": 900000 + page}, timeout=5)
            except RequestError as e:
                fail(f"Под нагрузкой оформление заказа не ответило ({e}).")
            if r.status != 201:
                fail(f"Под нагрузкой оформление заказа не прошло: {str(r.json().get('error', r.text[:200])).rstrip('.')}.")
            created.append(int(r.json()["job"]))
    used = int(dict(line.split(":", 1) for line in cmd("INFO", "memory").splitlines() if ":" in line)["used_memory"])
    if used > LIMIT * 1.05:
        fail(f"Redis занимает {used / 1024 / 1024:.1f} МБ при лимите 32 МБ.")
    lost = missing_jobs(list(range(1, SEEDED + 1)) + created)
    if lost:
        fail("Под нагрузкой " + lost_message(lost, SEEDED + len(created)) + ".")
    return f"Записано {LOAD_PAGES * PAGE} карточек, оформлено {len(created)} заказов, все задания на месте."


@finalizer
def drop_load_cards():
    """Карточки, записанные нагрузкой, удаляются: проверка не должна сама забивать память стенда."""
    if not STATE.get("load"):
        return
    for page in range(LOAD_PAGES):
        start = LOAD_FROM + page * PAGE
        try:
            pipeline(("UNLINK", *[f"cache:product:{p}" for p in range(start, start + PAGE)]))
        except Exception:  # уборка не должна портить отчёт
            return
