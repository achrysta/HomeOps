"""Автопроверка инцидента k8s-cni: на узле worker снова работает CNI кластера (kindnet), поды запускаются.

Ограничения условия: kindnet не трогают (DaemonSet не меняли, работает на обоих узлах), нагрузку не уводят
на control-plane (taint на месте, поды на worker).
"""

import json

from incident_kit import check, fail
from k8s_kit import deployment_status, get, kubectl, pod_probe, pods, probe_text, require

NS = "netops"
CP_TAINT = "node-role.kubernetes.io/control-plane"


def nodes() -> tuple[dict, dict]:
    items = get("node") or []
    cp = next((n for n in items if CP_TAINT in n["metadata"].get("labels", {})), None)
    worker = next((n for n in items if CP_TAINT not in n["metadata"].get("labels", {})), None)
    if not cp or not worker:
        fail("В кластере нет узла control-plane или worker.")
    return cp, worker


def sandbox_error() -> str:
    """Последняя ошибка создания песочницы пода в namespace стенда — то, что пишет kubelet в Events."""
    events = json.loads(kubectl("get", "events", "-n", NS, "--field-selector", "reason=FailedCreatePodSandBox", "-o", "json")).get("items", [])
    if not events:
        return ""
    last = max(events, key=lambda e: e.get("lastTimestamp") or e.get("eventTime") or "")
    message = last.get("message", "")
    return message.split("failed to setup network for sandbox")[-1].split(":", 1)[-1].strip() or message


@check("kindnet", "CNI кластера (kindnet) не тронут и работает на обоих узлах", live=True)
def kindnet():
    ds = get("daemonset", "kindnet", "kube-system")
    if ds is None:
        fail("DaemonSet kindnet в kube-system удалён: это CNI кластера, без него сети подов нет на всех узлах.")
    if ds["metadata"].get("generation", 1) != 1:
        fail("DaemonSet kindnet изменён: CNI кластера не меняют, чинить нужно узел worker.")
    status = ds.get("status", {})
    if status.get("numberReady", 0) != status.get("desiredNumberScheduled", -1) or status.get("desiredNumberScheduled", 0) < 2:
        fail(f"kindnet готов на {status.get('numberReady', 0)} из {status.get('desiredNumberScheduled', 0)} узлов.")
    return "kindnet не изменён и работает на обоих узлах."


@check("placement", "Поды приложений на рабочем узле, control-plane закрыт для них", live=True)
def placement():
    cp, worker = nodes()
    if not any(t.get("key") == CP_TAINT and t.get("effect") == "NoSchedule" for t in cp["spec"].get("taints", [])):
        fail(f"С узла {cp['metadata']['name']} снят taint {CP_TAINT}: нагрузку не переносят на control-plane, чинить нужно worker.")
    on_cp = [p["metadata"]["name"] for p in pods(NS, "app in (reports,dashboard)") if p["spec"].get("nodeName") == cp["metadata"]["name"]]
    if on_cp:
        fail(f"Поды {', '.join(on_cp)} работают на control-plane: приложения должны жить на {worker['metadata']['name']}.")
    return f"Приложения на {worker['metadata']['name']}, control-plane закрыт taint-ом."


@check("reports", "Сервис отчётов запущен", needs=["placement"], live=True)
def reports():
    ok, text = deployment_status(NS, "reports")
    if not ok:
        why = sandbox_error()
        fail(f"reports не готов: {text}" + (f". kubelet: {why}" if why else ""))
    return "reports: 2 из 2 подов готовы."


@check("network", "Поды получают адреса из сети kindnet и видят друг друга через Service", needs=["reports", "kindnet"], live=True)
def network():
    _, worker = nodes()
    cidr = worker["spec"].get("podCIDR", "")
    prefix = cidr.rsplit(".", 1)[0] + "." if cidr.endswith(".0/24") else ""
    ips = [p.get("status", {}).get("podIP", "") for p in pods(NS, "app=reports")]
    foreign = [ip for ip in ips if prefix and not ip.startswith(prefix)]
    if foreign:
        fail(f"Адреса подов {', '.join(foreign)} не из сети узла {cidr}: поды подключены не к CNI кластера.")
    ok, text = deployment_status(NS, "dashboard")
    if not ok:
        fail(f"dashboard не готов: {text}")
    r = pod_probe(NS, "app=dashboard", "http", "http://reports/")
    if r["result"] != "ok":
        fail(f"dashboard не достучался до Service reports: {probe_text(r)}.")
    return f"Поды в сети {cidr}, dashboard получает ответ от reports через Service."
