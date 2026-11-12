"""Автопроверка инцидента k8s-rbac: агент выкатки model-sync и сервер модели в namespace models (Pod Security restricted)."""

import random
import time

from incident_kit import check, fail
from k8s_kit import KubectlError, can_i, get, kubectl, pods, require, wait_deployment

NS = "models"
KEY = "models.homeops.local/version"
SYNC_SA = f"{NS}/model-sync"
# Что агенту выкатки не нужно: удалять, создавать поды, читать секреты, ходить за пределы namespace
EXTRA = [
    ("delete", "deployments", NS, "удалять Deployment"),
    ("create", "pods", NS, "создавать поды"),
    ("get", "secrets", NS, "читать Secret"),
    ("patch", "deployments", "kube-system", "менять Deployment в kube-system"),
    ("list", "secrets", "kube-system", "читать Secret в kube-system"),
    ("list", "nodes", None, "читать узлы кластера"),
]


def template_version(deploy: dict) -> str | None:
    return deploy["spec"]["template"]["metadata"].get("annotations", {}).get(KEY)


def sync_logs() -> str:
    try:
        lines = [x for x in kubectl("logs", "-n", NS, "deployment/model-sync", "--tail=20").splitlines() if x.strip()]
    except KubectlError:
        return ""
    return lines[-1] if lines else ""


@check("sync", "model-sync читает желаемую версию и обновляет model-server")
def sync():
    ok, msg = wait_deployment(NS, "model-sync", timeout=30)
    if not ok:
        fail(f"Агент выкатки не запущен в актуальной версии: {msg}")
    require("configmap", "model-version", NS)
    # Новая желаемая версия: агент должен прочитать её и обновить шаблон model-server
    want = f"2026.10.{random.randint(100, 999)}"
    kubectl("patch", "configmap", "model-version", "-n", NS, "--type=merge", "-p", f'{{"data":{{"version":"{want}"}}}}')
    deadline = time.monotonic() + 25
    while time.monotonic() < deadline:
        if template_version(require("deployment", "model-server", NS)) == want:
            return f"новая версия {want} из model-version попала в шаблон model-server"
        time.sleep(2)
    last = sync_logs()
    fail(f"Желаемую версию {want} выставили в ConfigMap model-version, но за 25 с model-server не обновился." + (f" Последнее в логах model-sync: {last[:400]}" if last else ""))


@check("rollout", "Новая версия model-server выкатилась", needs=["sync"])
def rollout():
    deploy = require("deployment", "model-server", NS)
    want = template_version(deploy)
    ok, msg = wait_deployment(NS, "model-server", timeout=60)
    if not ok:
        fail(f"Версия {want} в шаблоне, но выкатка не завершилась: {msg}")
    stale = [p["metadata"]["name"] for p in pods(NS, "app=model-server") if p["metadata"].get("annotations", {}).get(KEY) != want]
    if stale:
        fail(f"Часть подов model-server всё ещё на старой версии: {', '.join(stale)}")
    return f"{msg}, все поды на версии {want}"


@check("least-privilege", "У model-sync только нужные права", live=True)
def least_privilege():
    deploy = require("deployment", "model-sync", NS)
    sa = deploy["spec"]["template"]["spec"].get("serviceAccountName") or "default"
    if sa != "model-sync":
        fail(f"Под model-sync запускается с ServiceAccount {sa}. По условию у агента свой ServiceAccount с минимальными правами.")
    if can_i(f"{NS}/default", "get", "configmaps", NS) or can_i(f"{NS}/default", "patch", "deployments", NS):
        fail("ServiceAccount default в namespace models получил права на ConfigMap или Deployment. Его получает любой под без своего ServiceAccount — права выдают только агенту.")
    extra = [what for verb, res, ns, what in EXTRA if can_i(SYNC_SA, verb, res, ns)]
    if extra:
        fail(f"У ServiceAccount model-sync лишние права: {', '.join(extra)}. По условию агенту нужно только читать ConfigMap и обновлять Deployment в namespace models.")
    return "model-sync под своим ServiceAccount; удалять, создавать поды, читать секреты и выходить за namespace он не может"


@check("pod-security", "Pod Security restricted в namespace models на месте", live=True)
def pod_security():
    labels = (get("namespace", NS) or {}).get("metadata", {}).get("labels", {})
    level = labels.get("pod-security.kubernetes.io/enforce")
    version = labels.get("pod-security.kubernetes.io/enforce-version", "latest")
    if level != "restricted" or version != "latest":
        fail(f"Профиль Pod Security в namespace models изменён: enforce={level or 'нет'}, enforce-version={version}. Требование платформы — restricted, версия latest; поды должны ему соответствовать.")
    return "enforce=restricted, версия latest"
