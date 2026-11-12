"""Автопроверка инцидента k8s-node-notready: узел homeops-worker и сервис заказов в namespace node-ops."""

import time

from incident_kit import check, fail
from k8s_kit import KubectlError, get, kubectl, pods, wait_deployment

NODE = "homeops-worker"
NS = "node-ops"


def node_ready() -> tuple[bool, str]:
    node = get("node", NODE)
    if node is None:
        fail(f"Узла {NODE} нет в кластере.")
    cond = next((c for c in node.get("status", {}).get("conditions", []) if c.get("type") == "Ready"), {})
    return cond.get("status") == "True", cond.get("message") or cond.get("reason") or "нет данных"


@check("node-ready", "Узел homeops-worker в состоянии Ready", live=True)
def ready():
    ok, msg = node_ready()
    if not ok:
        fail(f"Узел {NODE} не Ready: {msg}")
    return f"{NODE}: Ready"


@check("workload", "Сервис заказов запущен (2 из 2)", needs=["node-ready"], live=True)
def workload():
    ok, msg = wait_deployment(NS, "orders", timeout=90)
    if not ok:
        fail(msg)
    return msg


@check("logs", "kubectl logs и exec к подам на узле работают", needs=["workload"], live=True)
def logs():
    on_node = [p for p in pods(NS, "app=orders") if p.get("spec", {}).get("nodeName") == NODE and p.get("status", {}).get("phase") == "Running"]
    if not on_node:
        fail(f"На узле {NODE} нет запущенных подов сервиса заказов.")
    name = on_node[0]["metadata"]["name"]
    # logs и exec идут от API-сервера к kubelet узла: kubelet должен принять его клиентский сертификат
    try:
        out = kubectl("logs", "-n", NS, name, timeout=15)
    except KubectlError as e:
        fail(f"kubectl logs {name} не работает: {str(e)[:300]}")
    if "ready to accept orders" not in out:
        fail(f"kubectl logs {name} вернул неожиданное: {out[:200]}")
    try:
        kubectl("exec", "-n", NS, name, "--", "true", timeout=15)
    except KubectlError as e:
        fail(f"kubectl exec в {name} не работает: {str(e)[:300]}")
    return f"kubectl logs и exec в {name}: API-сервер достучался до kubelet"


@check("stable", "Узел остаётся Ready 30 секунд", needs=["node-ready"])
def stable():
    deadline = time.monotonic() + 30
    while time.monotonic() < deadline:
        ok, msg = node_ready()
        if not ok:
            fail(f"Узел {NODE} снова не Ready: {msg}")
        time.sleep(3)
    return f"{NODE} Ready всё окно проверки"


# Автопроверка работает из рабочего места и не видит systemd узла: состояние enable смотрит короткий под
# на самом узле — он монтирует /etc/systemd/system только на чтение и ищет ссылку, которую создаёт systemctl enable
PROBE = """
apiVersion: v1
kind: Pod
metadata: {name: homeops-autostart-probe, namespace: node-ops}
spec:
  nodeName: homeops-worker
  restartPolicy: Never
  tolerations: [{operator: Exists}]
  containers:
    - name: probe
      image: python:3.12-alpine
      command: [sh, -c, "if [ -L /units/multi-user.target.wants/kubelet.service ]; then echo enabled; else echo disabled; fi"]
      volumeMounts: [{name: units, mountPath: /units, readOnly: true}]
  volumes: [{name: units, hostPath: {path: /etc/systemd/system, type: Directory}}]
"""


@check("autostart", "kubelet включён в автозапуск и поднимется после перезагрузки", needs=["node-ready"])
def autostart():
    kubectl("delete", "pod", "homeops-autostart-probe", "-n", NS, "--ignore-not-found", "--wait=true", timeout=60)
    kubectl("apply", "-f", "-", stdin=PROBE)
    try:
        deadline = time.monotonic() + 60
        phase = ""
        while time.monotonic() < deadline:
            pod = get("pod", "homeops-autostart-probe", NS) or {}
            phase = pod.get("status", {}).get("phase", "")
            if phase in ("Succeeded", "Failed"):
                break
            time.sleep(2)
        if phase != "Succeeded":
            fail(f"Не удалось проверить автозапуск kubelet на {NODE}: служебный под не завершился (фаза {phase or 'нет'}).")
        state = kubectl("logs", "-n", NS, "homeops-autostart-probe", timeout=15).strip()
    finally:
        kubectl("delete", "pod", "homeops-autostart-probe", "-n", NS, "--ignore-not-found", "--wait=false", timeout=30)
    if state != "enabled":
        fail(f"kubelet на {NODE} не включён в автозапуск (systemctl is-enabled kubelet — disabled): после перезагрузки узел снова станет NotReady.")
    return f"kubelet на {NODE} включён в автозапуск"
