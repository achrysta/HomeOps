"""Проверки инцидента train-serve-skew: онлайн-предсказания должны совпадать с офлайн-выгрузкой из ноутбука."""

import json
from pathlib import Path

from incident_kit import check, fail, http

API = "http://model-api:8000"
ROWS = [json.loads(line) for line in Path("/scenario/data/offline_predictions.jsonl").read_text(encoding="utf-8").splitlines() if line.strip()]
TOLERANCE = 1e-3


def has_missing(row: dict) -> bool:
    return any(v is None for v in row["request"].values())


def parity(rows: list[dict]) -> tuple[int, float, dict | None]:
    """(сколько совпало, максимальное расхождение, пример расхождения)."""
    matched, worst, example = 0, 0.0, None
    for row in rows:
        r = http("POST", f"{API}/predict", body=row["request"], timeout=10)
        if r.status != 200:
            fail(f"Сервис ответил HTTP {r.status} на запрос {row['request']}: {r.text[:200]}")
        online = r.json().get("churn_probability")
        diff = abs((online if isinstance(online, (int, float)) else -1) - row["churn_probability"])
        if diff < TOLERANCE:
            matched += 1
        elif diff > worst:
            worst, example = diff, {"customer": row["request"]["customer_id"], "offline": row["churn_probability"], "online": online}
    return matched, worst, example


def describe(matched: int, total: int, worst: float, example: dict | None) -> str:
    text = f"Совпадает {matched} из {total} предсказаний (|Δ| < {TOLERANCE}), максимальное расхождение {worst:.3f}"
    if example:
        text += f": клиент {example['customer']} — офлайн {example['offline']:.3f}, онлайн {example['online']}"
    return text + "."


@check("parity", "Онлайн-предсказания совпадают с офлайн-выгрузкой на полных данных")
def parity_full():
    rows = [r for r in ROWS if not has_missing(r)]
    matched, worst, example = parity(rows)
    if matched < len(rows):
        fail(describe(matched, len(rows), worst, example))
    return f"Совпадают все {len(rows)} предсказаний на строках без пропусков."


@check("missing", "Строки с пропусками обрабатываются так же, как при обучении")
def parity_missing():
    rows = [r for r in ROWS if has_missing(r)]
    matched, worst, example = parity(rows)
    if matched < len(rows):
        fail(describe(matched, len(rows), worst, example))
    return f"Совпадают все {len(rows)} предсказаний на строках с пропусками."
