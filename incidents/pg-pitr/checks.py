"""Checks a real PostgreSQL recovery on a separate instance."""

import os
from pathlib import Path
import subprocess

from incident_kit import check, fail


def sql(host: str, query: str) -> str:
    try:
        result = subprocess.run(
            ["psql", "-h", host, "-XAtq", "-v", "ON_ERROR_STOP=1", "-c", query],
            env={**os.environ, "PGOPTIONS": "-c statement_timeout=1500"},
            capture_output=True, text=True, timeout=3,
        )
    except subprocess.TimeoutExpired:
        fail(f"{host}: диагностический запрос не ответил.")
    if result.returncode:
        fail(f"{host}: PostgreSQL не выполнил запрос: {result.stderr.strip()}")
    return result.stdout.strip()


def baseline() -> tuple[str, ...]:
    path = Path("/backup/current/expected")
    if not path.is_file():
        fail("Базовая копия и архив WAL ещё готовятся.")
    return tuple(path.read_text().strip().split("|"))


def rows(host: str) -> str:
    return sql(host, "SELECT event, ticket FROM ledger ORDER BY event")


@check("source", "Исходная база осталась в состоянии после инцидента", live=True)
def source():
    sysid, _, _, _, _, post_delete = baseline()
    if sql("source", "SELECT system_identifier, pg_is_in_recovery() FROM pg_control_system()") != f"{sysid}|f":
        fail("Исходная база была заменена или находится в recovery.")
    if rows("source") != f"after_delete|{post_delete}":
        fail("Содержимое исходной базы изменилось. Восстанавливайте на отдельной копии.")
    return "Исходная база продолжает отвечать с исходным состоянием инцидента."


@check("copy", "Отдельная копия запущена из физического бэкапа", live=True)
def copy():
    sysid, *_ = baseline()
    copied = sql("restore", "SELECT system_identifier, inet_server_addr() FROM pg_control_system()")
    original = sql("source", "SELECT system_identifier, inet_server_addr() FROM pg_control_system()")
    if not copied.startswith(f"{sysid}|") or copied == original:
        fail("Копия не является отдельным экземпляром из исходного физического бэкапа.")
    return "Отдельный экземпляр отвечает с идентификатором исходного кластера."


@check("boundary", "Воспроизведён WAL до точки перед удалением", needs=["copy"], live=True)
def boundary():
    _, before, after, *_ = baseline()
    # LSN получены от PostgreSQL при подготовке архива, а не из пользовательского конфига.
    if sql("restore", f"""
        SELECT coalesce(pg_last_wal_replay_lsn() >= '{before}'::pg_lsn
                    AND pg_last_wal_replay_lsn() < '{after}'::pg_lsn, false)
    """) != "t":
        fail("Позиция воспроизведения не попала в окно после контрольной точки и до DELETE.")
    return "Позиция воспроизведения находится в нужном интервале WAL."


@check("data", "На копии есть обе исходные записи с точными значениями", needs=["copy"], live=True)
def data():
    _, _, _, opening, approved, _ = baseline()
    if rows("restore") != f"approved|{approved}\nopening|{opening}":
        fail("Набор записей на копии отличается от состояния до удаления.")
    return "Обе записи и их исходные UUID восстановлены."


@check("promoted", "Копия вышла из recovery и готова к записи", needs=["boundary", "data"], live=True)
def promoted():
    if sql("restore", "SELECT NOT pg_is_in_recovery() AND current_setting('transaction_read_only') = 'off'") != "t":
        fail("Копия достигла цели, но пока остаётся в режиме восстановления или только чтения.")
    return "Копия вышла из recovery и допускает запись."
