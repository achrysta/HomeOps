"""Сервис заказов: принимает заказы и хранит их в Redis. Только стандартная библиотека Python.

Конфигурация — /app/config.json, читается при каждом запросе (перезапуск не нужен):
  {"redis_url": "redis://<узел>:6379/0"}                          — подключение к одному узлу;
  {"sentinel": {"master": "<имя>", "nodes": ["<host>:<port>", ...]}} — адрес мастера спрашивается у Sentinel.
Пример второго варианта — config.example.json.

GET /health — пробная запись в Redis; POST /orders {"customer", "total"} — новый заказ; GET /orders/<id>.
"""

from __future__ import annotations

import json
import socket
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

CONFIG = "/app/config.json"
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
        data = arg if isinstance(arg, bytes) else str(arg).encode()
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


def call(host: str, port: int, *commands: tuple, timeout: float = 2.0) -> list:
    """Выполнить несколько команд в одном соединении; ошибка любой из них — RedisError."""
    with socket.create_connection((host, port), timeout=timeout) as sock:
        sock.settimeout(timeout)
        sock.sendall(b"".join(_encode(c) for c in commands))
        f = sock.makefile("rb")
        return [_reply(f) for _ in commands]


def load_config() -> dict:
    with open(CONFIG, encoding="utf-8") as f:
        return json.load(f)


def master() -> tuple[str, int, str]:
    """Адрес узла для записи и способ, которым он найден."""
    cfg = load_config()
    if "sentinel" in cfg:
        sentinel = cfg["sentinel"]
        name = sentinel.get("master", "")
        errors = []
        for node in sentinel.get("nodes", []):
            host, _, port = node.rpartition(":")
            try:
                addr = call(host, int(port), ("SENTINEL", "get-master-addr-by-name", name))[0]
            except (OSError, ValueError, RedisError) as e:
                errors.append(f"{node}: {e}")
                continue
            if not addr:
                errors.append(f"{node}: мастер «{name}» неизвестен")
                continue
            host, port = addr[0], int(addr[1])
            role = call(host, port, ("ROLE",))[0][0]
            if role != "master":
                errors.append(f"{node}: {host}:{port} отвечает как {role}")
                continue
            return host, port, "sentinel"
        raise RedisError("Sentinel не дали адрес мастера: " + "; ".join(errors or ["список nodes пуст"]))
    url = urlparse(cfg.get("redis_url", ""))
    if not url.hostname:
        raise RedisError("в config.json нет ни redis_url, ни sentinel")
    return url.hostname, url.port or 6379, "static"


def ensure_seed(host: str, port: int) -> None:
    """Исходные заказы пустой базы: пишутся один раз, пока счётчик заказов не создан."""
    if call(host, port, ("SET", "orders:seq", "1003", "NX"))[0] == "OK":
        call(host, port, *[("HSET", f"order:{oid}", "customer", o["customer"], "total", o["total"]) for oid, o in SEED.items()])


def seed() -> None:
    for _ in range(60):
        try:
            ensure_seed(*master()[:2])
            print("исходные заказы на месте", flush=True)
            return
        except (OSError, ValueError, RedisError, json.JSONDecodeError) as e:
            print(f"ожидание Redis: {e}", flush=True)
            time.sleep(1)


class Handler(BaseHTTPRequestHandler):
    def send(self, status: int, body: dict) -> None:
        data = json.dumps(body, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def fail(self, e: Exception) -> None:
        print(f"{self.command} {self.path}: {e}", flush=True)
        self.send(503, {"ok": False, "error": str(e)})

    def do_GET(self) -> None:
        try:
            host, port, how = master()
            if self.path == "/health":
                ensure_seed(host, port)
                call(host, port, ("SET", "health:app", str(time.time()), "EX", "60"))
                return self.send(200, {"ok": True, "master": f"{host}:{port}", "discovery": how})
            if self.path.startswith("/orders/"):
                fields = call(host, port, ("HGETALL", "order:" + self.path.split("/")[-1]))[0]
                if not fields:
                    return self.send(404, {"ok": False, "error": "заказ не найден"})
                return self.send(200, dict(zip(fields[::2], fields[1::2])))
            self.send(404, {"ok": False, "error": "нет такого адреса"})
        except (OSError, ValueError, RedisError, json.JSONDecodeError) as e:
            self.fail(e)

    def do_POST(self) -> None:
        if self.path != "/orders":
            return self.send(404, {"ok": False, "error": "нет такого адреса"})
        try:
            body = json.loads(self.rfile.read(int(self.headers.get("Content-Length") or 0)) or b"{}")
            host, port, _ = master()
            oid = call(host, port, ("INCR", "orders:seq"))[0]
            call(host, port, ("HSET", f"order:{oid}", "customer", str(body.get("customer", "")), "total", str(body.get("total", ""))))
            self.send(201, {"ok": True, "id": oid, "master": f"{host}:{port}"})
        except (OSError, ValueError, RedisError, json.JSONDecodeError) as e:
            self.fail(e)

    def log_message(self, *args) -> None:
        pass


if __name__ == "__main__":
    threading.Thread(target=seed, daemon=True).start()
    ThreadingHTTPServer(("0.0.0.0", 8000), Handler).serve_forever()
