"""Автопроверка инцидента k8s-nodeport: API для партнёров на NodePort 30080 каждого узла."""

from incident_kit import RequestError, check, fail, http
from k8s_kit import get, require

NS = "partners"
PORT = 30080


def node_ips() -> list[tuple[str, str]]:
    out = []
    for n in get("nodes") or []:
        ip = next((a["address"] for a in n["status"].get("addresses", []) if a["type"] == "InternalIP"), None)
        if ip:
            out.append((n["metadata"]["name"], ip))
    return out


def answer(ip: str) -> str | None:
    """Ответ partner-api через NodePort узла или текст ошибки."""
    try:
        r = http("GET", f"http://{ip}:{PORT}/", timeout=2)
    except RequestError as e:
        return str(e)
    if r.status != 200 or '"partner-api"' not in r.text:
        return f"HTTP {r.status}, это не partner-api"
    return None


@check("service", "Service partner-api — NodePort на порту 30080", live=True)
def service():
    svc = require("service", "partner-api", NS)
    spec = svc["spec"]
    if spec.get("type") != "NodePort":
        fail(f"Service partner-api имеет тип {spec.get('type')}, а партнёр ходит на NodePort.")
    ports = [p.get("nodePort") for p in spec.get("ports", [])]
    if PORT not in ports:
        fail(f"У Service partner-api nodePort {', '.join(map(str, ports)) or 'не задан'}, а партнёр настроен на {PORT} — номер менять нельзя.")
    return f"NodePort {PORT}."


@check("endpoints", "У Service есть готовые endpoints", needs=["service"], live=True)
def endpoints():
    slices = get("endpointslices", ns=NS, selector="kubernetes.io/service-name=partner-api") or []
    addrs = [a for s in slices for ep in s.get("endpoints") or [] if ep.get("conditions", {}).get("ready", True) for a in ep.get("addresses", [])]
    ports = [p.get("port") for s in slices for p in s.get("ports") or [] if p.get("port")]
    if not addrs:
        fail("У Service partner-api нет готовых endpoints: селектор не находит готовые поды.")
    if not ports:
        fail("Поды найдены, но у endpoints нет порта: targetPort Service не совпадает ни с одним портом контейнера.")
    return f"endpoints: {', '.join(addrs)}, порт {ports[0]}"


@check("some-node", "API отвечает через NodePort узла, где работают поды", needs=["endpoints"], live=True)
def some_node():
    hosts = {p["spec"].get("nodeName") for p in get("pods", ns=NS, selector="app=partner-api") or []}
    ips = [(n, ip) for n, ip in node_ips() if n in hosts]
    if not ips:
        fail("Поды partner-api не назначены ни на один узел.")
    name, ip = ips[0]
    err = answer(ip)
    if err:
        fail(f"Запрос на {ip}:{PORT} (узел {name}) — {err}.")
    return f"{name} ({ip}:{PORT}) отвечает."


@check("all-nodes", "API отвечает через порт 30080 на каждом узле кластера", needs=["some-node"], live=True)
def all_nodes():
    bad = [f"{name} ({ip}): {err}" for name, ip in node_ips() if (err := answer(ip))]
    if bad:
        fail("Балансировщик партнёра шлёт запросы на все узлы, а часть не отвечает — " + "; ".join(bad))
    return f"Отвечают все узлы: {', '.join(n for n, _ in node_ips())}."


@check("no-host", "Без hostNetwork и hostPort: доступ только через Service", live=True)
def no_host():
    dep = require("deployment", "partner-api", NS)
    spec = dep["spec"]["template"]["spec"]
    if spec.get("hostNetwork"):
        fail("Под partner-api запущен с hostNetwork — это обход Service, а не исправление.")
    for c in spec.get("containers", []):
        if any(p.get("hostPort") for p in c.get("ports", [])):
            fail("У контейнера partner-api задан hostPort — это обход Service, а не исправление.")
    return "Поды без hostNetwork и hostPort."
