"""Проверки инцидента linux-tls. Выполняются внутри учебного сервера.

TLS проверяется так же, как его видят клиенты партнёра: только по корневому CA компании, без системного
хранилища и без загрузки недостающих промежуточных сертификатов. Ключи CA уничтожены при подготовке, поэтому
пройти проверку могут только выпущенные компанией сертификаты.
"""

import hashlib
import socket
import ssl
import subprocess
import time
from datetime import datetime, timezone
from pathlib import Path

from incident_kit import check, fail

ROOT_CA = "/etc/ssl/shop-ca/root.pem"
CLIENT_MARKS = Path("/var/lib/homeops/linux-tls/client.sha256")
STATE = Path("/run/partner-sync/state")
MIN_DAYS = 30


def handshake(host: str) -> tuple[str | None, bytes | None]:
    """(ошибка проверки сертификата или None, отданный сертификат в DER)."""
    ctx = ssl.create_default_context(cafile=ROOT_CA)
    try:
        with socket.create_connection(("127.0.0.1", 443), timeout=5) as sock, ctx.wrap_socket(sock, server_hostname=host) as tls:
            return None, tls.getpeercert(binary_form=True)
    except ssl.SSLCertVerificationError as e:
        error = e.verify_message or str(e)
    except (OSError, ssl.SSLError) as e:
        return f"соединение с 127.0.0.1:443 не установлено: {e}", None
    raw = ssl.create_default_context()
    raw.check_hostname, raw.verify_mode = False, ssl.CERT_NONE
    with socket.create_connection(("127.0.0.1", 443), timeout=5) as sock, raw.wrap_socket(sock, server_hostname=host) as tls:
        return error, tls.getpeercert(binary_form=True)


def not_after(der: bytes) -> datetime:
    out = subprocess.run(["openssl", "x509", "-inform", "DER", "-noout", "-enddate"], input=der, capture_output=True).stdout.decode()
    return datetime.strptime(out.strip().split("=", 1)[1], "%b %d %H:%M:%S %Y %Z").replace(tzinfo=timezone.utc)


def valid_for(host: str) -> str:
    error, _ = handshake(host)
    if error:
        fail(f"https://{host}: проверка сертификата не проходит — {error.rstrip('.')}.")
    return f"https://{host}: сертификат проверяется по корневому CA компании."


@check("nginx", "nginx работает и его конфигурация корректна", live=True)
def nginx():
    state = subprocess.run(["systemctl", "is-active", "nginx"], capture_output=True, text=True).stdout.strip()
    test = subprocess.run(["nginx", "-t"], capture_output=True, text=True)
    if test.returncode != 0:
        fail(f"nginx -t не проходит: {test.stderr.strip().splitlines()[-2 if len(test.stderr.strip().splitlines()) > 1 else -1]}")
    if state != "active":
        fail(f"nginx в состоянии {state}.")
    return "nginx работает, nginx -t проходит."


@check("shop", "Витрина shop.example.test отдаёт сертификат, которому доверяют клиенты", needs=["nginx"], live=True)
def shop():
    return valid_for("shop.example.test")


@check("api", "API api.shop.example.test отдаёт сертификат, которому доверяют клиенты", needs=["nginx"], live=True)
def api():
    return valid_for("api.shop.example.test")


@check("expiry", f"Отданные сертификаты действуют ещё не меньше {MIN_DAYS} дней", needs=["shop", "api"], live=True)
def expiry():
    left = {}
    for host in ("shop.example.test", "api.shop.example.test"):
        _, der = handshake(host)
        left[host] = (not_after(der) - datetime.now(timezone.utc)).days
    short = [f"{h} — {d} дн." for h, d in left.items() if d < MIN_DAYS]
    if short:
        fail(f"Сертификаты скоро истекут: {', '.join(short)}.")
    return ", ".join(f"{h}: ещё {d} дн." for h, d in left.items())


@check("trust", "Клиент партнёра проверяет сертификаты по CA компании, как раньше", live=True)
def trust():
    try:
        marks = dict(line.split()[::-1] for line in CLIENT_MARKS.read_text().splitlines() if line.strip())
    except OSError:
        fail("Нет отметки исходного состояния клиента: пересоздайте стенд («Сбросить»).")
    changed = [path for path, digest in marks.items() if not Path(path).exists() or hashlib.sha256(Path(path).read_bytes()).hexdigest() != digest]
    if changed:
        fail(f"Изменены файлы клиента партнёра: {', '.join(changed)}. Чинить нужно сервер, а не отключать проверку сертификата у клиента.")
    return "partner-sync и его доверенный CA не изменены."


@check("partner", "partner-sync получает заказы из API", needs=["api", "trust"], live=True)
def partner():
    if subprocess.run(["systemctl", "is-active", "partner-sync"], capture_output=True, text=True).stdout.strip() != "active":
        fail("partner-sync не запущен.")
    try:
        stamp, message = STATE.read_text().strip().split(" ", 1)
    except (OSError, ValueError):
        fail("partner-sync ещё не сделал ни одной попытки.")
    if time.time() - int(stamp) > 30:
        fail("partner-sync давно не обращался к API.")
    if not message.startswith("ok"):
        fail(f"Последняя попытка partner-sync: {message}")
    return f"partner-sync: {message}."
