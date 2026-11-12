"""Зал gym-linux-diag: ответы в файлах /answers/… сверяются с текущим состоянием учебного сервера.

Проверки выполняются внутри сервера (verify --live), поэтому видят /proc, systemd и файлы ответов.
Каждый подход зависит от предыдущего (needs): дашборд засчитывает подходы по порядку.
"""

import os
import re
import subprocess
from pathlib import Path

from incident_kit import check, fail

ANSWERS = Path("/answers")
APP_DATA = Path("/var/lib/app")
RESTART = "начните сессию заново, чтобы вернуть исходное состояние сервера"


def answer(name: str) -> str:
    f = ANSWERS / name
    if not f.exists():
        fail(f"Файла /answers/{name} пока нет.")
    text = f.read_text(encoding="utf-8", errors="replace").strip()
    if not text:
        fail(f"Файл /answers/{name} пустой.")
    return text


def unit_name(text: str) -> str:
    """Имя юнита без суффикса .service — так пишут и так, и так."""
    return text.strip().removesuffix(".service")


def run(*args: str) -> str:
    return subprocess.run(args, capture_output=True, text=True, timeout=10).stdout


def listener_pid(port: int) -> int | None:
    m = re.search(r"pid=(\d+)", run("ss", "-ltnpH", f"sport = :{port}"))
    return int(m.group(1)) if m else None


def unit_of(pid: int) -> str:
    """Юнит systemd процесса — по его cgroup (0::/system.slice/<юнит>.service)."""
    try:
        path = Path(f"/proc/{pid}/cgroup").read_text().strip().splitlines()[-1].split("::", 1)[-1]
    except OSError:
        return ""
    return unit_name(path.rsplit("/", 1)[-1])


@check("port", "Кто слушает порт", live=True)
def port():
    pid = listener_pid(8081)
    if pid is None:
        fail(f"Порт 8081 сейчас никто не слушает — {RESTART}.")
    want = unit_of(pid)
    got = unit_name(answer("port-8081"))
    if got != want:
        fail(f"В /answers/port-8081 записано «{got[:40]}» — это не юнит, процесс которого слушает порт 8081.")
    return f"порт 8081 слушает {want}.service (PID {pid})"


@check("failed-unit", "Какой сервис упал", needs=["port"], live=True)
def failed_unit():
    failed = [unit_name(line.split()[0]) for line in run("systemctl", "list-units", "--state=failed", "--no-legend", "--plain").splitlines() if line.strip()]
    if "report-sync" not in failed:
        fail(f"Сервис, который упал при старте сервера, уже не в состоянии failed — {RESTART}.")
    got = unit_name(answer("failed-unit"))
    if got != "report-sync":
        fail(f"В /answers/failed-unit записано «{got[:40]}» — этот юнит не в состоянии failed.")
    return "report-sync.service в состоянии failed"


@check("missing-file", "Почему он упал", needs=["failed-unit"], live=True)
def missing_file():
    got = answer("missing-file").rstrip("/")
    if got != "/etc/report-sync/token":
        fail(f"В /answers/missing-file записано «{got[:60]}» — сервис упал не из-за этого. Он сам пишет причину при запуске.")
    return "сервису не хватило /etc/report-sync/token"


def dir_size(path: Path) -> int:
    """Занятое место (блоки), как считает du: без перехода по ссылкам."""
    total = 0
    for root, _dirs, files in os.walk(path):
        for name in files:
            try:
                total += os.lstat(os.path.join(root, name)).st_blocks * 512
            except OSError:
                pass
    return total


@check("big-dir", "Кто занял место", needs=["missing-file"], live=True)
def big_dir():
    sizes = {p.name: dir_size(p) for p in APP_DATA.iterdir() if p.is_dir()} if APP_DATA.exists() else {}
    if not sizes:
        fail(f"В {APP_DATA} нет каталогов — {RESTART}.")
    want = max(sizes, key=sizes.get)
    raw = answer("big-dir").rstrip("/")
    got = raw if raw.startswith("/") else f"{APP_DATA}/{raw}"
    if got != f"{APP_DATA}/{want}":
        fail(f"В /answers/big-dir записано «{raw[:60]}» — это не самый большой каталог в {APP_DATA}.")
    return f"больше всего занимает {APP_DATA}/{want}: {sizes[want] // 2**20} МБ"


def deleted_holders() -> dict[int, str]:
    """PID → удалённый файл, который процесс держит открытым (как lsof +L1)."""
    holders: dict[int, str] = {}
    for proc in Path("/proc").iterdir():
        if not proc.name.isdigit():
            continue
        try:
            for fd in (proc / "fd").iterdir():
                target = os.readlink(fd)
                if target.startswith("/var/log/") and target.endswith(" (deleted)"):
                    holders[int(proc.name)] = target.removesuffix(" (deleted)")
        except OSError:
            continue
    return holders


@check("holder-pid", "Кто держит удалённый файл", needs=["big-dir"], live=True)
def holder_pid():
    holders = deleted_holders()
    if not holders:
        fail(f"Сейчас ни один процесс не держит удалённый файл в /var/log — {RESTART}.")
    got = answer("holder-pid")
    if not got.isdigit() or int(got) not in holders:
        fail(f"В /answers/holder-pid записано «{got[:40]}» — этот процесс не держит удалённый файл.")
    return f"PID {got} держит удалённый {holders[int(got)]}"
