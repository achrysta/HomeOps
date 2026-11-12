"""Проверки инцидента linux-open-files. Выполняются внутри учебного сервера."""

import re
import selectors
import socket
import subprocess
import time
from pathlib import Path

from incident_kit import check, fail, wait_for

UNIT = "notify-hub"
PORT = 7000
NEED = 4096
CLIENTS = 400


def show(prop: str) -> str:
    return subprocess.run(["systemctl", "show", "-p", prop, "--value", UNIT], capture_output=True, text=True).stdout.strip()


def greet(timeout: float = 3) -> bool:
    try:
        with socket.create_connection(("127.0.0.1", PORT), timeout=timeout) as s:
            return s.recv(32).startswith(b"OK")
    except OSError:
        return False


def process_limit(pid: str) -> int:
    text = Path(f"/proc/{pid}/limits").read_text()
    m = re.search(r"Max open files\s+(\S+)", text)
    return 10**9 if not m or m.group(1) == "unlimited" else int(m.group(1))


@check("running", "Сервис уведомлений запущен и принимает подписчиков", live=True)
def running():
    if show("ActiveState") != "active":
        fail(f"{UNIT} в состоянии {show('ActiveState')} (result={show('Result')}).")
    if not wait_for(greet, timeout=10, interval=1):
        fail(f"{UNIT} активен, но порт {PORT} не отвечает приветствием.")
    return f"{UNIT} активен, порт {PORT} отвечает."


@check("limit", f"Процесс может держать не меньше {NEED} открытых файлов", needs=["running"], live=True)
def limit():
    pid = show("MainPID")
    n = process_limit(pid)
    if n < NEED:
        fail(f"У процесса {UNIT} (PID {pid}) лимит открытых файлов {n} — каждое соединение подписчика занимает дескриптор, под нагрузкой его не хватит.")
    return f"PID {pid}: лимит открытых файлов {n}."


@check("persistent", "Лимит задан в конфигурации сервиса и переживёт перезапуск", needs=["limit"], live=True)
def persistent():
    raw = show("LimitNOFILE")
    n = 10**9 if raw == "infinity" else int(raw or 0)
    if n < NEED:
        fail(f"Лимит поднят только у работающего процесса, а в конфигурации systemd LimitNOFILE={raw}: после перезапуска сервиса он вернётся.")
    return f"systemd: LimitNOFILE={raw}."


def subscribers(n: int, deadline: float = 6.0) -> int:
    """Открыть n подписчиков одновременно; сколько получили приветствие за deadline секунд."""
    sel = selectors.DefaultSelector()
    socks = []
    try:
        for _ in range(n):
            s = socket.socket()
            s.setblocking(False)
            s.connect_ex(("127.0.0.1", PORT))
            socks.append(s)
            sel.register(s, selectors.EVENT_READ)
        ok, end = 0, time.monotonic() + deadline
        while sel.get_map() and (left := end - time.monotonic()) > 0:
            for key, _ in sel.select(timeout=left):
                try:
                    ok += key.fileobj.recv(32).startswith(b"OK")
                except OSError:
                    pass
                sel.unregister(key.fileobj)
        return ok
    finally:
        for s in socks:
            s.close()
        sel.close()


@check("load", f"Держит {CLIENTS} подписчиков одновременно", needs=["persistent"])
def load():
    ok = subscribers(CLIENTS)
    if ok < CLIENTS:
        fail(f"Приветствие получили {ok} из {CLIENTS} подписчиков — остальным сервис не ответил.")
    if show("ActiveState") != "active":
        fail(f"После нагрузки {UNIT} в состоянии {show('ActiveState')}.")
    return f"{ok} из {CLIENTS} подписчиков подключены одновременно."
