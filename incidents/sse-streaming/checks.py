"""Проверки инцидента sse-streaming. Клиент ходит в модель через proxy, как чат-бот."""

from incident_kit import check, fail, http, plural, stream_sse

PROXY = "http://proxy"
SHORT = {"model": "qwen2.5-7b-instruct", "stream": True, "max_tokens": 30,
         "messages": [{"role": "user", "content": "Коротко: что такое KV cache?"}]}
LONG_PROMPT = ("Ниже выгрузка логов инференса за сутки. Найди причины роста задержек. " + "строка лога: запрос обработан, токенов 512, задержка 840 мс; " * 140)[:8000]


@check("ttft", "Первый фрагмент ответа через proxy приходит быстрее 1 с")
def ttft():
    s = stream_sse(f"{PROXY}/v1/chat/completions", SHORT, timeout=20)
    if s.status != 200:
        fail(f"Потоковый запрос через proxy вернул HTTP {s.status or 'нет ответа'}{': ' + s.error if s.error else ''}.")
    if s.first_at is None:
        fail("Через proxy не пришло ни одного фрагмента ответа.")
    if s.first_at >= 1.0:
        fail(f"Первый фрагмент пришёл через {s.first_at:.1f} с после запроса. Цель — меньше 1 с.")
    return f"Первый фрагмент через {s.first_at * 1000:.0f} мс."


@check("incremental", "Ответ приходит по частям, по мере генерации")
def incremental():
    s = stream_sse(f"{PROXY}/v1/chat/completions", SHORT, timeout=20)
    if s.status != 200 or len(s.events) < 10:
        fail(f"Получено {plural(len(s.events), 'фрагмент', 'фрагмента', 'фрагментов')} (HTTP {s.status}). Ожидается поток из десятков фрагментов.")
    spread = s.events[-1][0] - s.events[0][0]
    if spread < 1.5:
        fail(f"Все фрагменты ({len(s.events)}) пришли почти одновременно (разброс {spread * 1000:.0f} мс), "
             f"через {s.events[0][0]:.1f} с после запроса. Пользователь видит ответ целиком в конце, а не по мере генерации.")
    if not s.done:
        fail("Поток не завершился маркером data: [DONE].")
    return f"{plural(len(s.events), 'фрагмент', 'фрагмента', 'фрагментов')} за {spread:.1f} с, поток завершён [DONE]."


@check("long-prompt", "Запросы с длинным промптом (≈ 8000 символов) завершаются успешно")
def long_prompt():
    body = {"model": "qwen2.5-7b-instruct", "max_tokens": 20, "messages": [{"role": "user", "content": LONG_PROMPT}]}
    s = stream_sse(f"{PROXY}/v1/chat/completions", {**body, "stream": True}, timeout=40)
    if s.status != 200:
        fail(f"Потоковый запрос с длинным промптом: HTTP {s.status or 'нет ответа'} через {s.total:.1f} с.")
    if not s.done:
        fail(f"Поток с длинным промптом оборвался через {s.total:.1f} с: получено {plural(len(s.events), 'фрагмент', 'фрагмента', 'фрагментов')}, без [DONE].")
    r = http("POST", f"{PROXY}/v1/chat/completions", body=body, timeout=40)
    if r.status != 200:
        fail(f"Обычный (не потоковый) запрос с длинным промптом: HTTP {r.status} через {r.elapsed:.1f} с.")
    return f"Поток: первый фрагмент через {s.first_at:.1f} с, завершён. Обычный запрос: HTTP 200 за {r.elapsed:.1f} с."
