"""Проверки инцидента rag-retrieval: индекс на месте, ассистент находит нужное и не отвечает не по теме."""

import json
import urllib.parse
from pathlib import Path

from incident_kit import check, fail, get, plural

API = "http://api:8000"
QDRANT = "http://qdrant:6333"

# Golden set: вопрос → документ, который обязан попасть в источники ответа (top-3)
GOLDEN = [
    ("Как получить доступ к GPU?", "gpu-access"),
    ("Сколько GPU-часов выделяется команде в месяц?", "gpu-quota"),
    ("Какие метрики проверяет eval gate перед выкаткой модели?", "eval-gate"),
    ("Как устроена canary-выкатка новой модели?", "canary"),
    ("За сколько минут дежурный должен отреагировать на алерт?", "oncall"),
    ("Какой max-model-len стоит по умолчанию в vLLM?", "vllm-config"),
    ("Что делать, если LLM Gateway возвращает 429?", "rate-limits"),
    ("Где хранить API-ключи внешних провайдеров?", "secrets"),
    ("Какую модель эмбеддингов выбрать для поиска по русским текстам?", "embeddings"),
    ("Сколько дней хранятся логи промптов?", "prompt-logs"),
    ("Можно ли отправлять персональные данные во внешние LLM?", "pii"),
    ("Как зарегистрировать новую версию модели в MLflow?", "model-registry"),
]
OFF_TOPIC = [
    "Какой рецепт борща с пампушками?",
    "Кто выиграл чемпионат мира по футболу?",
    "Как починить капающий кран на кухне?",
]


def ask(q: str) -> dict:
    r = get(f"{API}/ask?q={urllib.parse.quote(q)}", timeout=15)
    if r.status != 200:
        fail(f"Ассистент ответил HTTP {r.status} на вопрос «{q}».")
    return r.json()


@check("index", "Индекс базы знаний построен полностью")
def index():
    docs = [json.loads(line) for line in Path("/scenario/ingest/docs.jsonl").read_text(encoding="utf-8").splitlines() if line.strip()]
    r = get(f"{QDRANT}/collections/kb", timeout=10)
    if r.status != 200:
        fail("Коллекции kb в Qdrant нет: индексация не выполнялась или упала.")
    points = r.json()["result"].get("points_count")
    if points != len(docs):
        fail(f"В коллекции kb {plural(points or 0, 'фрагмент', 'фрагмента', 'фрагментов')}, а документов в базе знаний {len(docs)}.")
    return f"В коллекции kb {plural(points, 'фрагмент', 'фрагмента', 'фрагментов')} — по одному на документ."


@check("recall", "Ассистент находит нужный документ: recall@3 на golden set ≥ 0.8", needs=["index"])
def recall():
    misses = []
    for q, expected in GOLDEN:
        sources = [s.get("doc_id") for s in ask(q).get("sources", [])][:3]
        if expected not in sources:
            misses.append(q)
    hits = len(GOLDEN) - len(misses)
    value = hits / len(GOLDEN)
    if value < 0.8:
        examples = "; ".join(f"«{m}»" for m in misses[:2])
        fail(f"recall@3 = {value:.2f} ({hits} из {len(GOLDEN)}). Например, без нужного источника остались: {examples}.")
    return f"recall@3 = {value:.2f} ({hits} из {len(GOLDEN)})."


@check("off-topic", "На вопросы не по теме ассистент честно отвечает «не нашёл»", needs=["index"])
def off_topic():
    for q in OFF_TOPIC:
        res = ask(q)
        if res.get("found") or res.get("sources"):
            top = res.get("sources", [{}])[0]
            fail(f"На вопрос «{q}» ассистент подставил фрагмент «{top.get('title')}» (score {top.get('score')}).")
    return f"На все вопросы не по теме ({len(OFF_TOPIC)}) ответ «не нашёл»."
