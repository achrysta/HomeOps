"""Проверки инцидента linux-final. Выполняются внутри учебного сервера."""

import os
import pwd
import subprocess
import time

from incident_kit import RequestError, check, fail, get

LOG = "/var/log/api/api.log"


def systemctl(*args: str) -> str:
    return subprocess.run(["systemctl", *args], capture_output=True, text=True).stdout.strip()


@check("disk", "Раздел /var/log/api занят меньше чем наполовину", live=True)
def disk():
    st = os.statvfs("/var/log/api")
    used = 1 - st.f_bavail / st.f_blocks
    if used >= 0.5:
        fail(f"Раздел /var/log/api занят на {used:.0%}.")
    return f"/var/log/api занят на {used:.0%}."


@check("api", "Сервис api запущен и отвечает на 127.0.0.1:9000", live=True)
def api():
    state = systemctl("is-active", "api")
    if state != "active":
        fail(f"api.service в состоянии {state}: смотрите systemctl status api и journalctl -u api.")
    try:
        r = get("http://127.0.0.1:9000/", timeout=3)
    except RequestError as e:
        fail(f"api.service активен, но 127.0.0.1:9000 не отвечает: {e}.")
    if r.status != 200 or '"service": "api"' not in r.text:
        fail(f"127.0.0.1:9000 отвечает HTTP {r.status}, но это не API заказов.")
    return "api.service активен, 127.0.0.1:9000 отвечает."


@check("user", "API работает не от root", needs=["api"], live=True)
def user():
    pid = systemctl("show", "-p", "MainPID", "--value", "api")
    uid = next(int(line.split()[1]) for line in open(f"/proc/{pid}/status") if line.startswith("Uid:"))
    name = pwd.getpwuid(uid).pw_name
    if uid == 0:
        fail("API запущен от root. Сервису нужен свой непривилегированный пользователь — запуск от root не решение.")
    return f"API работает от пользователя {name}."


@check("logs", "Журнал API пишется в /var/log/api/api.log", needs=["api"], live=True)
def logs():
    try:
        st = os.stat(LOG)
    except FileNotFoundError:
        fail(f"{LOG} нет — API должен вести журнал там.")
    if time.time() - st.st_mtime > 20:
        fail(f"{LOG} не обновлялся больше 20 секунд — API перестал писать журнал.")
    return f"{LOG} пополняется."


@check("site", "Сайт на порту 80 отвечает через nginx данными API", needs=["api"], live=True)
def site():
    try:
        r = get("http://127.0.0.1/", timeout=8)
    except RequestError as e:
        fail(f"nginx на порту 80 не отвечает: {e}.")
    if r.status != 200:
        fail(f"nginx отвечает HTTP {r.status}: до API заказов запрос не доходит.")
    if '"service": "api"' not in r.text:
        fail("nginx отвечает 200, но это не данные API заказов.")
    return "http://127.0.0.1/ → 200 от API заказов через nginx."


@check("boot", "api поднимется после перезагрузки сервера", live=True)
def boot():
    state = systemctl("is-enabled", "api")
    if state != "enabled":
        fail(f"api.service не включён в автозапуск ({state}): после перезагрузки сайт снова ляжет.")
    return "api.service в автозапуске."
