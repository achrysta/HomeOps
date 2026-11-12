"""Автопроверка инцидента k8s-service-endpoints: витрина (storefront) и каталог (catalog)."""

from incident_kit import check, fail, plural
from k8s_kit import get, proxy_error, ready_endpoints, require, service_get, wait_deployment


@check("endpoints", "У Service catalog есть готовые endpoints", live=True)
def endpoints():
    require("service", "catalog", "catalog")
    addrs = ready_endpoints("catalog", "catalog")
    if not addrs:
        fail("У Service catalog нет ни одного готового endpoint — запросам к нему некуда идти, хотя поды каталога работают.")
    return f"endpoints: {', '.join(addrs)}"


@check("catalog", "Каталог отвечает через Service catalog:80", needs=["endpoints"], live=True)
def catalog():
    r = service_get("catalog", "catalog", 80, "/products")
    if r.status != 200:
        fail(f"Запрос к Service catalog:80 не дошёл до приложения — {proxy_error(r)}")
    items = r.json()
    if not isinstance(items, list) or not items:
        fail(f"Каталог ответил, но без товаров: {r.text[:200]}")
    return f"/products → {plural(len(items), 'товар', 'товара', 'товаров')}"


@check("web-ready", "Витрина web запущена", live=True)
def web_ready():
    ok, msg = wait_deployment("storefront", "web", timeout=40)
    if not ok:
        fail(msg)
    return msg


@check("web", "Витрина показывает товары из каталога", needs=["web-ready"], live=True)
def web():
    r = service_get("storefront", "web", 80, "/")
    data = r.json() if r.text.startswith("{") else {}
    if r.status != 200:
        detail = data.get("error") or proxy_error(r)
        fail(f"Витрина ответила HTTP {r.status}: не смогла получить каталог по адресу {data.get('catalog', '?')} — {detail}")
    if not data.get("products"):
        fail("Витрина ответила, но список товаров пуст")
    n = len(data["products"])
    return f"витрина получила {plural(n, 'товар', 'товара', 'товаров')} из {data.get('catalog')}"


@check("placement", "Сервисы остались в своих namespace", live=True)
def placement():
    if get("deployment", "catalog-api", "storefront") is not None:
        fail("В namespace storefront появилась копия catalog-api. Каталог принадлежит другой команде и живёт в namespace catalog — витрина должна ходить туда.")
    require("deployment", "catalog-api", "catalog")
    require("deployment", "web", "storefront")
    return "catalog-api — в catalog, web — в storefront"
