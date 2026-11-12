"""Проверки инцидента linux-journald. Выполняются внутри учебного сервера."""

import re
import shutil
import subprocess
from pathlib import Path

from incident_kit import RequestError, check, fail, get, plural

LOG = Path("/var/log")
JOURNAL = LOG / "journal"
MAX_JOURNAL = 32 * 2**20  # журнал — не больше трети раздела /var/log (96 МБ)
UNITS = {"K": 2**10, "M": 2**20, "G": 2**30, "T": 2**40}


def run(*args: str) -> str:
    return subprocess.run(args, capture_output=True, text=True, timeout=15).stdout


def size(value: str) -> int | None:
    m = re.fullmatch(r"\s*(\d+(?:\.\d+)?)\s*([KMGT]?)\s*", value or "", re.I)
    return int(float(m.group(1)) * UNITS.get(m.group(2).upper(), 1)) if m else None


def journald_conf() -> dict[str, str]:
    """Итоговые настройки journald: основной файл и drop-in, последнее значение побеждает."""
    conf: dict[str, str] = {}
    section = ""
    for line in run("systemd-analyze", "cat-config", "systemd/journald.conf").splitlines():
        line = line.strip()
        if not line or line[0] in "#;":
            continue
        if line.startswith("["):
            section = line
        elif section == "[Journal]" and "=" in line:
            key, value = line.split("=", 1)
            conf[key.strip()] = value.strip()
    return conf


def du(path: Path) -> int:
    return sum(f.stat().st_blocks * 512 for f in path.rglob("*") if f.is_file()) if path.exists() else 0


@check("api", "API заказов отвечает", live=True)
def api():
    try:
        r = get("http://127.0.0.1:8095/", timeout=5)
    except RequestError as e:
        fail(f"orders-api не отвечает: {e}")
    if r.status != 200:
        fail(f"orders-api отвечает {r.status}: {r.text.strip()[:160]}")
    return "orders-api: 200"


@check("space", "На /var/log есть запас места", needs=["api"], live=True)
def space():
    u = shutil.disk_usage(LOG)
    free = u.free / u.total
    if free < 0.3:
        fail(f"На /var/log свободно {free:.0%} ({u.free // 2**20} МБ из {u.total // 2**20}) — при таком запасе место снова кончится.")
    return f"на /var/log свободно {free:.0%}"


@check("journal-limit", "Размер журнала systemd ограничен", needs=["space"], live=True)
def journal_limit():
    conf = journald_conf()
    limit = size(conf.get("SystemMaxUse", ""))
    if limit is not None and limit > MAX_JOURNAL:
        fail(f"Журналу systemd разрешено занять до {conf['SystemMaxUse']}, а весь раздел /var/log — 96 МБ: место снова кончится.")
    used = du(JOURNAL)
    if used > MAX_JOURNAL * 1.25:
        fail(f"Журнал уже занимает {used // 2**20} МБ — больше, чем ему можно.")
    return f"журнал: {used // 2**20} МБ, предел {conf.get('SystemMaxUse') or 'по умолчанию (10% раздела)'}"


@check("noise", "Синхронизация цен не засыпает журнал отладкой", needs=["journal-limit"], live=True)
def noise():
    lines = len(run("journalctl", "-u", "price-sync", "--since", "-5s", "-q", "-o", "cat").splitlines())
    if lines > 100:
        fail(f"price-sync пишет в журнал {plural(lines, 'строку', 'строки', 'строк')} за 5 секунд — журнал снова вырастет, как только освободится место.")
    return f"price-sync: {plural(lines, 'строка', 'строки', 'строк')} за 5 секунд"


@check("storage", "Журнал на диске, синхронизация цен работает", needs=["noise"], live=True)
def storage():
    mode = journald_conf().get("Storage", "auto").lower()
    if mode not in ("persistent", "auto") or not any(JOURNAL.rglob("*.journal")):
        fail(f"Журнал systemd хранится не на диске (Storage={mode}): после перезагрузки логи для расследований пропадут.")
    if run("systemctl", "is-active", "price-sync").strip() != "active":
        fail("price-sync остановлен — синхронизация цен нужна магазину, её не выключают.")
    return f"Storage={mode}, price-sync работает"
