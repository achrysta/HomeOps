"""Автопроверка инцидента k8s-etcd-restore: сервис учёта платежей восстановлен из снапшота etcd.

Объекты сверяются по UID с отметкой стенда (ConfigMap homeops-etcd-restore в kube-system), сделанной
до снапшота: восстановленные из etcd объекты сохраняют исходные UID, созданные заново руками — нет.
"""

import re

from incident_kit import check, fail
from k8s_kit import KubectlError, get, kubectl, wait_deployment

NS = "payments"


def marker() -> dict:
    cm = get("configmap", "homeops-etcd-restore", "kube-system")
    if cm is None:
        fail("Нет служебной отметки стенда (ConfigMap homeops-etcd-restore в kube-system) — сбросьте стенд.")
    return cm.get("data") or {}


def same_uid(obj: dict | None, key: str, what: str) -> None:
    if obj is None:
        fail(f"{what} нет.")
    if obj["metadata"].get("uid") != marker().get(key):
        fail(f"{what} создан заново, а не восстановлен: у него другой UID. Нужно состояние из снапшота, а не новые объекты.")


@check("api", "API-сервер отвечает", live=True)
def api():
    try:
        kubectl("get", "--raw", "/readyz", timeout=10)
    except KubectlError as e:
        failed = re.findall(r"\[-\]([\w.-]+) failed", str(e))
        why = f"не готовы {', '.join(failed)}" if failed else str(e)[:200]
        fail(f"API-сервер не готов: {why}. После замены данных etcd он возвращается за минуту-две.")
    return "API-сервер готов"


@check("namespace", "Namespace payments восстановлен", needs=["api"], live=True)
def namespace():
    same_uid(get("namespace", NS), "namespace", "Namespace payments")
    return "namespace payments — исходный, из снапшота"


@check("config", "Конфигурация сервиса восстановлена", needs=["namespace"], live=True)
def config():
    same_uid(get("configmap", "ledger-config", NS), "config", "ConfigMap ledger-config")
    return "ledger-config — исходный, из снапшота"


@check("ledger", "Сервис учёта платежей работает (2 из 2)", needs=["config"], live=True)
def ledger():
    same_uid(get("deployment", "ledger", NS), "deployment", "Deployment ledger")
    ok, msg = wait_deployment(NS, "ledger", timeout=120)
    if not ok:
        fail(msg)
    return msg
