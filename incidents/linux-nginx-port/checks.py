"""Проверки инцидента linux-nginx-port. Выполняются внутри учебного сервера."""

import os
import stat
import subprocess

from incident_kit import RequestError, check, fail, get


def systemctl(*args: str) -> str:
    return subprocess.run(["systemctl", *args], capture_output=True, text=True).stdout.strip()


@check("nginx", "nginx запущен", live=True)
def nginx():
    state = systemctl("is-active", "nginx")
    if state != "active":
        fail(f"nginx в состоянии {state}.")
    return "nginx активен."


@check("site", "Главная страница — новый сайт, и отдаёт её nginx", needs=["nginx"], live=True)
def site():
    try:
        r = get("http://127.0.0.1/", timeout=5)
    except RequestError as e:
        fail(f"http://127.0.0.1/ не отвечает: {e}.")
    server = r.headers.get("server", "")
    if not server.startswith("nginx"):
        fail(f"На порту 80 отвечает не nginx (Server: {server or 'не указан'}).")
    if r.status != 200:
        fail(f"nginx отдаёт HTTP {r.status} на главную страницу.")
    if "Новый сайт" not in r.text:
        fail("nginx отдаёт 200, но это не новая версия сайта.")
    return f"HTTP 200 от {server}, новая главная страница."


@check("legacy", "Старый preview-сервер выключен и не запустится после перезагрузки", live=True)
def legacy():
    active = systemctl("is-active", "legacy-preview")
    enabled = systemctl("is-enabled", "legacy-preview")
    if active == "active":
        fail("Сервис legacy-preview всё ещё работает.")
    if enabled not in ("disabled", "masked"):
        fail(f"legacy-preview сейчас не работает, но включён в автозапуск ({enabled}) и поднимется после перезагрузки.")
    return f"legacy-preview: {active}, {enabled}."


@check("perms", "Права на сайт не шире необходимого: ничего не доступно на запись всем", live=True)
def perms():
    for path in ("/srv/site", "/srv/site/index.html"):
        mode = os.stat(path).st_mode
        if mode & stat.S_IWOTH:
            fail(f"{path} доступен на запись всем ({stat.filemode(mode)}). Для чтения nginx хватает r и x.")
    return "Каталог и страница не доступны на запись всем."
