"""Автопроверка: переключение мастера Redis через Sentinel и работа приложения заказов после него.

Живые проверки читают состояние узлов и /health приложения (пробная запись с TTL).
Учения — только в полной проверке: два SENTINEL FAILOVER подряд, мастер возвращается на исходный узел.
"""

from __future__ import annotations

import socket
import time

import incident_kit as kit
from incident_kit import STATE, check, fail, finalizer, get, log, post, RequestError

MASTER = "orders"
SENTINELS = ["sentinel-1", "sentinel-2", "sentinel-3"]
ANALYTICS = "redis-3"
APP = "http://app:8000"
SEED = {
    "1001": {"customer": "ООО Ромашка", "total": "4800"},
    "1002": {"customer": "ИП Соколов", "total": "1200"},
    "1003": {"customer": "ООО Вектор", "total": "7500"},
}


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
        raise RedisError(rest.decode())
    if kind == b":":
        return int(rest)
    if kind == b"$":
        size = int(rest)
        return None if size < 0 else f.read(size + 2)[:-2].decode()
    if kind == b"*":
        size = int(rest)
        return None if size < 0 else [_reply(f) for _ in range(size)]
    raise RedisError("неизвестный ответ Redis")


def cmd(host: str, *args, port: int = 6379):
    """Одна команда Redis; недоступный узел — провал проверки, ответ -ERR — RedisError."""
    try:
        with socket.create_connection((host, port), timeout=2) as sock:
            sock.settimeout(2)
            sock.sendall(_encode(args))
            return _reply(sock.makefile("rb"))
    except OSError as e:
        fail(f"{host}:{port} не отвечает ({e}).")


def role(host: str) -> str:
    return cmd(host, "ROLE")[0]


def info(host: str, section: str) -> dict[str, str]:
    lines = cmd(host, "INFO", section).splitlines()
    return dict(line.split(":", 1) for line in lines if ":" in line)


def sentinel_master() -> str:
    """Мастер, о котором договорились все три Sentinel."""
    views = {}
    for s in SENTINELS:
        addr = cmd(s, "SENTINEL", "get-master-addr-by-name", MASTER, port=26379)
        if not addr:
            fail(f"{s} не знает мастер «{MASTER}».")
        views[s] = addr[0]
    if len(set(views.values())) > 1:
        fail("Sentinel расходятся во мнении о мастере: " + ", ".join(f"{s} → {m}" for s, m in views.items()) + ".")
    return views[SENTINELS[0]]


def order(host: str, oid: str) -> dict[str, str]:
    fields = cmd(host, "HGETALL", f"order:{oid}") or []
    return dict(zip(fields[::2], fields[1::2]))


def app_writes_to(master: str) -> str:
    """Пустая строка, если /health записал в текущий мастер, иначе — что видно со стороны приложения."""
    try:
        r = get(APP + "/health", timeout=3)
    except RequestError as e:
        return f"приложение не отвечает ({e})"
    body = r.json() if r.body else {}
    if r.status != 200:
        return f"/health отвечает {r.status}: {str(body.get('error', r.text[:200])).rstrip('.')}"
    host = str(body.get("master", "")).split(":")[0]
    if host != master:
        return f"приложение пишет в {host}, а Sentinel считают мастером {master}"
    return ""


@check("cluster", "Sentinel согласны в выборе мастера, исходные заказы на месте", live=True)
def cluster():
    master = sentinel_master()
    actual = role(master)
    if actual != "master":
        fail(f"Sentinel считают мастером {master}, но узел отвечает как {actual}.")
    for oid, fields in SEED.items():
        if order(master, oid) != fields:
            fail(f"На мастере {master} нет исходного заказа {oid} или он изменился.")
    return f"Мастер {master}, исходные заказы 1001–1003 на месте."


@check("analytics", "redis-3 остаётся репликой, непригодной для повышения", live=True)
def analytics():
    actual = role(ANALYTICS)
    if actual != "slave":
        fail(f"redis-3 из резервного ЦОД работает как {actual}, а должна оставаться репликой.")
    priority = cmd(ANALYTICS, "CONFIG", "GET", "replica-priority")[1]
    if priority != "0":
        fail(f"redis-3 из резервного ЦОД стала кандидатом на повышение (replica-priority {priority}).")
    return "redis-3 — реплика, Sentinel её не повысит."


@check("candidate", "У мастера есть реплика, пригодная для повышения", needs=["cluster"], live=True)
def candidate():
    master = sentinel_master()
    replicas = [v.split(",")[0].removeprefix("ip=") for k, v in info(master, "replication").items() if k.startswith("slave") and "state=online" in v]
    ready = []
    for host in replicas:
        if host == ANALYTICS:
            continue
        priority = int(cmd(host, "CONFIG", "GET", "replica-priority")[1])
        if priority > 0 and info(host, "replication").get("master_link_status") == "up":
            ready.append(host)
    if not ready:
        fail(f"У мастера {master} нет реплики основного ЦОД, которую Sentinel мог бы повысить: учения заканчиваются отказом.")
    return "Кандидат на повышение: " + ", ".join(ready) + "."


@check("app", "Приложение заказов пишет в текущий мастер", needs=["cluster"], live=True)
def app():
    master = sentinel_master()
    problem = app_writes_to(master)
    if problem:
        fail(problem[0].upper() + problem[1:] + ".")
    return f"/health записывает в {master}."


def failover(current: str) -> str:
    """SENTINEL FAILOVER и ожидание, пока новый мастер признан всеми, а бывший стал репликой."""
    deadline = time.monotonic() + 40
    while True:
        try:
            cmd(SENTINELS[0], "SENTINEL", "FAILOVER", MASTER, port=26379)
            break
        except RedisError as e:
            # Sentinel узнаёт о готовности реплик из INFO раз в 10 с, бывший мастер включается в список не сразу
            if ("NOGOODSLAVE" in str(e) or "INPROG" in str(e)) and time.monotonic() < deadline:
                time.sleep(1)
                continue
            fail(f"Sentinel не переключил мастер {current}: {e}.")
    STATE["moved"] = True

    def agreed():
        master = sentinel_master()
        return master if master != current and role(master) == "master" else None

    new = kit.wait_for(agreed, timeout=20, interval=0.5)
    if not new:
        fail(f"За 20 секунд Sentinel не договорились о новом мастере вместо {current}.")
    def demoted():
        return role(current) == "slave" and info(current, "replication").get("master_link_status") == "up"

    if not kit.wait_for(demoted, timeout=40, interval=0.5, progress=f"{current} становится репликой"):
        fail(f"{current} через 40 секунд после переключения так и не стал работающей репликой {new}.")
    return new


@check("drill", "Учения: два переключения подряд, приложение работает после каждого", needs=["cluster", "analytics", "candidate", "app"])
def drill():
    start = sentinel_master()
    STATE["start"] = start
    path = [start]
    for step in (1, 2):
        log(f"переключение {step}: мастер {path[-1]}")
        new = failover(path[-1])
        if new == ANALYTICS:
            fail("Sentinel повысил redis-3 — реплику для отчётов в резервном ЦОД.")
        if not kit.wait_for(lambda: not app_writes_to(new), timeout=10, interval=0.5):
            fail(f"После переключения {path[-1]} → {new} {app_writes_to(new) or 'приложение отвечало с ошибками'}.")
        try:
            r = post(APP + "/orders", {"customer": f"учения {step}", "total": 1}, timeout=3)
        except RequestError as e:
            fail(f"После переключения {path[-1]} → {new} приложение не приняло заказ ({e}).")
        oid = str(r.json().get("id", "")) if r.status == 201 else ""
        if not oid or order(new, oid).get("customer") != f"учения {step}":
            fail(f"После переключения {path[-1]} → {new} заказ не появился на новом мастере (HTTP {r.status}).")
        path.append(new)
    STATE["moved"] = path[-1] != start
    for oid, fields in SEED.items():
        if order(path[-1], oid) != fields:
            fail(f"После учений на мастере {path[-1]} нет исходного заказа {oid}.")
    return f"Мастер {' → '.join(path)}, после каждого переключения приложение приняло заказ."


@finalizer
def restore_master():
    """Если учения прервались на полпути, вернуть мастер на исходный узел (по возможности)."""
    start = STATE.get("start")
    if not STATE.get("moved") or not start:
        return
    try:
        current = sentinel_master()
        if current != start:
            log(f"возвращаю мастер на {start}")
            failover(current)
    except (kit.CheckFailed, RedisError) as e:
        log(f"мастер не вернулся на {start}: {e}")
