"""Проверки инцидента pg-slow-query. Выполняются в контейнере инструментов с psql (PGHOST=db)."""

import json
import pathlib
import subprocess

from incident_kit import check, fail

SCENARIO = pathlib.Path("/scenario")
CUSTOMER = 4217


def psql(sql: str, timeout: float = 15) -> str:
    try:
        r = subprocess.run(["psql", "-X", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1", "-c", sql], capture_output=True, text=True, timeout=timeout)
    except subprocess.TimeoutExpired:
        fail(f"Запрос к базе не ответил за {timeout:.0f} с.")
    if r.returncode != 0:
        fail(f"psql: {r.stderr.strip().splitlines()[-1] if r.stderr.strip() else 'ошибка без текста'}")
    return r.stdout.strip()


def report_query() -> str:
    """Запрос отчёта из app/report.sql с подставленным клиентом, без комментариев и точки с запятой."""
    lines = [ln for ln in (SCENARIO / "app/report.sql").read_text(encoding="utf-8").splitlines() if not ln.strip().startswith("--")]
    return " ".join(lines).replace(":customer", str(CUSTOMER)).strip().rstrip(";")


def plan(analyze: bool = False) -> dict:
    opts = "ANALYZE, FORMAT JSON" if analyze else "FORMAT JSON"
    return json.loads(psql(f"EXPLAIN ({opts}) {report_query()}"))[0]


def nodes(node: dict):
    yield node
    for child in node.get("Plans", []):
        yield from nodes(child)


@check("db", "База отвечает", live=True)
def db():
    n = psql("SELECT count(*) FROM orders")
    return f"База отвечает, в orders {int(n):,} строк.".replace(",", " ")


@check("query", "Текст запроса отчёта не изменён", live=True)
def query():
    current = (SCENARIO / "app/report.sql").read_text(encoding="utf-8")
    original = (SCENARIO / ".original/app/report.sql").read_text(encoding="utf-8")
    if current.split() != original.split():
        fail("app/report.sql отличается от исходного. Запрос принадлежит приложению другой команды — чинить нужно базу, а не запрос.")
    return "app/report.sql совпадает с исходным."


@check("invalid", "На таблице orders нет невалидных индексов", needs=["db"], live=True)
def invalid():
    bad = psql("SELECT string_agg(indexrelid::regclass::text, ', ') FROM pg_index WHERE indrelid = 'orders'::regclass AND NOT indisvalid")
    if bad:
        fail(f"На orders есть невалидный индекс: {bad}. Планировщик его не использует, а каждая запись в таблицу его обновляет.")
    return "Все индексы orders валидны."


@check("plan", "Отчёт ищет заказы клиента по индексу, а не перебором таблицы", needs=["db", "query"], live=True)
def plan_check():
    p = plan()["Plan"]
    used = []
    for n in nodes(p):
        if n.get("Relation Name") == "orders" and n["Node Type"] == "Seq Scan":
            fail("План отчёта читает orders целиком (Seq Scan): нет годного индекса, который начинается с customer_id.")
        if n["Node Type"] in ("Index Scan", "Index Only Scan", "Bitmap Index Scan") and "customer_id" in (n.get("Index Cond") or ""):
            used.append(n["Index Name"])
    if not used:
        fail("План отчёта не ищет по customer_id через индекс — значит, перебирает строки по другому индексу.")
    return f"Поиск по индексу {used[0]}."


@check("fast", "Отчёт выполняется быстрее 20 мс", needs=["plan"], live=True)
def fast():
    ms = plan(analyze=True)["Execution Time"]
    if ms >= 20:
        fail(f"Отчёт выполняется {ms:.1f} мс — нужно меньше 20.")
    return f"Отчёт выполняется за {ms:.2f} мс."
