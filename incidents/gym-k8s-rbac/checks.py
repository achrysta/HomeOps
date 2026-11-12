"""Зал gym-k8s-rbac: ServiceAccount, Role, RoleBinding и kubectl auth can-i (namespace gym-rbac).

Права проверяются так же, как их видит API-сервер: kubectl auth can-i от имени ServiceAccount.
Каждый подход зависит от предыдущего (needs): дашборд засчитывает подходы по порядку.
"""

import subprocess
from pathlib import Path

from incident_kit import check, fail
from k8s_kit import can_i, get

NS = "gym-rbac"
REPORTER = f"{NS}/reporter"
ANSWERS = Path("/answers")
WRITE_VERBS = {"create", "update", "patch", "delete", "deletecollection", "*", "escalate", "bind", "impersonate"}


def answer(name: str) -> str:
    f = ANSWERS / name
    if not f.exists():
        fail(f"Файла /answers/{name} пока нет.")
    text = f.read_text(encoding="utf-8", errors="replace").strip()
    if not text:
        fail(f"Файл /answers/{name} пустой.")
    return text


def can_read_logs(sa: str) -> bool:
    """kubectl auth can-i get pods --subresource=log: логи — отдельный подресурс pods/log."""
    p = subprocess.run(
        ["kubectl", "auth", "can-i", "get", "pods", "--subresource=log", f"--as=system:serviceaccount:{NS}:{sa}", "-n", NS],
        capture_output=True, text=True, timeout=20,
    )
    if p.stdout.strip() not in ("yes", "no"):
        fail(f"kubectl auth can-i не ответил: {(p.stderr or p.stdout).strip()[:200]}")
    return p.stdout.strip() == "yes"


@check("sa", "Создать ServiceAccount", live=True)
def sa():
    if get("serviceaccount", "reporter", NS) is None:
        fail("ServiceAccount reporter в namespace gym-rbac пока нет.")
    return "ServiceAccount reporter создан"


@check("role", "Роль только на чтение подов", needs=["sa"], live=True)
def role():
    r = get("role", "pod-reader", NS)
    if r is None:
        fail("Role pod-reader в namespace gym-rbac пока нет.")
    rules = r.get("rules") or []
    if any(WRITE_VERBS & set(rule.get("verbs") or []) for rule in rules):
        fail("В pod-reader есть права на изменение — роль должна только читать.")
    reads = set()
    for rule in rules:
        if "" in (rule.get("apiGroups") or []) and "pods" in (rule.get("resources") or []):
            reads |= set(rule.get("verbs") or [])
    missing = [v for v in ("get", "list", "watch") if v not in reads]
    if missing:
        fail(f"pod-reader не даёт {', '.join(missing)} для pods.")
    return "pod-reader: get, list, watch для pods"


@check("binding", "Привязать роль", needs=["role"], live=True)
def binding():
    bound = any(
        b.get("roleRef", {}).get("kind") == "Role" and b["roleRef"].get("name") == "pod-reader"
        and any(s.get("kind") == "ServiceAccount" and s.get("name") == "reporter" and s.get("namespace", NS) == NS for s in b.get("subjects") or [])
        for b in get("rolebinding", ns=NS)
    )
    if not bound:
        fail("Нет RoleBinding, который выдаёт pod-reader ServiceAccount reporter.")
    if not can_i(REPORTER, "list", "pods", NS):
        fail("reporter пока не может читать поды в gym-rbac.")
    if can_i(REPORTER, "delete", "pods", NS):
        fail("reporter может удалять поды — у него лишние права.")
    return "reporter читает поды и не может их удалять"


@check("can-i", "Проверить права другого", needs=["binding"], live=True)
def can_i_answer():
    got = answer("deployer-delete").lower()
    if got not in ("yes", "no"):
        fail("Запишите в /answers/deployer-delete yes или no.")
    want = can_i(f"{NS}/deployer", "delete", "deployments", NS)
    if (got == "yes") != want:
        fail(f"В /answers/deployer-delete записано «{got}», а API-сервер отвечает иначе.")
    return f"deployer {'может' if want else 'не может'} удалять Deployment"


@check("logs", "Доступ к логам", needs=["can-i"], live=True)
def logs():
    if not can_read_logs("reporter"):
        fail("reporter пока не может читать логи подов (kubectl logs).")
    if can_i(REPORTER, "delete", "pods", NS):
        fail("reporter может удалять поды — у него лишние права.")
    return "reporter читает логи подов"
