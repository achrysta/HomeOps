"""Учебный LLM Gateway: единая точка входа для клиентов перед несколькими моделями.

Логика роутинга повторяет то, что делают LiteLLM Router и Envoy AI Gateway:
- deployments пробуются по порядку из [router].order;
- на каждый deployment — до max_retries повторов, каждая попытка ограничена своим timeout;
- поводом для повтора и перехода к следующему deployment считаются таймаут, ошибка соединения
  и HTTP-статусы из [router].retry_on; остальные ответы отдаются клиенту как есть;
- весь запрос клиента ограничен [server].request_timeout.

Конфиг читается при старте: после правки config.toml перезапустите сервис (docker compose restart gateway).
Метрики Prometheus: GET /metrics.
"""

from __future__ import annotations

import json
import socket
import threading
import time
import tomllib
import urllib.error
import urllib.request
import uuid
from collections import Counter
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

with open("/etc/gateway/config.toml", "rb") as f:
    CFG = tomllib.load(f)

SERVER = CFG.get("server", {})
ROUTER = CFG.get("router", {})
DEPLOYMENTS = {d["name"]: d for d in CFG.get("deployments", [])}
ORDER = ROUTER.get("order", list(DEPLOYMENTS))
RETRY_ON = set(ROUTER.get("retry_on", []))
BACKOFF = float(ROUTER.get("retry_backoff", 0.2))
REQUEST_TIMEOUT = float(SERVER.get("request_timeout", 60))

_metrics: Counter[tuple] = Counter()
_lock = threading.Lock()


def inc(*key) -> None:
    with _lock:
        _metrics[key] += 1


def log(msg: str) -> None:
    print(f"{time.strftime('%H:%M:%S')} {msg}", flush=True)


def call(dep: dict, payload: bytes, timeout: float) -> tuple[int, bytes]:
    req = urllib.request.Request(f"{dep['api_base'].rstrip('/')}/chat/completions", data=payload, method="POST",
                                 headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


class Handler(BaseHTTPRequestHandler):
    server_version = "llm-gateway/0.3"

    def log_message(self, *args):
        pass

    def _send(self, status: int, body: bytes, headers: dict[str, str] | None = None) -> None:
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        for k, v in (headers or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/health":
            self._send(200, b'{"status":"ok"}')
        elif self.path == "/metrics":
            lines = ["# TYPE gateway_attempts_total counter"]
            with _lock:
                for (name, dep, outcome), v in sorted(_metrics.items()):
                    if name == "attempt":
                        lines.append(f'gateway_attempts_total{{deployment="{dep}",outcome="{outcome}"}} {v}')
                lines.append("# TYPE gateway_requests_total counter")
                for (name, status, served_by), v in sorted(_metrics.items()):
                    if name == "request":
                        lines.append(f'gateway_requests_total{{status="{status}",served_by="{served_by}"}} {v}')
            body = ("\n".join(lines) + "\n").encode()
            self.send_response(200)
            self.send_header("Content-Type", "text/plain; version=0.0.4")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        else:
            self._send(404, b'{"error":"not found"}')

    def do_POST(self):
        if self.path != "/v1/chat/completions":
            self._send(404, b'{"error":"not found"}')
            return
        rid = uuid.uuid4().hex[:6]
        started = time.monotonic()
        raw = self.rfile.read(int(self.headers.get("Content-Length") or 0))
        try:
            req = json.loads(raw or b"{}")
        except json.JSONDecodeError:
            self._send(400, b'{"error":"invalid json"}')
            return
        last_error = "no deployments"

        for name in ORDER:
            dep = DEPLOYMENTS.get(name)
            if not dep:
                log(f"req={rid} unknown deployment {name!r} in router.order")
                continue
            payload = json.dumps({**req, "model": dep["model"], "stream": False}).encode()
            attempts = int(dep.get("max_retries", 0)) + 1
            for attempt in range(1, attempts + 1):
                remaining = REQUEST_TIMEOUT - (time.monotonic() - started)
                if remaining <= 0:
                    log(f"req={rid} request_timeout {REQUEST_TIMEOUT:.0f}s exceeded -> 504")
                    inc("request", 504, "-")
                    self._send(504, json.dumps({"error": "gateway request_timeout exceeded", "last_error": last_error}).encode())
                    return
                t = min(float(dep.get("timeout", 30)), remaining)
                t0 = time.monotonic()
                try:
                    status, body = call(dep, payload, t)
                except (socket.timeout, TimeoutError):
                    last_error = f"{name}: timeout after {t:.1f}s"
                    inc("attempt", name, "timeout")
                    log(f"req={rid} {name} attempt {attempt}/{attempts} timeout after {time.monotonic() - t0:.1f}s")
                    time.sleep(BACKOFF)
                    continue
                except urllib.error.URLError as e:
                    reason = e.reason
                    if isinstance(reason, (socket.timeout, TimeoutError)):
                        last_error = f"{name}: timeout after {t:.1f}s"
                        inc("attempt", name, "timeout")
                        log(f"req={rid} {name} attempt {attempt}/{attempts} timeout after {time.monotonic() - t0:.1f}s")
                    else:
                        last_error = f"{name}: {reason}"
                        inc("attempt", name, "connect_error")
                        log(f"req={rid} {name} attempt {attempt}/{attempts} connect error: {reason}")
                    time.sleep(BACKOFF)
                    continue
                except (ConnectionError, OSError) as e:
                    last_error = f"{name}: {e}"
                    inc("attempt", name, "connect_error")
                    log(f"req={rid} {name} attempt {attempt}/{attempts} connect error: {e}")
                    time.sleep(BACKOFF)
                    continue

                if status == 200:
                    inc("attempt", name, "ok")
                    inc("request", 200, name)
                    log(f"req={rid} {name} attempt {attempt}/{attempts} -> 200 in {time.monotonic() - t0:.2f}s (total {time.monotonic() - started:.2f}s)")
                    self._send(200, body, {"X-Gateway-Deployment": name})
                    return
                inc("attempt", name, f"http_{status}")
                last_error = f"{name}: HTTP {status}"
                if status in RETRY_ON:
                    log(f"req={rid} {name} attempt {attempt}/{attempts} -> HTTP {status}, retrying")
                    time.sleep(BACKOFF)
                    continue
                log(f"req={rid} {name} attempt {attempt}/{attempts} -> HTTP {status}, returned to client")
                inc("request", status, name)
                self._send(status, body, {"X-Gateway-Deployment": name})
                return
            log(f"req={rid} {name} exhausted after {attempts} attempt(s), trying next deployment")

        log(f"req={rid} all deployments failed in {time.monotonic() - started:.1f}s -> 502")
        inc("request", 502, "-")
        self._send(502, json.dumps({"error": "all deployments failed", "last_error": last_error}).encode())


def main() -> None:
    port = int(SERVER.get("port", 4000))
    log(f"llm-gateway on :{port}, order={ORDER}, retry_on={sorted(RETRY_ON)}, request_timeout={REQUEST_TIMEOUT}s")
    for name in ORDER:
        d = DEPLOYMENTS.get(name, {})
        log(f"  deployment {name}: {d.get('api_base')} model={d.get('model')} timeout={d.get('timeout')}s max_retries={d.get('max_retries', 0)}")
    ThreadingHTTPServer(("0.0.0.0", port), Handler).serve_forever()


if __name__ == "__main__":
    main()
