"""Автопроверка инцидента k8s-certs: logs и exec к подам сервиса счетов в namespace billing."""

from incident_kit import check, fail, wait_for
from k8s_kit import KubectlError, kubectl, pods, wait_deployment

NS = "billing"
MARKER = "ready to issue invoices"


def running_invoice() -> str:
    items = [p for p in pods(NS, "app=invoices") if p.get("status", {}).get("phase") == "Running"]
    if not items:
        fail("Нет запущенных подов сервиса счетов invoices.")
    return items[0]["metadata"]["name"]


@check("workload", "Сервис счетов запущен (2 из 2)", live=True)
def workload():
    ok, msg = wait_deployment(NS, "invoices", timeout=90)
    if not ok:
        fail(msg)
    return msg


@check("apiserver", "API-сервер работает как static pod", needs=["workload"], live=True)
def apiserver():
    def ready() -> list[dict]:
        items = pods("kube-system", "component=kube-apiserver")
        return [p for p in items if any(c.get("type") == "Ready" and c.get("status") == "True" for c in p.get("status", {}).get("conditions", []))]

    # после перезапуска static pod kubelet возвращает его под в API не сразу — до минуты
    if not wait_for(lambda: bool(ready()), timeout=60, interval=3):
        fail("Под kube-apiserver в kube-system не Ready. После перезапуска static pod это занимает до минуты; API-сервер должен работать из /etc/kubernetes/manifests.")
    return f"{ready()[0]['metadata']['name']}: Ready"


@check("logs", "kubectl logs работает", needs=["apiserver"], live=True)
def logs():
    name = running_invoice()
    # logs и exec API-сервер проксирует в kubelet узла, предъявляя свой клиентский сертификат
    try:
        out = kubectl("logs", "-n", NS, name, timeout=15)
    except KubectlError as e:
        fail(f"kubectl logs {name} не работает: {str(e)[:300]}")
    if MARKER not in out:
        fail(f"kubectl logs {name} вернул неожиданное: {out[:200]}")
    return f"kubectl logs {name} работает"


@check("exec", "kubectl exec работает", needs=["logs"], live=True)
def exec_():
    name = running_invoice()
    try:
        kubectl("exec", "-n", NS, name, "--", "true", timeout=15)
    except KubectlError as e:
        fail(f"kubectl exec в {name} не работает: {str(e)[:300]}")
    return f"kubectl exec в {name} работает"
