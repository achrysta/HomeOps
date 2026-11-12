"""Автопроверка инцидента k8s-control-plane: компоненты control plane и релиз API в namespace release."""

import random
import time

from incident_kit import check, fail
from k8s_kit import KubectlError, get, kubectl, pod_problem, wait_deployment

NS = "release"
NODE = "homeops-control-plane"


def component(name: str) -> str:
    """Static pod компонента control plane: существует, это зеркало static pod и он готов."""
    pod = get("pod", f"{name}-{NODE}", "kube-system")
    if pod is None:
        fail(f"Пода {name} в kube-system нет — kubelet узла {NODE} его не запускает.")
    if "kubernetes.io/config.mirror" not in pod["metadata"].get("annotations", {}):
        fail(f"{name}-{NODE} — не static pod: компоненты control plane в kubeadm запускает kubelet из каталога static pods.")
    ready = any(c.get("type") == "Ready" and c.get("status") == "True" for c in pod.get("status", {}).get("conditions", []) or [])
    if not ready:
        fail(f"{name} не готов: {pod_problem(pod)}")
    return f"{name}: Running, static pod"


@check("controller-manager", "kube-controller-manager работает", live=True)
def controller_manager():
    return component("kube-controller-manager")


@check("scheduler", "kube-scheduler работает", live=True)
def scheduler():
    return component("kube-scheduler")


@check("release", "Релиз API запущен (2 из 2)", needs=["controller-manager", "scheduler"], live=True)
def release():
    ok, msg = wait_deployment(NS, "api", timeout=60)
    if not ok:
        fail(msg)
    return msg


@check("new-pod", "Новый под планируется и запускается", needs=["scheduler"])
def new_pod():
    name = f"probe-{random.randint(1000, 9999)}"
    kubectl("run", name, "-n", NS, "--image=python:3.12-alpine", "--image-pull-policy=IfNotPresent", "--restart=Never", "--", "sleep", "60")
    try:
        deadline = time.monotonic() + 40
        pod = None
        while time.monotonic() < deadline:
            pod = get("pod", name, NS)
            if pod and pod.get("status", {}).get("phase") == "Running":
                return f"под {name} назначен на {pod['spec'].get('nodeName')} и запущен"
            time.sleep(2)
        fail(f"Новый под {name} за 40 с не запустился: {pod_problem(pod) if pod else 'пода нет'}")
    finally:
        try:
            kubectl("delete", "pod", name, "-n", NS, "--wait=false")
        except KubectlError:
            pass
    return ""
