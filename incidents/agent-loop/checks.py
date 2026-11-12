"""Проверки инцидента agent-loop: агент останавливается сам, не плодит тикеты и переживает разовый сбой."""

import hashlib
from pathlib import Path

from incident_kit import RequestError, check, fail, get, http, plural, post

AGENT = "http://agent:8200"
MODEL = "http://model:8000"
TOOLS = "http://tools:8100"
ROOT = Path("/scenario")
DOC = "Таймаут попытки к провайдеру — 3 с"
# исходные настройки сервисов стенда: по условию их не меняют ни в коде, ни в compose
CONFIG = {"модели": (MODEL, {"latency": 0.15, "max_calls": 120}), "сервиса инструментов": (TOOLS, {"ticket_delay": 2.5})}


def reset_services() -> None:
    for url in (f"{MODEL}/admin/reset", f"{TOOLS}/admin/reset"):
        try:
            r = post(url, {}, timeout=5)
        except RequestError as e:
            fail(f"Сервис {url.split('/admin')[0]} недоступен ({e}). Стенд запущен? docker compose up -d")
        if r.status != 200:
            fail(f"Служебный сброс {url} вернул HTTP {r.status}.")


def run(task: str, task_id: str, timeout: float):
    try:
        r = http("POST", f"{AGENT}/run", body={"task": task, "task_id": task_id}, timeout=timeout)
    except RequestError as e:
        return None, {}, str(e)
    try:
        data = r.json() or {}
    except Exception:
        data = {}
    return r.status, data, None


def model_calls() -> int:
    return int(get(f"{MODEL}/admin/stats", timeout=5).json().get("calls", 0))


def tool_calls(tool: str, word: str) -> list:
    """Журнал сервиса инструментов: вызовы tool, в аргументе которых есть word."""
    calls = get(f"{TOOLS}/admin/calls", timeout=5).json().get("calls", [])
    return [c for c in calls if c.get("tool") == tool and word in str(c.get("query") or c.get("title") or "")]


def tickets(word: str) -> list:
    return [t for t in get(f"{TOOLS}/admin/tickets", timeout=5).json().get("tickets", []) if word in t.get("title", "")]


@check("happy", "Обычная задача решается, разовый сбой поиска переживается повтором")
def happy():
    reset_services()
    status, data, err = run("Как настроены таймауты gateway?", "T-happy", 30)
    if err:
        fail(f"Агент не ответил за 30 с ({err}). Обычная задача решается за несколько секунд.")
    if status != 200 or data.get("status") != "done":
        fail(
            f"Обычная задача не решена: HTTP {status}, статус {data.get('status')!r}, ошибка {str(data.get('error', ''))[:160]!r}. "
            "Поиск отвечает 503 только с первой попытки: разовый сбой безопасного вызова должен переживаться повтором."
        )
    answer = str(data.get("answer") or "")
    calls = model_calls()
    if calls < 2:
        fail(f"Агент вернул done, но модель вызвана {plural(calls, 'раз', 'раза', 'раз')}: ответ должен прийти циклом модель → инструмент → модель.")
    searches = [c["status"] for c in tool_calls("search_docs", "таймаут")]
    if 200 not in searches:
        fail(f"Поиск по задаче ни разу не ответил 200 (ответы: {searches or 'вызовов не было'}): данные должны прийти из базы знаний, разовый сбой — переживаться повтором.")
    if DOC not in answer:
        fail(f"Агент вернул done, но в ответе нет данных из базы знаний: {answer[:120]!r}.")
    return f"Ответ за {plural(calls, 'вызов', 'вызова', 'вызовов')} модели, поиск: {searches}: {answer[:80]}"


@check("stops", "Инструмент всё время падает — агент останавливается с причиной не позже 10-го вызова модели")
def stops():
    reset_services()
    status, data, err = run("Как устроена ротация ключей?", "T-loop", 35)
    calls = model_calls()
    if err:
        fail(f"Агент не вернул результат за 35 с, модель вызвана {calls} раз. Поиск для этой задачи всё время падает — агент должен остановиться сам и сообщить причину.")
    state = data.get("status")
    if status != 200 or state == "error":
        fail(f"Агент упал с ошибкой после {calls} вызовов модели: {str(data.get('error', ''))[:160]}. Остановка по лимиту — штатный результат с причиной, а не падение, когда модель отказала по бюджету.")
    if state == "done":
        fail("Агент вернул done, хотя все вызовы поиска для задачи падают: итог должен честно сообщать, что задача не решена.")
    if state not in ("max_steps", "loop", "budget", "timeout"):
        fail(f"Неожиданный статус {state!r}: ожидается причина остановки — max_steps, loop, budget или timeout.")
    attempts = tool_calls("search_docs", "ротац")
    if calls < 2 or not attempts:
        fail(f"Агент вернул {state} после {plural(calls, 'вызова', 'вызовов', 'вызовов')} модели и {plural(len(attempts), 'вызова', 'вызовов', 'вызовов')} поиска: остановка засчитывается, когда агент действительно пытался решить задачу и упёрся в лимит.")
    if calls > 10:
        fail(f"Агент остановился ({state}), но после {calls} вызовов модели. Лимит должен срабатывать не позже 10-го вызова.")
    return f"Остановка {state} после {calls} вызовов модели."


@check("tickets", "Создание тикета: ровно один тикет и статус done")
def created_once():
    reset_services()
    status, data, err = run("Создай тикет: не работает вход в личный кабинет", "T-ticket", 40)
    found = tickets("вход в личный кабинет")
    if len(found) > 1:
        fail(f"Создано {plural(len(found), 'тикет', 'тикета', 'тикетов')} вместо одного: повтор после таймаута создаёт дубль. Повторять можно только то, что безопасно повторять.")
    if not found:
        fail(f"Тикет не создан (HTTP {status}, статус {data.get('status')!r}, {err or str(data.get('error', ''))[:120]}).")
    if err:
        fail(f"Агент не ответил за 40 с ({err}), хотя тикет {found[0]['id']} уже создан.")
    if status != 200 or data.get("status") != "done":
        fail(f"Тикет создан один, но агент вернул {data.get('status')!r}: {str(data.get('error', ''))[:120]}. Создание тикета отвечает примерно за 2.5 с.")
    calls, answer = model_calls(), str(data.get("answer") or "")
    if calls < 2 or found[0]["id"] not in answer:
        fail(f"Тикет {found[0]['id']} создан, но не циклом агента: модель вызвана {plural(calls, 'раз', 'раза', 'раз')}, ответ {answer[:80]!r}. Тикет создаёт инструмент по вызову модели, итог — ответ модели с номером тикета.")
    return f"Один тикет {found[0]['id']}, агент вернул done."


@check("intact", "Модель и сервис инструментов не изменены — чинится агент")
def intact():
    for rel in ("model/server.py", "tools/server.py"):
        live, orig = ROOT / rel, ROOT / ".original" / rel
        if not live.exists() or hashlib.sha256(live.read_bytes()).digest() != hashlib.sha256(orig.read_bytes()).digest():
            fail(f"Файл {rel} изменён. По условию модель и сервис инструментов не меняются: исправление — в agent/.")
    reset_services()
    probe = http("POST", f"{TOOLS}/tools/create_ticket", body={"title": "проверка задержки", "body": ""}, timeout=10)
    reset_services()
    if probe.status != 201 or probe.elapsed < 2.0:
        fail(f"Сервис инструментов отвечает на create_ticket за {probe.elapsed:.1f} с (HTTP {probe.status}), а исходно — около 2.5 с. Условия стенда не меняются.")
    if http("POST", f"{TOOLS}/tools/search_docs", body={"query": "ротация ключей"}, timeout=5).status != 500:
        fail("Документ о ротации ключей снова доступен — условия стенда изменены.")
    reset_services()
    for name, (url, expected) in CONFIG.items():
        r = get(f"{url}/admin/config", timeout=5)
        actual = r.json() if r.status == 200 else {}
        changed = [f"{k}={actual.get(k)} вместо {v}" for k, v in expected.items() if actual.get(k) != v]
        if r.status != 200 or changed:
            fail(f"Настройки {name} изменены ({', '.join(changed) or f'HTTP {r.status} на /admin/config'}). По условию модель и инструменты не меняются — ни код, ни настройки в compose.")
    return "Модель и инструменты в исходном виде."
