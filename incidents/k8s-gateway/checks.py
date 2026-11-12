"""Автопроверка инцидента k8s-gateway: витрина — через Ingress, API заказов — через Gateway API (Traefik).

Запросы идут так же, как у пользователя: на NodePort контроллера (30890) узла кластера с нужным заголовком Host.
Ограничения условия: витрина остаётся на Ingress, маршрут API — в namespace своей команды, общий Gateway
не открыт для всех namespace.
"""

import json
import urllib.error
import urllib.request

from incident_kit import check, fail
from k8s_kit import deployment_status, get, kubectl, require

NS_GW, NS_WEB, NS_API = "gw-system", "market", "market-api"
NODE_PORT = 30890
WEB_HOST, API_HOST = "market.example.test", "api.market.example.test"


def node_ip() -> str:
    for node in get("node") or []:
        for addr in node.get("status", {}).get("addresses", []):
            if addr.get("type") == "InternalIP":
                return addr["address"]
    fail("Не удалось узнать адрес узла кластера.")


def request(host: str, path: str) -> tuple[int, str]:
    req = urllib.request.Request(f"http://{node_ip()}:{NODE_PORT}{path}", headers={"Host": host})
    try:
        with urllib.request.urlopen(req, timeout=5) as r:
            return r.status, r.read(2000).decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read(2000).decode("utf-8", "replace")
    except OSError as e:
        fail(f"Контроллер на порту {NODE_PORT} узла не отвечает: {e}")


def route_conditions(route: dict) -> dict[str, dict]:
    """Условия статуса HTTPRoute от Gateway gw-system/edge."""
    for parent in route.get("status", {}).get("parents", []):
        ref = parent.get("parentRef", {})
        if ref.get("name") == "edge" and ref.get("namespace", route["metadata"]["namespace"]) == NS_GW:
            return {c["type"]: c for c in parent.get("conditions", [])}
    return {}


def condition_text(c: dict) -> str:
    return f"{c.get('reason', '')}{': ' + c['message'] if c.get('message') else ''}"


@check("controller", "Контроллер Traefik работает", live=True)
def controller():
    ok, text = deployment_status(NS_GW, "traefik")
    if not ok:
        fail(f"Traefik в gw-system не готов: {text}")
    return "Traefik готов: обслуживает IngressClass traefik и GatewayClass traefik."


@check("ingress", f"Витрина {WEB_HOST} открывается через Ingress", needs=["controller"], live=True)
def ingress():
    status, body = request(WEB_HOST, "/")
    if status != 200 or 'data-app="storefront"' not in body:
        fail(f"GET http://{WEB_HOST}/ через контроллер — HTTP {status}: у Traefik нет маршрута на витрину.")
    return f"http://{WEB_HOST}/ — витрина отвечает."


@check("ingress-paths", "Страницы витрины по вложенным путям (/catalog/42) открываются", needs=["ingress"], live=True)
def ingress_paths():
    status, body = request(WEB_HOST, "/catalog/42")
    if status != 200 or "/catalog/42" not in body:
        fail(f"GET http://{WEB_HOST}/catalog/42 — HTTP {status}, а главная страница открывается.")
    return f"http://{WEB_HOST}/catalog/42 — страница каталога отвечает."


@check("route", "HTTPRoute orders принят Gateway edge", live=True)
def route():
    r = get("httproute", "orders", NS_API)
    if r is None:
        fail(f"HTTPRoute orders в namespace {NS_API} не найден.")
    conds = route_conditions(r)
    if not conds:
        fail("У HTTPRoute orders нет статуса от Gateway gw-system/edge: маршрут к нему не подключён.")
    accepted = conds.get("Accepted", {})
    if accepted.get("status") != "True":
        fail(f"Gateway edge не принимает HTTPRoute orders: Accepted={accepted.get('status')} ({condition_text(accepted)}).")
    return "Gateway edge принял HTTPRoute orders."


@check("api", f"API заказов {API_HOST}/orders/7 отвечает через Gateway", needs=["route"], live=True)
def api():
    status, body = request(API_HOST, "/orders/7")
    try:
        order = json.loads(body).get("order") if status == 200 else None
    except ValueError:
        order = None
    if order != 7:
        refs = route_conditions(get("httproute", "orders", NS_API) or {}).get("ResolvedRefs", {})
        note = f" ResolvedRefs={refs.get('status')} ({condition_text(refs)})." if refs.get("status") != "True" else ""
        fail(f"GET http://{API_HOST}/orders/7 — HTTP {status}.{note}")
    return f"http://{API_HOST}/orders/7 — заказ 7 от orders-api."


@check("scope", "Gateway открыт только разрешённым namespace, маршруты на своих местах", live=True)
def scope():
    gw = require("gateway", "edge", NS_GW)
    for listener in gw["spec"].get("listeners", []):
        if ((listener.get("allowedRoutes") or {}).get("namespaces") or {}).get("from") == "All":
            fail(f"Слушатель {listener.get('name')} Gateway edge принимает маршруты из любых namespace (from: All): общий Gateway открывают только разрешённым командам.")
    ing = get("ingress", "market", NS_WEB)
    if ing is None:
        fail(f"Ingress market в namespace {NS_WEB} удалён: витрина до конца миграции остаётся на Ingress.")
    # все namespace: маршрут могли перенести или скопировать к Gateway
    for r in json.loads(kubectl("get", "httproute", "-A", "-o", "json")).get("items", []):
        hosts = r.get("spec", {}).get("hostnames") or []
        where = f"{r['metadata']['namespace']}/{r['metadata']['name']}"
        if WEB_HOST in hosts:
            fail(f"HTTPRoute {where} забирает {WEB_HOST}: витрина до конца миграции остаётся на Ingress.")
        if API_HOST in hosts and r["metadata"]["namespace"] != NS_API:
            fail(f"HTTPRoute {where} обслуживает {API_HOST} не из namespace команды API ({NS_API}).")
    return "Gateway edge открыт не всем namespace, витрина на Ingress, маршрут API — в market-api."
