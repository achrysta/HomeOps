"""Мини-фреймворк автопроверок инцидентов. Только стандартная библиотека Python.

checks.py сценария регистрирует проверки декоратором @check и пользуется хелперами отсюда.
Проверка возвращает строку-итог (что именно подтвердилось) или вызывает fail("что не так").
Сообщение об ошибке описывает наблюдаемый симптом и цель, но не подсказывает решение.
"""

from __future__ import annotations

import http.client as httpclient
import json
import socket
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from typing import Any, Callable

CHECKS: list["Check"] = []
FINALIZERS: list[Callable[[], None]] = []
# Общее состояние между проверками одного запуска (например, наблюдения из предыдущей фазы).
STATE: dict[str, Any] = {}
# Живая проверка (verify --live): только лёгкие проверки, без ожиданий, отчёт не сохраняется и не отправляется
LIVE = False


@dataclass
class Check:
    id: str
    title: str
    fn: Callable[[], str | None]
    needs: list[str] = field(default_factory=list)
    # Лёгкая проверка без ожиданий и нагрузки: её можно опрашивать каждые несколько секунд
    live: bool = False


class CheckFailed(Exception):
    pass


class RequestError(Exception):
    pass


def check(check_id: str, title: str, needs: list[str] | None = None, live: bool = False):
    """Зарегистрировать проверку. needs — id проверок, без которых эта не имеет смысла.
    live — проверка лёгкая (без ожиданий, нагрузки и изменения стенда) и годится для живого опроса."""

    def deco(fn: Callable[[], str | None]):
        CHECKS.append(Check(check_id, title, fn, needs or [], live))
        return fn

    return deco


def finalizer(fn: Callable[[], None]):
    """Вызывается после всех проверок, даже если они упали (например, вернуть режим стенда)."""
    FINALIZERS.append(fn)
    return fn


def fail(message: str):
    raise CheckFailed(message)


def plural(n: int, one: str, few: str, many: str) -> str:
    """«1 фрагмент», «3 фрагмента», «24 фрагмента», «11 фрагментов»."""
    n10, n100 = abs(n) % 10, abs(n) % 100
    if n10 == 1 and n100 != 11:
        return f"{n} {one}"
    if 2 <= n10 <= 4 and not 12 <= n100 <= 14:
        return f"{n} {few}"
    return f"{n} {many}"


def log(message: str) -> None:
    """Строка прогресса для долгих проверок (не попадает в отчёт)."""
    print(f"      … {message}", flush=True)


# ─────────────────────────────────────────────────────────────────────────────
# HTTP
# ─────────────────────────────────────────────────────────────────────────────


@dataclass
class Response:
    status: int
    headers: dict[str, str]
    body: bytes
    elapsed: float

    @property
    def text(self) -> str:
        return self.body.decode("utf-8", errors="replace")

    def json(self) -> Any:
        try:
            return json.loads(self.body or b"null")
        except json.JSONDecodeError:
            fail(f"Ответ не JSON (HTTP {self.status}): {self.text[:200]}")


def http(method: str, url: str, body: Any = None, headers: dict[str, str] | None = None, timeout: float = 10.0) -> Response:
    """HTTP-запрос. HTTP-ошибки (4xx/5xx) возвращаются как Response, сетевые — RequestError."""
    data = None
    h = dict(headers or {})
    if body is not None:
        data = body if isinstance(body, bytes) else json.dumps(body, ensure_ascii=False).encode()
        h.setdefault("Content-Type", "application/json")
    req = urllib.request.Request(url, data=data, method=method, headers=h)
    t0 = time.monotonic()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            content = r.read()
            return Response(r.status, {k.lower(): v for k, v in r.headers.items()}, content, time.monotonic() - t0)
    except urllib.error.HTTPError as e:
        content = e.read() if e.fp else b""
        return Response(e.code, {k.lower(): v for k, v in (e.headers or {}).items()}, content, time.monotonic() - t0)
    except (urllib.error.URLError, socket.timeout, TimeoutError, ConnectionError, httpclient.HTTPException) as e:
        reason = getattr(e, "reason", e)
        elapsed = time.monotonic() - t0
        if isinstance(reason, (socket.timeout, TimeoutError)) or "timed out" in str(reason):
            raise RequestError(f"нет ответа за {elapsed:.1f} с") from e
        raise RequestError(f"{reason}") from e


def get(url: str, timeout: float = 10.0) -> Response:
    return http("GET", url, timeout=timeout)


def post(url: str, body: Any = None, timeout: float = 10.0) -> Response:
    return http("POST", url, body=body, timeout=timeout)


@dataclass
class Stream:
    status: int
    events: list[tuple[float, str]]  # (секунды от начала запроса, payload строки data:)
    done: bool  # получен data: [DONE]
    total: float
    error: str | None = None

    @property
    def first_at(self) -> float | None:
        return self.events[0][0] if self.events else None


def stream_sse(url: str, body: Any, timeout: float = 30.0) -> Stream:
    """POST и чтение SSE построчно с отметкой времени прихода каждой строки data:."""
    parts = urllib.parse.urlsplit(url)
    conn = httpclient.HTTPConnection(parts.hostname, parts.port or 80, timeout=timeout)
    payload = json.dumps(body, ensure_ascii=False).encode()
    t0 = time.monotonic()
    events: list[tuple[float, str]] = []
    done = False
    try:
        conn.request("POST", parts.path or "/", body=payload, headers={"Content-Type": "application/json", "Accept": "text/event-stream"})
        resp = conn.getresponse()
        if resp.status != 200:
            resp.read()
            return Stream(resp.status, [], False, time.monotonic() - t0)
        while True:
            line = resp.readline()
            if not line:
                break
            text = line.decode("utf-8", errors="replace").strip()
            if not text.startswith("data:"):
                continue
            data = text[5:].strip()
            if data == "[DONE]":
                done = True
                break
            events.append((time.monotonic() - t0, data))
        return Stream(200, events, done, time.monotonic() - t0)
    except (socket.timeout, TimeoutError):
        return Stream(200 if events else 0, events, False, time.monotonic() - t0, error=f"нет данных дольше {timeout:.0f} с")
    except (ConnectionError, httpclient.HTTPException, OSError) as e:
        return Stream(200 if events else 0, events, False, time.monotonic() - t0, error=str(e) or type(e).__name__)
    finally:
        conn.close()


# ─────────────────────────────────────────────────────────────────────────────
# Prometheus
# ─────────────────────────────────────────────────────────────────────────────


def prom_query(base: str, expr: str) -> list[dict[str, Any]]:
    r = get(f"{base}/api/v1/query?query={urllib.parse.quote(expr)}")
    data = r.json()
    if r.status != 200 or data.get("status") != "success":
        fail(f"Prometheus не выполнил запрос {expr!r}: {data.get('error', r.text[:200])}")
    return data["data"]["result"]


def prom_max(base: str, expr: str) -> float | None:
    """Максимум по всем сериям мгновенного вектора или None, если серий нет."""
    values = []
    for s in prom_query(base, expr):
        try:
            v = float(s["value"][1])
        except (KeyError, ValueError, IndexError):
            continue
        if v == v:  # отбрасываем NaN
            values.append(v)
    return max(values) if values else None


# ─────────────────────────────────────────────────────────────────────────────
# Ожидание
# ─────────────────────────────────────────────────────────────────────────────


def wait_for(fn: Callable[[], Any], timeout: float, interval: float = 2.0, progress: str | None = None) -> Any:
    """Повторять fn, пока не вернёт truthy-значение или не выйдет время. Возвращает последнее значение.
    В живой проверке — одна попытка: опрос и так повторяется каждые несколько секунд."""
    deadline = time.monotonic() + (0 if LIVE else timeout)
    started = time.monotonic()
    last_log = started
    value = None
    while True:
        try:
            value = fn()
        except (RequestError, CheckFailed):
            value = None
        if value:
            return value
        now = time.monotonic()
        if now >= deadline:
            return value
        if progress and now - last_log >= 15:
            log(f"{progress} ({now - started:.0f} с из {timeout:.0f})")
            last_log = now
        time.sleep(interval)
