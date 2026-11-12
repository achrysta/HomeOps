"""Зал gym-k8s-network: Service, DNS-имя, NodePort и NetworkPolicy (namespace gym-net).

Доступ проверяется настоящим трафиком изнутри подов-клиентов (pod_probe): так его видит приложение,
а не прокси API-сервера, трафик которого идёт с узла. Каждый подход зависит от предыдущего (needs).
"""

from pathlib import Path

from incident_kit import check, fail
from k8s_kit import get, pod_probe, probe_text, ready_endpoints

NS = "gym-net"
ANSWERS = Path("/answers")
URL = "http://web.gym-net.svc.cluster.local/"
NODE_PORT = 30880


def answer(name: str) -> str:
    f = ANSWERS / name
    if not f.exists():
        fail(f"Файла /answers/{name} пока нет.")
    text = f.read_text(encoding="utf-8", errors="replace").strip()
    if not text:
        fail(f"Файл /answers/{name} пустой.")
    return text


def service(name: str) -> dict:
    svc = get("service", name, NS)
    if svc is None:
        fail(f"Service {name} в namespace gym-net пока нет.")
    return svc


def serves_web(svc: dict) -> None:
    name = svc["metadata"]["name"]
    if (svc["spec"].get("selector") or {}).get("app") != "web":
        fail(f"Service {name} не выбирает поды web (selector app=web).")
    port = next((p for p in svc["spec"].get("ports") or [] if p.get("port") == 80), None)
    if port is None or str(port.get("targetPort")) not in ("8080", "http"):
        fail(f"Service {name}: порт 80 должен вести на порт контейнера 8080.")
    if not ready_endpoints(NS, name):
        fail(f"У Service {name} нет готовых endpoints.")


_reach: dict[str, dict] = {}


def reach(pod: str) -> dict:
    """Запрос к web из пода-клиента; за один прогон проверок каждый клиент спрашивается один раз
    (заблокированный ждёт таймаута, и живая проверка не должна ждать его дважды)."""
    if pod not in _reach:
        _reach[pod] = pod_probe(NS, f"role={'frontend' if pod == 'frontend' else 'batch'}", "http", URL, timeout=1.5)
    return _reach[pod]


@check("service", "Открыть web через Service", live=True)
def service_rep():
    serves_web(service("web"))
    return "Service web: порт 80 → 8080, endpoints готовы"


@check("dns-name", "Полное DNS-имя сервиса", needs=["service"], live=True)
def dns_name():
    got = answer("web-fqdn").rstrip(".")
    if got != "web.gym-net.svc.cluster.local":
        fail(f"В /answers/web-fqdn записано «{got[:60]}» — это не полное DNS-имя Service web.")
    return "web.gym-net.svc.cluster.local"


@check("nodeport", "Открыть web на порту узла", needs=["dns-name"], live=True)
def nodeport():
    svc = service("web-np")
    if svc["spec"].get("type") != "NodePort":
        fail(f"Service web-np типа {svc['spec'].get('type', 'ClusterIP')}, а нужен NodePort.")
    serves_web(svc)
    ports = [p.get("nodePort") for p in svc["spec"].get("ports") or []]
    if NODE_PORT not in ports:
        fail(f"У web-np порт узла {ports[0] if ports else 'не задан'}, а нужен {NODE_PORT}.")
    return f"web-np: NodePort {NODE_PORT} → 8080"


def default_deny() -> bool:
    for p in get("networkpolicy", ns=NS):
        spec = p.get("spec", {})
        if spec.get("podSelector") in ({}, None) and "Ingress" in (spec.get("policyTypes") or []) and not spec.get("ingress"):
            return True
    return False


@check("deny", "Закрыть namespace по умолчанию", needs=["nodeport"], live=True)
def deny():
    if not default_deny():
        fail("В gym-net нет политики, которая по умолчанию запрещает весь входящий трафик ко всем подам namespace.")
    r = reach("intruder")
    if r["result"] in ("ok", "http"):
        fail("Под intruder по-прежнему получает ответ от web — входящий трафик не закрыт.")
    return f"intruder до web не достучался: {probe_text(r)}"


@check("allow", "Пустить только фронтенд", needs=["deny"], live=True)
def allow():
    r = reach("frontend")
    if r["result"] != "ok":
        fail(f"Под frontend (role=frontend) не получает ответ от web: {probe_text(r)}.")
    if reach("intruder")["result"] in ("ok", "http"):
        fail("Под intruder тоже получает ответ — доступ открыт шире, чем только для role=frontend.")
    return "frontend получает ответ от web, intruder — нет"
