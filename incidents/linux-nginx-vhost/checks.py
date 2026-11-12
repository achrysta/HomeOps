"""Проверки инцидента linux-nginx-vhost. Выполняются внутри учебного сервера."""

import subprocess

from incident_kit import RequestError, check, fail, http

SITE = {"shop": "магазин", "blog": "блог"}


def systemctl(*args: str) -> str:
    return subprocess.run(["systemctl", *args], capture_output=True, text=True).stdout.strip()


def page(host: str) -> tuple[int, str | None]:
    """Код ответа nginx на порту 80 для заданного Host и какой сайт в ответе (shop, blog или None)."""
    try:
        r = http("GET", "http://127.0.0.1/", headers={"Host": host}, timeout=5)
    except RequestError as e:
        # return 444 закрывает соединение без ответа — для чужих имён это правильное поведение
        if "Remote end closed" in str(e):
            return 0, None
        fail(f"nginx не отвечает на запрос с Host: {host} ({e}).")
    for site in SITE:
        if f'data-site="{site}"' in r.text:
            return r.status, site
    return r.status, None


def expect_site(host: str, site: str) -> str:
    status, got = page(host)
    if got != site:
        seen = f"открывается {SITE[got]}" if got else f"нет ни одного из сайтов (HTTP {status or 'без ответа'})"
        fail(f"По имени {host} должен открываться {SITE[site]}, а {seen}.")
    if status != 200:
        fail(f"По имени {host} {SITE[site]} отдаётся с HTTP {status}, ожидается 200.")
    return f"{host} → {SITE[site]} (HTTP 200)"


@check("nginx", "nginx запущен, конфигурация без ошибок", live=True)
def nginx():
    state = systemctl("is-active", "nginx")
    if state != "active":
        fail(f"nginx в состоянии {state}.")
    t = subprocess.run(["nginx", "-t"], capture_output=True, text=True)
    if t.returncode != 0:
        fail(f"nginx -t находит ошибки в конфигурации: {t.stderr.strip().splitlines()[-1]}")
    return "nginx активен, nginx -t без ошибок."


@check("shop", "shop.example.test открывает магазин", needs=["nginx"], live=True)
def shop():
    return expect_site("shop.example.test", "shop")


@check("www", "www.shop.example.test по-прежнему открывает магазин", needs=["nginx"], live=True)
def www():
    return expect_site("www.shop.example.test", "shop")


@check("blog", "blog.example.test по-прежнему открывает блог", needs=["nginx"], live=True)
def blog():
    return expect_site("blog.example.test", "blog")


@check("unknown", "Чужое имя и обращение по IP не получают ни одного из сайтов", needs=["nginx"], live=True)
def unknown():
    for host in ("unknown.example.test", "127.0.0.1"):
        status, got = page(host)
        if got:
            fail(f"Запрос с Host: {host} получает {SITE[got]} — для чужих имён нужен свой сервер по умолчанию.")
        if 200 <= status < 300:
            fail(f"Запрос с Host: {host} получает HTTP {status} — сервер по умолчанию не должен отдавать страницу.")
    return "Чужие имена и IP не получают сайтов."
