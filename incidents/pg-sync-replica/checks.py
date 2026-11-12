"""Автопроверка: синхронная репликация PostgreSQL после вывода реплики на обслуживание.

Живые проверки только читают primary. Пробная оплата — в полной проверке: запись кассой в служебную
таблицу probe и поиск этой записи на standby2; зависшая проба отменяется.
"""

from __future__ import annotations

import os
import subprocess
import time
import uuid

from incident_kit import check, fail

SEED = ["R-1001", "R-1002", "R-1003"]
CASHIER = ["R-2001", "R-2002", "R-2003"]


def psql(query: str, *, host: str = "primary", user: str = "lab", password: str = "lab", timeout: float = 3) -> str:
    env = {**os.environ, "PGHOST": host, "PGUSER": user, "PGPASSWORD": password, "PGDATABASE": "shop"}
    try:
        result = subprocess.run(["psql", "-XAtq", "-v", "ON_ERROR_STOP=1", "-c", query], env=env, capture_output=True, text=True, timeout=timeout)
    except subprocess.TimeoutExpired:
        raise TimeoutError(query) from None
    if result.returncode:
        fail(f"{host} не выполнил запрос: {result.stderr.strip()}")
    return result.stdout.strip()


def sql(query: str) -> str:
    try:
        return psql(query)
    except TimeoutError:
        fail("primary не ответил на диагностический запрос за 3 секунды.")


def receipts() -> dict[str, int]:
    rows = sql("SELECT receipt, count(*) FROM payments GROUP BY receipt")
    return {r: int(n) for r, n in (line.split("|") for line in rows.splitlines() if line)}


@check("payments", "Чеки не задвоены, исходные платежи на месте", live=True)
def payments():
    counts = receipts()
    missing = [r for r in SEED if r not in counts]
    if missing:
        fail("Пропали исходные платежи: " + ", ".join(missing) + ".")
    doubled = [f"{r} ×{n}" for r, n in sorted(counts.items()) if n > 1]
    if doubled:
        fail("Чеки пробиты повторно: " + ", ".join(doubled) + ".")
    return f"Платежей {sum(counts.values())}, повторов нет."


@check("durability", "Коммит кассы ждёт подтверждения реплики", live=True)
def durability():
    try:
        mode = psql("SHOW synchronous_commit", user="cashier", password="cashier")
    except TimeoutError:
        fail("Касса не смогла подключиться к primary за 3 секунды.")
    if mode not in ("on", "remote_apply"):
        fail(f"У кассы synchronous_commit = {mode}: подтверждённый клиенту платёж может пропасть при отказе primary.")
    return f"synchronous_commit = {mode} в сеансе кассы."


@check("sync", "Коммиты подтверждает подключённая синхронная реплика", live=True)
def sync():
    names = sql("SHOW synchronous_standby_names")
    if not names:
        fail("Синхронная репликация выключена: коммиты не ждут ни одной реплики.")
    rows = sql("SELECT application_name, state, sync_state FROM pg_stat_replication ORDER BY application_name")
    replicas = [line.split("|") for line in rows.splitlines() if line]
    synced = [name for name, state, mode in replicas if state == "streaming" and mode in ("sync", "quorum")]
    if not synced:
        seen = ", ".join(f"{n} ({m})" for n, _, m in replicas) or "ни одной"
        fail(f"synchronous_standby_names = {names}, но синхронной реплики нет. Подключены: {seen}.")
    return "Синхронно: " + ", ".join(synced) + "."


@check("pending", "Зависших оплат нет, все чеки кассы проведены", live=True)
def pending():
    waiting = sql("SELECT count(*) FROM pg_stat_activity WHERE wait_event = 'SyncRep'")
    if waiting != "0":
        fail(f"Коммиты ждут подтверждения реплики: {waiting} в pg_stat_activity с wait_event = SyncRep.")
    counts = receipts()
    missing = [r for r in CASHIER if r not in counts]
    if missing:
        fail("Оплаты кассы не проведены: " + ", ".join(missing) + ".")
    return "Чеки R-2001–R-2003 проведены по одному разу."


@check("write", "Новая оплата проходит и сразу есть на реплике", needs=["payments", "durability", "sync", "pending"])
def write():
    token = "check-" + uuid.uuid4().hex[:12]
    try:
        psql(f"INSERT INTO probe (token) VALUES ('{token}')", user="cashier", password="cashier", timeout=5)
    except TimeoutError:
        sql(f"SELECT pg_cancel_backend(pid) FROM pg_stat_activity WHERE query LIKE '%{token}%' AND pid <> pg_backend_pid()")
        fail("Пробная оплата не завершилась за 5 секунд: коммит ждёт подтверждения реплики.")
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline:
        try:
            if psql(f"SELECT count(*) FROM probe WHERE token = '{token}'", host="standby2") == "1":
                return "Пробная оплата подтверждена и видна на standby2."
        except TimeoutError:
            pass
        time.sleep(0.5)
    fail("Пробная оплата прошла на primary, но за 5 секунд не появилась на standby2.")
