"""Проверки инцидента linux-cron-path. Выполняются внутри учебного сервера."""

import subprocess
import time
from pathlib import Path

from incident_kit import STATE, check, fail, log, wait_for

BACKUPS = Path("/var/backups/db")


def login_shell(cmd: str) -> subprocess.CompletedProcess:
    # как новый терминал: чистое окружение и login-shell, который читает профиль root
    return subprocess.run(["env", "-i", "HOME=/root", "TERM=xterm", "/bin/bash", "-lic", cmd], capture_output=True, text=True, timeout=20)


@check("shell", "В новом терминале работают стандартные команды и инструменты бэкапа", live=True)
def shell():
    missing = [c for c in ("ls", "grep", "curl", "systemctl", "backup-tool") if login_shell(f"type -P {c}").returncode != 0]
    if missing:
        fail(f"В новом login-shell root не находятся команды: {', '.join(missing)}.")
    return "ls, grep, curl, systemctl и backup-tool находятся в новом терминале."


@check("cron", "Бэкап по расписанию cron создаёт новый файл")
def cron():
    started = time.time()
    log("ждём ближайший запуск cron (до 75 секунд)")
    newest = wait_for(lambda: next((p for p in sorted(BACKUPS.glob("*.sql"), key=lambda p: p.stat().st_mtime, reverse=True) if p.stat().st_mtime >= started), None),
                      timeout=75, interval=3, progress="ждём файл бэкапа")
    if not newest:
        fail("За 75 секунд в /var/backups/db не появилось нового файла бэкапа. Задача cron не отработала.")
    STATE["backup"] = newest
    return f"Новый файл {newest.name} создан cron."


@check("valid", "Файл бэкапа полный: заголовок дампа и данные", needs=["cron"])
def valid():
    path: Path = STATE["backup"]
    text = path.read_text(errors="replace")
    if not text.startswith("-- DB-BACKUP v1") or text.count("INSERT INTO") < 200:
        fail(f"Файл {path.name} создан, но дамп неполный ({path.stat().st_size} байт): скрипт бэкапа завершился с ошибкой.")
    return f"{path.name}: {path.stat().st_size} байт, дамп полный."
