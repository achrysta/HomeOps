"""Короткий HTTP-трафик только к CPU-fixtures. Не меняет конфигурацию, не запускает реальную модель."""
import http.client
import json
import time
import urllib.parse
import uuid
from pathlib import Path

from incident_kit import check, fail

ANSWERS = Path("/answers")


def get(host, path):
    conn = http.client.HTTPConnection(host, 8000, timeout=2)
    try:
        conn.request("GET", path)
        r = conn.getresponse()
        if r.status != 200: fail(f"GET {host}{path}: HTTP {r.status}.")
        return json.loads(r.read())
    except (OSError, http.client.HTTPException):
        fail(f"Сервис {host} пока не отвечает по HTTP.")
    finally:
        conn.close()


def call(message="normal", path="/v1/chat/completions", body=None, tenant=None, request_id=None):
    probe = uuid.uuid4().hex
    conn = http.client.HTTPConnection("gateway", 8000, timeout=2)
    headers = {"Content-Type": "application/json", "X-Gym-Probe": probe, "X-Tenant": tenant or probe}
    if request_id: headers["X-Request-ID"] = request_id
    payload = body or {"model": "lesson", "messages": [{"role": "user", "content": message}], "max_tokens": 8}
    try:
        conn.request("POST", path, json.dumps(payload), headers)
        r = conn.getresponse()
        return r.status, json.loads(r.read()), dict(r.getheaders()), probe
    except (OSError, http.client.HTTPException, json.JSONDecodeError):
        fail("Gateway оборвал HTTP-запрос или не вернул корректный JSON.")
    finally:
        conn.close()


def events(probe, provider="provider-a"):
    return get(provider, "/admin/events?probe=" + urllib.parse.quote(probe, safe=""))


@check("model", "Найти модель", live=True)
def model():
    path = ANSWERS / "model-id"
    expected = get("provider-a", "/v1/models")["data"][0]["id"]
    if not path.exists() or path.read_text().strip() != expected:
        fail("Запишите текущий id из /v1/models provider-a в /answers/model-id.")
    return "id совпал с текущей протокольной fixture"


@check("stream", "Таймаут и поток", needs=["model"], live=True)
def stream():
    status, _, _, _ = call("slow")
    if status != 200: fail(f"Короткий контрольный slow-запрос завершился HTTP {status} вместо ответа.")
    conn = http.client.HTTPConnection("gateway", 8000, timeout=2)
    started = time.monotonic()
    try:
        conn.request("POST", "/v1/chat/completions", json.dumps({"stream": True, "messages": [{"role": "user", "content": "stream"}]}), {"Content-Type": "application/json", "X-Tenant": uuid.uuid4().hex})
        r = conn.getresponse()
        # SSE допускает heartbeat/служебные строки до первого content.
        first = b""
        for _ in range(12):
            first = r.readline()
            if b'"content"' in first or time.monotonic() - started >= 0.55: break
        ttft = time.monotonic() - started
        rest = r.read()
        if r.status != 200 or "text/event-stream" not in (r.getheader("Content-Type") or "") or b'"content"' not in first or b"[DONE]" not in rest:
            fail("Клиент не получил полный SSE-поток: content и завершающий [DONE].")
        if ttft >= 0.55: fail(f"Первый content пришёл через {ttft:.2f} с; fixture отдаёт его раньше конца ответа. Ожидается <0.55 с.")
    except (OSError, http.client.HTTPException):
        fail("SSE-поток оборвался или превысил короткий таймаут контрольного запроса.")
    finally:
        conn.close()
    return "slow отвечает, content передаётся до окончания потока; задержки fixture синтетические"


@check("retry", "Повтор и побочный эффект", needs=["stream"], live=True)
def retry():
    status, _, _, probe = call("retry-429")
    trace = events(probe)["events"]
    if status != 200 or len(trace) < 2 or trace[1]["at"] - trace[0]["at"] < 0.9:
        fail("После временного 429 нужен успешный ответ с учётом Retry-After: 1; мгновенный повтор не проходит.")
    _, _, _, probe = call(path="/v1/actions", body={"action": "fixture-only"})
    action = events(probe)
    if action["effects"] != 1:
        fail("Контрольная запись создала несколько эффектов: 429 после записи нельзя повторять без гарантированной идемпотентности.")
    return "чтение переживает 429 с задержкой, небезопасная запись не дублируется"


@check("fallback", "Резервный провайдер", needs=["retry"], live=True)
def fallback():
    status, _, _, probe = call("fallback")
    if status != 200 or not events(probe, "provider-b")["events"]:
        fail("При 503 provider-a клиент не получил ответ от резервного provider-b.")
    return "ответ получен через второй провайдер"


@check("limits", "Токены и квота", needs=["fallback"], live=True)
def limits():
    status, _, _, probe = call(body={"messages": [{"role": "user", "content": "normal"}], "max_tokens": 4096})
    trace = events(probe)["events"]
    if status != 200 or not trace or type(trace[-1]["max_tokens"]) is not int or not 1 <= trace[-1]["max_tokens"] <= 64:
        fail("Провайдер получил больше 64 max_tokens или ограничение не передано.")
    tenant = uuid.uuid4().hex
    codes = [call(tenant=tenant)[0] for _ in range(3)]
    if codes != [200, 200, 429] or call(tenant=uuid.uuid4().hex)[0] != 200:
        fail(f"Учебная квота: два запроса tenant проходят, третий — 429, другой tenant независим. Сейчас {codes}.")
    return "max_tokens ограничен, квота изолирована по учебной метке tenant"


@check("request-id", "Связать запрос и логи", needs=["limits"], live=True)
def request_id():
    sent = uuid.uuid4().hex
    status, _, headers, probe = call(request_id=sent)
    returned = next((v for k, v in headers.items() if k.lower() == "x-request-id"), "")
    trace = events(probe)["events"]
    logs = get("gateway", "/admin/logs")
    if status != 200 or not returned or not trace or trace[-1].get("request_id") != returned or not any(row.get("request_id") == returned for row in logs.get("logs", [])):
        fail("X-Request-ID должен связывать ответ клиенту, вызов провайдера и журнал gateway.")
    return "один request_id виден клиенту, провайдеру и в журнале"
