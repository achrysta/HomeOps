"""Проверки инцидента linux-disk-full. Выполняются внутри учебного сервера."""

import hashlib
import os
import re
import subprocess
from pathlib import Path

from incident_kit import RequestError, check, fail, get

LOG_DIR = "/var/log/payments"


def systemctl_show(unit: str, prop: str) -> str:
    return subprocess.run(["systemctl", "show", "-p", prop, "--value", unit], capture_output=True, text=True).stdout.strip()


@check("api", "API платежей отвечает 200 и пишет журнал запросов", live=True)
def api():
    try:
        r = get("http://127.0.0.1:8080/pay", timeout=5)
    except RequestError as e:
        fail(f"API платежей не отвечает: {e}.")
    if r.status != 200:
        fail(f"API платежей ответил HTTP {r.status}: {r.text[:160]}")
    return "GET /pay → 200."


@check("space", "На разделе /var/log/payments свободно не меньше половины места", live=True)
def space():
    st = os.statvfs(LOG_DIR)
    free = st.f_bavail / st.f_blocks
    if free < 0.5:
        fail(f"Свободно {free:.0%} раздела {LOG_DIR} ({st.f_bavail * st.f_frsize // 2**20} МБ из {st.f_blocks * st.f_frsize // 2**20} МБ).")
    return f"Свободно {free:.0%}."


@check("logger", "Журнал аудита работает, процесс не перезапускали", live=True)
def logger():
    if systemctl_show("payment-logger", "ActiveState") != "active":
        fail("Сервис payment-logger не активен: журнал аудита не пишется.")
    initial = Path("/var/lib/homeops/logger.pid").read_text().strip()
    current = systemctl_show("payment-logger", "MainPID")
    if current != initial:
        fail(f"Сервис payment-logger перезапускали (PID был {initial}, сейчас {current}). По условию процесс аудита останавливать нельзя.")
    return f"payment-logger активен, PID {current} — тот же процесс."


@check("recovered", "Recovery-code из удалённого журнала сохранён в /root/recovered-code.txt", live=True)
def recovered():
    path = Path("/root/recovered-code.txt")
    if not path.exists():
        fail("Файла /root/recovered-code.txt нет.")
    expected = Path("/var/lib/homeops/recovery.sha256").read_text().strip()
    for code in re.findall(r"RC-[0-9A-F]{12}", path.read_text(errors="replace")):
        if hashlib.sha256(code.encode()).hexdigest() == expected:
            return f"Найден верный код {code[:6]}…"
    fail("В /root/recovered-code.txt нет верного recovery-code из удалённого журнала аудита.")
