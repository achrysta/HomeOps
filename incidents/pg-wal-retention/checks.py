"""Read-only diagnostics for the WAL retention incident."""

import os
import subprocess

from incident_kit import check, fail


def sql(query: str) -> str:
    try:
        result = subprocess.run(
            ["psql", "-XAtq", "-v", "ON_ERROR_STOP=1", "-c", query],
            env={**os.environ, "PGOPTIONS": "-c statement_timeout=1800"},
            capture_output=True, text=True, timeout=3,
        )
    except subprocess.TimeoutExpired:
        fail("PostgreSQL не ответил на диагностический запрос.")
    if result.returncode:
        fail("PostgreSQL не выполнил запрос: " + result.stderr.strip())
    return result.stdout.strip()


@check("db", "PostgreSQL отвечает, исходные заказы на месте", live=True)
def database():
    if sql("SELECT id, amount FROM orders ORDER BY id") != "1|480\n2|1200\n3|750":
        fail("Исходные заказы изменились.")
    return "Исходные заказы доступны."


@check("retired", "Выведенный из эксплуатации слот удалён", needs=["db"], live=True)
def retired():
    if sql("SELECT slot_name FROM pg_replication_slots WHERE slot_name = 'legacy_export'"):
        fail("Слот legacy_export всё ещё зарегистрирован.")
    return "Выведенного из эксплуатации слота больше нет."


@check("protected", "Слот orders_dr пригоден и сохраняет исходную точку", needs=["db"], live=True)
def protected():
    if sql("""
        SELECT count(*) FROM pg_replication_slots s CROSS JOIN fixture.baseline b
        WHERE s.slot_name = 'orders_dr' AND s.slot_type = 'physical' AND NOT s.temporary
          AND s.restart_lsn = b.protected_lsn AND s.wal_status IN ('reserved', 'extended')
    """) != "1":
        fail("Слот orders_dr отсутствует, непригоден или потерял исходную точку.")
    return "Слот аварийной реплики и его исходный WAL сохранены."


@check("released", "Старый сегмент больше не удерживается на диске", needs=["retired", "protected"], live=True)
def released():
    if sql("SELECT name FROM pg_ls_waldir() WHERE name = (SELECT old_wal FROM fixture.baseline)"):
        fail("Старый WAL-сегмент всё ещё лежит в pg_wal.")
    return "Старый сегмент освобождён."
