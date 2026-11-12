"""Проверки инцидента linux-oom. Выполняются внутри учебного сервера."""

import subprocess
import time
from pathlib import Path

from incident_kit import RequestError, check, fail, get, wait_for

UNIT = "search-index"
LIMIT = 128 * 2**20


def show(prop: str) -> str:
    return subprocess.run(["systemctl", "show", "-p", prop, "--value", UNIT], capture_output=True, text=True).stdout.strip()


def healthy() -> bool:
    try:
        return get("http://127.0.0.1:8085/health", timeout=3).status == 200
    except RequestError:
        return False


@check("limit", "Лимит памяти сервиса остался 128 МБ, без swap", live=True)
def limit():
    mem, swap = show("MemoryMax"), show("MemorySwapMax")
    if mem != str(LIMIT):
        fail(f"У {UNIT} MemoryMax={mem}, а по требованию эксплуатации лимит — 128 МБ: сервис делит сервер с другими.")
    if swap != "0":
        fail(f"У {UNIT} MemorySwapMax={swap}: уход в swap по требованию эксплуатации запрещён — поиск должен отвечать быстро.")
    return "MemoryMax=128M, MemorySwapMax=0."


@check("running", "Сервис поиска запущен и отвечает на /health", needs=["limit"], live=True)
def running():
    state = show("ActiveState")
    if state != "active":
        fail(f"{UNIT} в состоянии {state} (result={show('Result')}).")
    if not wait_for(healthy, timeout=20, interval=1):
        fail(f"{UNIT} активен, но http://127.0.0.1:8085/health не отвечает — возможно, ещё прогревается или снова упал (result={show('Result')}).")
    return f"{UNIT} отвечает на /health."


@check("headroom", "Памяти хватает с запасом", needs=["running"], live=True)
def headroom():
    # пик с последнего запуска — memory.peak cgroup сервиса; если файла нет, текущее потребление
    peak = Path(f"/sys/fs/cgroup/system.slice/{UNIT}.service/memory.peak")
    raw = peak.read_text().strip() if peak.exists() else show("MemoryCurrent")
    used = int(raw) if raw.isdigit() else 0
    if used > LIMIT * 0.85:
        fail(f"Пиковое потребление {used // 2**20} МБ при лимите 128 МБ — запаса почти нет, следующий рост каталога снова приведёт к OOM.")
    return f"пик {used // 2**20} МБ из 128 МБ."


@check("stable", "Сервис не перезапускается 30 секунд", needs=["running"])
def stable():
    restarts = show("NRestarts")
    deadline = time.monotonic() + 30
    while time.monotonic() < deadline:
        if show("NRestarts") != restarts or show("ActiveState") != "active":
            fail(f"{UNIT} перезапустился во время проверки (result={show('Result')}).")
        time.sleep(2)
    if not healthy():
        fail(f"Через 30 секунд {UNIT} не отвечает на /health.")
    return f"{UNIT} работает 30 секунд без перезапусков."
