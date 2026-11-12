"""Проверки инцидента linux-systemd-unit. Выполняются внутри учебного сервера."""

import os
import pwd
import signal
import subprocess

from incident_kit import RequestError, check, fail, get, wait_for

UNIT = "reports"


def show(prop: str) -> str:
    return subprocess.run(["systemctl", "show", "-p", prop, "--value", UNIT], capture_output=True, text=True).stdout.strip()


def healthy() -> bool:
    try:
        return get("http://127.0.0.1:9000/health", timeout=3).status == 200
    except RequestError:
        return False


@check("running", "Сервис отчётов запущен и отвечает на /health", live=True)
def running():
    state = show("ActiveState")
    if state != "active":
        result = show("Result")
        fail(f"Сервис {UNIT} в состоянии {state} (result={result}).")
    if not wait_for(healthy, timeout=10, interval=1):
        fail("Сервис активен, но http://127.0.0.1:9000/health не отвечает 200.")
    return "reports активен, /health → 200."


@check("user", "Сервис работает от пользователя reportsvc, а не от root", needs=["running"], live=True)
def user():
    pid = int(show("MainPID") or 0)
    uid = os.stat(f"/proc/{pid}").st_uid
    name = pwd.getpwuid(uid).pw_name
    if name != "reportsvc":
        fail(f"Процесс сервиса работает от пользователя {name}. По требованиям безопасности — только от reportsvc.")
    return f"Процесс {pid} работает от reportsvc."


@check("enabled", "Сервис включён в автозапуск", live=True)
def enabled():
    state = subprocess.run(["systemctl", "is-enabled", UNIT], capture_output=True, text=True).stdout.strip()
    if state != "enabled":
        fail(f"systemctl is-enabled {UNIT}: {state or 'unknown'} — после перезагрузки сервер поднимется без сервиса отчётов.")
    return "enabled."


@check("restart", "После аварийного завершения systemd поднимает сервис сам за 10 с", needs=["running"])
def restart():
    pid = int(show("MainPID") or 0)
    os.kill(pid, signal.SIGKILL)
    back = wait_for(lambda: show("ActiveState") == "active" and show("MainPID") not in ("0", str(pid)) and healthy(), timeout=10, interval=0.5)
    if not back:
        fail(f"После kill -9 процесса {pid} сервис не поднялся за 10 секунд (состояние: {show('ActiveState')}).")
    return f"После kill -9 сервис поднялся снова, новый PID {show('MainPID')}."
