"""Автопроверка: витрина отчётов на логической репликации догоняет биллинг без потери счетов.

Живые проверки сравнивают таблицы. Пробная запись — в полной проверке: строка в служебной таблице probe
публикатора должна дойти до витрины; дошедшая проба удаляется.
"""

from __future__ import annotations

import os
import subprocess
import time
import uuid

from incident_kit import check, fail

INVOICES = {
    1: ("ООО Ромашка", 4800), 2: ("ИП Соколов", 1200), 3: ("ООО Вектор", 7500),
    4: ("ООО Альфа", 5200), 5: ("ИП Борисов", 830), 6: ("ООО Гамма", 12900),
}


def sql(host: str, query: str) -> str:
    env = {**os.environ, "PGHOST": host}
    try:
        result = subprocess.run(["psql", "-XAtq", "-v", "ON_ERROR_STOP=1", "-c", query], env=env, capture_output=True, text=True, timeout=3)
    except subprocess.TimeoutExpired:
        fail(f"{host} не ответил на запрос за 3 секунды.")
    if result.returncode:
        fail(f"{host} не выполнил запрос: {result.stderr.strip()}")
    return result.stdout.strip()


def invoices(host: str) -> dict[int, tuple[str, int]]:
    rows = sql(host, "SELECT id, customer, total FROM invoices ORDER BY id")
    return {int(i): (c, int(t)) for i, c, t in (line.split("|") for line in rows.splitlines() if line)}


def ids(values: list[int]) -> str:
    return ", ".join(map(str, values))


@check("publisher", "Счета биллинга на месте и не изменены", live=True)
def publisher():
    actual = invoices("publisher")
    missing = [i for i in INVOICES if i not in actual]
    changed = [i for i in INVOICES if i in actual and actual[i] != INVOICES[i]]
    if missing or changed:
        parts = ([f"удалены {ids(missing)}"] if missing else []) + ([f"изменены {ids(changed)}"] if changed else [])
        fail("Счета биллинга — источник истины, а в них " + "; ".join(parts) + ".")
    return f"Счета 1–6 на месте, всего в биллинге {len(actual)}."


@check("data", "Витрина совпадает с биллингом", live=True)
def data():
    source, mart = invoices("publisher"), invoices("subscriber")
    missing = [i for i in source if i not in mart]
    extra = [i for i in mart if i not in source]
    differ = [i for i in source if i in mart and mart[i] != source[i]]
    parts = []
    if missing:
        parts.append(("нет счёта " if len(missing) == 1 else "нет счетов ") + ids(missing))
    if differ:
        detail = "; ".join(f"{i}: на витрине {mart[i][0]}, {mart[i][1]} — в биллинге {source[i][0]}, {source[i][1]}" for i in differ)
        parts.append(("отличается счёт " if len(differ) == 1 else "отличаются счета ") + detail)
    if extra:
        parts.append(("лишний счёт " if len(extra) == 1 else "лишние счета ") + ids(extra))
    if parts:
        fail("Витрина расходится с биллингом: " + "; ".join(parts) + ".")
    return f"Все {len(source)} счетов совпадают."


@check("flow", "Новые изменения биллинга доходят до витрины", needs=["publisher"])
def flow():
    token = "check-" + uuid.uuid4().hex[:12]
    sql("publisher", f"INSERT INTO probe (token) VALUES ('{token}')")
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        if sql("subscriber", f"SELECT count(*) FROM probe WHERE token = '{token}'") == "1":
            sql("publisher", f"DELETE FROM probe WHERE token = '{token}'")
            return "Пробная запись дошла до витрины."
        time.sleep(0.5)
    fail("Пробная запись биллинга за 10 секунд не дошла до витрины: подписка не применяет изменения.")
