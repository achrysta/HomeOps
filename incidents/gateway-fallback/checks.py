"""Проверки инцидента gateway-fallback. Режимы основной модели переключаются через её admin API."""

from incident_kit import RequestError, STATE, check, fail, finalizer, get, http, post

GATEWAY = "http://gateway:4000"
PRIMARY = "http://primary:8000"
BODY = {"model": "chat", "max_tokens": 30, "messages": [{"role": "user", "content": "Сформулируй статус инцидента в одном предложении."}]}


def set_primary(mode: str) -> None:
    r = post(f"{PRIMARY}/admin/mode", {"mode": mode}, timeout=5)
    if r.status != 200:
        fail(f"Не удалось переключить основную модель в режим {mode}: HTTP {r.status}")


def ask(timeout: float):
    """Запрос клиента через gateway: (status, model, elapsed)."""
    try:
        r = http("POST", f"{GATEWAY}/v1/chat/completions", body=BODY, timeout=timeout)
    except RequestError as e:
        return None, None, timeout, str(e)
    model = None
    if r.status == 200:
        try:
            model = r.json().get("model")
        except Exception:
            model = None
    return r.status, model, r.elapsed, None


@check("healthy", "Когда основная модель здорова, отвечает она")
def healthy():
    STATE["mode_before"] = get(f"{PRIMARY}/admin/mode", timeout=5).json().get("mode", "hang")
    set_primary("ok")
    for i in range(5):
        status, model, elapsed, err = ask(timeout=15)
        if status != 200:
            fail(f"Запрос {i + 1} из 5 при здоровой основной модели: {err or f'HTTP {status}'} за {elapsed:.1f} с.")
        if model != "qwen-primary":
            fail(f"Запрос {i + 1} из 5 обслужила модель {model!r}, хотя основная (qwen-primary) здорова и отвечает примерно за 1 с.")
        if elapsed > 5:
            fail(f"Запрос {i + 1} из 5 занял {elapsed:.1f} с при здоровой основной модели.")
    return "5 из 5 запросов обслужила qwen-primary."


@check("hang", "Основная модель зависла — клиент получает ответ резервной не дольше 10 с")
def hang():
    set_primary("hang")
    status, model, elapsed, err = ask(timeout=40)
    if status != 200:
        fail(f"Клиент получил {err or f'HTTP {status}'} через {elapsed:.1f} с. Цель — ответ резервной модели не дольше 10 с.")
    if model != "qwen-small":
        fail(f"Ответила модель {model!r}, ожидалась резервная qwen-small.")
    if elapsed > 10:
        fail(f"Ответ резервной модели пришёл через {elapsed:.1f} с. Цель — не дольше 10 с.")
    return f"Ответ qwen-small через {elapsed:.1f} с."


@check("overload", "Основная модель перегружена (503) — клиент получает ответ резервной не дольше 3 с")
def overload():
    set_primary("error503")
    status, model, elapsed, err = ask(timeout=30)
    if status != 200:
        fail(f"Клиент получил {err or f'HTTP {status}'} через {elapsed:.1f} с, хотя резервная модель доступна.")
    if model != "qwen-small":
        fail(f"Ответила модель {model!r}, ожидалась резервная qwen-small.")
    if elapsed > 3:
        fail(f"Ответ резервной модели пришёл через {elapsed:.1f} с. Цель — не дольше 3 с.")
    return f"Ответ qwen-small через {elapsed:.1f} с."


@finalizer
def restore():
    post(f"{PRIMARY}/admin/mode", {"mode": STATE.get("mode_before", "hang")}, timeout=5)
