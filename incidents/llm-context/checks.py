"""Проверки инцидента llm-context. Не зависят от выбранной модели: размер промпта
подбирается через /tokenize, таймауты рассчитаны на CPU и модели до 7B."""

import concurrent.futures as cf
import re
import time
from pathlib import Path

from incident_kit import RequestError, STATE, check, fail, get, http, log, plural, wait_for

LLM = "http://llm:8080"
BASE = "Журнал инцидента: сервис инференса отвечал с задержкой, очередь росла, KV cache заполнен. "
PROMPT_TOKENS = 1500


def tokens(text: str) -> int:
    r = http("POST", f"{LLM}/tokenize", body={"content": text}, timeout=30)
    if r.status != 200:
        fail(f"/tokenize ответил HTTP {r.status}")
    return len(r.json().get("tokens", []))


def long_prompt() -> str:
    if "prompt" not in STATE:
        per_block = tokens(BASE * 20) / 20
        STATE["prompt"] = BASE * max(1, round(PROMPT_TOKENS / per_block))
    return STATE["prompt"]


def chat(content: str, max_tokens: int, timeout: float):
    return http("POST", f"{LLM}/v1/chat/completions", timeout=timeout,
                body={"messages": [{"role": "user", "content": content}], "max_tokens": max_tokens, "temperature": 0})


def error_text(r) -> str:
    try:
        return str(r.json().get("error", {}).get("message", r.text[:200]))
    except Exception:
        return r.text[:200]


SCENARIO = Path("/scenario")
MEM_LINE = "mem_limit: ${LLM_MEM_LIMIT:-3g}"
# Лимиты памяти, которые задаёт платформа для каждого пресета модели
PLATFORM_LIMITS = {"qwen2.5-0.5b.env": "1g", "qwen2.5-3b.env": "3g", "qwen2.5-7b.env": "6g"}


def env_value(path: Path, key: str) -> str | None:
    if not path.exists():
        return None
    m = re.search(rf"^\s*{key}\s*=\s*(\S+)", path.read_text(encoding="utf-8"), re.M)
    return m.group(1) if m else None


@check("memory-limit", "Лимит памяти контейнера не изменён")
def memory_limit():
    lines = [line.strip() for line in (SCENARIO / "compose.yaml").read_text(encoding="utf-8").splitlines() if line.strip().startswith(("mem_limit:", "memory:"))]
    if lines != [MEM_LINE]:
        fail("Лимит памяти контейнера llm в compose.yaml изменён. Его задаёт платформа, как resources.limits.memory у пода — решение должно уложиться в него.")
    for name, want in PLATFORM_LIMITS.items():
        got = env_value(SCENARIO / "models" / name, "LLM_MEM_LIMIT")
        if got != want:
            fail(f"В models/{name} LLM_MEM_LIMIT={got}, а платформа задаёт {want}.")
    if env_value(SCENARIO / ".env", "LLM_MEM_LIMIT"):
        fail("Лимит памяти переопределён в .env стенда — его задаёт платформа.")
    return "лимит памяти контейнера — как задала платформа"


@check("ready", "Сервер запущен и модель загружена")
def ready():
    def health():
        try:
            return get(f"{LLM}/health", timeout=5).status == 200
        except RequestError:
            return False

    if not wait_for(health, timeout=300, interval=3, progress="ждём загрузку модели (первый запуск скачивает её)"):
        try:
            r = get(f"{LLM}/health", timeout=5)
        except RequestError as e:
            fail(f"Сервер не отвечает ({e}). Если контейнер упал, посмотрите его статус и логи llm.")
        if r.status == 503:
            fail("Модель ещё скачивается или загружается в память. Дождитесь статуса «Стенд работает» и повторите проверку.")
        fail(f"Сервер отвечает HTTP {r.status}: {error_text(r)}")
    props = get(f"{LLM}/props", timeout=10).json()
    STATE["slots"] = props.get("total_slots")
    model = str(props.get("model_path", "")).rsplit("/", 1)[-1] or "модель"
    return f"Загружена {model}, слотов: {STATE['slots']}."


@check("long-prompt", "Запрос с промптом ≈ 1500 токенов обрабатывается", needs=["ready"])
def long_prompt_check():
    prompt = long_prompt()
    r = chat(prompt + "\nКратко: в чём проблема?", 16, timeout=240)
    if r.status != 200:
        fail(f"HTTP {r.status}: {error_text(r)}")
    used = r.json().get("usage", {}).get("prompt_tokens")
    return f"HTTP 200, промпт {plural(int(used or 0), 'токен', 'токена', 'токенов')}, ответ за {r.elapsed:.1f} с."


@check("parallel", "Четыре таких запроса обрабатываются параллельно", needs=["ready"])
def parallel():
    slots = STATE.get("slots") or 0
    if slots < 4:
        fail(f"У сервера {plural(slots, 'слот', 'слота', 'слотов')}: одновременно обрабатывается меньше четырёх запросов, остальные ждут в очереди.")
    prompt = long_prompt()
    log("4 параллельных запроса по ≈ 1500 токенов, на CPU это до пары минут")
    t0 = time.monotonic()
    with cf.ThreadPoolExecutor(4) as ex:
        results = list(ex.map(lambda i: chat(f"[{i}] {prompt}\nКратко: в чём проблема?", 16, timeout=400), range(4)))
    elapsed = time.monotonic() - t0
    bad = [r for r in results if r.status != 200]
    if bad:
        fail(f"{len(bad)} из 4 запросов завершились ошибкой: HTTP {bad[0].status}: {error_text(bad[0])}")
    return f"4 из 4 запросов успешны за {elapsed:.0f} с."


@check("long-answer", "Ответ длиной до 300 токенов не обрывается", needs=["ready"])
def long_answer():
    r = chat("Выведи числа от 1 до 300 через запятую, без пояснений.", 300, timeout=400)
    if r.status != 200:
        fail(f"HTTP {r.status}: {error_text(r)}")
    body = r.json()
    got = body.get("usage", {}).get("completion_tokens", 0)
    reason = body.get("choices", [{}])[0].get("finish_reason")
    if got < 290:
        fail(f"Ответ оборвался на {plural(got, 'токене', 'токенах', 'токенах')} (finish_reason={reason}), хотя клиент разрешил 300.")
    return f"Сгенерировано {plural(got, 'токен', 'токена', 'токенов')} за {r.elapsed:.0f} с."
