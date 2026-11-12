"""Сервис каталога и заказов. Только стандартная библиотека Python.

Карточки товаров кэшируются в Redis (cache:product:<id>), оформленный заказ ставит задание на доставку:
хеш job:<id> и его номер в очереди jobs:pending. Курьерская служба забирает задания с 6 утра.

Конфигурация — /app/config.json, читается при каждом запросе (перезапуск не нужен):
  cache_ttl_seconds — срок жизни карточки в кэше в секундах; 0 — без срока.

GET /catalog/<id> — карточка товара; GET /catalog?from=<id>&count=<n> — страница категории;
POST /checkout {"order_id"} — оформить заказ; GET /health — пробная запись в Redis; GET /ready — запуск завершён.
При старте кэш прогревается карточками 1..20000.
"""

from __future__ import annotations

import json
import socket
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

CONFIG = "/app/config.json"
REDIS = ("redis", 6379)
READY = threading.Event()


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
        raise ConnectionError("Redis закрыл соединение")
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
    raise ConnectionError("неизвестный ответ Redis")


def pipeline(*commands: tuple) -> list:
    """Команды одним пакетом; ошибка отдельной команды возвращается в списке как RedisError."""
    with socket.create_connection(REDIS, timeout=5) as sock:
        sock.settimeout(5)
        sock.sendall(b"".join(_encode(c) for c in commands))
        f = sock.makefile("rb")
        return [_reply(f) for _ in commands]


def call(*args):
    result = pipeline(args)[0]
    if isinstance(result, RedisError):
        raise result
    return result


def ttl() -> int:
    with open(CONFIG, encoding="utf-8") as f:
        return int(json.load(f).get("cache_ttl_seconds", 0))


def card(pid: int) -> str:
    """Карточка из базы каталога (около 2 КБ)."""
    return json.dumps({"id": pid, "name": f"Товар {pid}", "price": 100 + pid % 9000, "description": "x" * 1900})


def store(pids: list[int], seconds: int) -> list:
    extra = ("EX", seconds) if seconds > 0 else ()
    return pipeline(*[("SET", f"cache:product:{p}", card(p), *extra) for p in pids])


def warmup() -> None:
    """Прогрев кэша после релиза: страницы по 500 карточек, пока Redis принимает запись."""
    for _ in range(60):
        try:
            call("PING")
            break
        except OSError:
            time.sleep(1)
    written = 0
    try:
        for start in range(1, 20001, 500):
            results = store(list(range(start, start + 500)), ttl())
            errors = [r for r in results if isinstance(r, RedisError)]
            written += len(results) - len(errors)
            if errors:
                print(f"прогрев кэша остановлен: {errors[0]}", flush=True)
                break
    except (OSError, ValueError, json.JSONDecodeError) as e:
        print(f"прогрев кэша прерван: {e}", flush=True)
    print(f"прогрев кэша: записано карточек {written}", flush=True)
    READY.set()


class Handler(BaseHTTPRequestHandler):
    def send(self, status: int, body: dict, headers: dict | None = None) -> None:
        data = json.dumps(body, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        for k, v in (headers or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(data)

    def fail(self, e: Exception) -> None:
        print(f"{self.command} {self.path}: {e}", flush=True)
        self.send(503, {"ok": False, "error": str(e)})

    def do_GET(self) -> None:
        url = urlparse(self.path)
        try:
            if url.path == "/ready":
                return self.send(200 if READY.is_set() else 503, {"ready": READY.is_set()})
            if url.path == "/health":
                call("SET", "health:app", str(time.time()), "EX", "60")
                return self.send(200, {"ok": True})
            if url.path.startswith("/catalog/"):
                pid = int(url.path.rsplit("/", 1)[1])
                cached = call("GET", f"cache:product:{pid}")
                if cached:
                    return self.send(200, json.loads(cached), {"X-Cache": "hit"})
                result = store([pid], ttl())[0]
                status = f"error: {result}" if isinstance(result, RedisError) else "miss"
                if isinstance(result, RedisError):
                    print(f"кэш не записан: {result}", flush=True)
                return self.send(200, json.loads(card(pid)), {"X-Cache": status})
            if url.path == "/catalog":
                query = parse_qs(url.query)
                start, count = int(query["from"][0]), min(int(query.get("count", ["50"])[0]), 1000)
                pids = list(range(start, start + count))
                cached = pipeline(("MGET", *[f"cache:product:{p}" for p in pids]))[0]
                misses = [p for p, v in zip(pids, cached) if v is None]
                results = store(misses, ttl()) if misses else []
                errors = [str(r) for r in results if isinstance(r, RedisError)]
                return self.send(200, {"hits": count - len(misses), "stored": len(results) - len(errors), "errors": len(errors), "error": errors[0] if errors else ""})
            self.send(404, {"ok": False, "error": "нет такого адреса"})
        except (OSError, ValueError, KeyError, RedisError, json.JSONDecodeError) as e:
            self.fail(e)

    def do_POST(self) -> None:
        if self.path != "/checkout":
            return self.send(404, {"ok": False, "error": "нет такого адреса"})
        try:
            body = json.loads(self.rfile.read(int(self.headers.get("Content-Length") or 0)) or b"{}")
            job = call("INCR", "jobs:seq")
            call("HSET", f"job:{job}", "order_id", str(body.get("order_id", "")), "status", "pending", "address", "0" * 900)
            call("RPUSH", "jobs:pending", job)
            self.send(201, {"ok": True, "job": job})
        except (OSError, ValueError, RedisError, json.JSONDecodeError) as e:
            self.fail(e)

    def log_message(self, *args) -> None:
        pass


if __name__ == "__main__":
    threading.Thread(target=warmup, daemon=True).start()
    ThreadingHTTPServer(("0.0.0.0", 8000), Handler).serve_forever()
