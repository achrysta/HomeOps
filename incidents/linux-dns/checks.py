"""Проверки инцидента linux-dns. Выполняются внутри учебного сервера."""

import socket
import subprocess
from pathlib import Path

from incident_kit import RequestError, check, fail, get

NAME = "billing.internal"


def dns_answer() -> str:
    """Что отвечает DNS сети напрямую — так, как его спрашивает dig."""
    out = subprocess.run(["dig", "+short", "+time=2", "+tries=1", NAME], capture_output=True, text=True).stdout.split()
    return out[0] if out else ""


def nss_answer(name: str) -> str:
    """Что получает приложение: getaddrinfo идёт через NSS (/etc/nsswitch.conf) — как getent hosts."""
    try:
        return socket.getaddrinfo(name, None, socket.AF_INET)[0][4][0]
    except OSError:
        return ""


@check("resolve", "Приложения резолвят billing.internal так же, как DNS", live=True)
def resolve():
    want = dns_answer()
    if not want:
        fail(f"DNS сети не отвечает на {NAME} — перезапустите стенд.")
    got = nss_answer(NAME)
    if not got:
        fail(f"dig находит {NAME} ({want}), а приложения на сервере — нет (getent hosts {NAME} пусто).")
    if got != want:
        fail(f"Приложения получают для {NAME} адрес {got}, а DNS отвечает {want}.")
    if not nss_answer("localhost"):
        fail("Перестал резолвиться localhost: локальные имена из /etc/hosts тоже нужны.")
    return f"{NAME} → {got}, как в DNS."


@check("checkout", "Оформление заказов видит биллинг", needs=["resolve"], live=True)
def checkout():
    try:
        r = get("http://127.0.0.1:8090/", timeout=8)
    except RequestError as e:
        fail(f"checkout не отвечает: {e}")
    if r.status != 200:
        fail(f"checkout отвечает {r.status}: {r.text[:200].strip()}")
    return r.text.strip()[:80]


@check("no-pin", "Адрес биллинга не прибит в /etc/hosts", needs=["checkout"], live=True)
def no_pin():
    pinned = [line.strip() for line in Path("/etc/hosts").read_text().splitlines() if NAME in line.split("#")[0].split()]
    if pinned:
        fail(f"В /etc/hosts есть запись «{pinned[0][:80]}». Адрес биллинга меняется при переезде — имя должно резолвиться через DNS.")
    return f"{NAME} в /etc/hosts не прописан."
