"""Автопроверка инцидента k8s-operator: Backup команды inventory обслуживает оператор и по нему есть CronJob.

Ограничения условия: CRD не меняют (generation 1 — v1beta1 снова не включают), CronJob создаёт оператор, а не
человек (ownerReference на Backup), оператору не выдают лишних прав (не cluster-admin).
"""

from incident_kit import check, fail
from k8s_kit import can_i, get, require

NS, OPS = "inventory", "ops-system"
SA = f"{OPS}/backup-operator"
CRD = "backups.ops.example.test"
WANT = {"database": "inventory-db", "schedule": "0 3 * * *", "retentionDays": 14}


def backup() -> dict:
    b = get("backups.v1.ops.example.test", "inventory-db", NS)
    if b is None:
        fail(f"Backup inventory-db в namespace {NS} не создан: манифест команды не применился.")
    return b


def ready_condition(b: dict) -> dict:
    return next((c for c in (b.get("status") or {}).get("conditions", []) if c.get("type") == "Ready"), {})


@check("crd", "CRD backups.ops.example.test не изменён: обслуживается только v1", live=True)
def crd():
    c = get("crd", CRD)
    if c is None:
        fail(f"CRD {CRD} удалён: без него оператор и Backup не работают.")
    served = [v["name"] for v in c["spec"].get("versions", []) if v.get("served")]
    if served != ["v1"] or c["metadata"].get("generation", 1) != 1:
        fail(f"CRD {CRD} изменён (обслуживаются версии: {', '.join(served) or 'нет'}): API оператора 2.0 — только v1, старую версию обратно не включают.")
    return "CRD как у оператора 2.0: обслуживается только v1."


@check("backup", "Backup inventory-db создан по API v1 с прежними настройками", live=True)
def backup_spec():
    spec = backup().get("spec", {})
    wrong = [f"{k}: {spec.get(k)!r} вместо {v!r}" for k, v in WANT.items() if spec.get(k) != v]
    if wrong:
        fail(f"Backup inventory-db создан, но настройки команды потерялись при переносе на v1: {'; '.join(wrong)}.")
    return "Backup inventory-db: база inventory-db, расписание 0 3 * * *, хранить 14 дней."


@check("watched", "Оператор обрабатывает Backup команды inventory", needs=["backup"], live=True)
def watched():
    b = backup()
    status = b.get("status") or {}
    if not status.get("conditions"):
        fail("У Backup inventory-db нет статуса: оператор этот объект не обрабатывает.")
    return f"Оператор обработал Backup: {ready_condition(b).get('reason', 'статус записан')}."


@check("cronjob", "Оператор создал CronJob резервного копирования", needs=["watched"], live=True)
def cronjob():
    b = backup()
    cond = ready_condition(b)
    cj = get("cronjob", "backup-inventory-db", NS)
    owned = cj is not None and any(o.get("uid") == b["metadata"]["uid"] for o in cj["metadata"].get("ownerReferences", []))
    if cj is not None and not owned:
        fail("CronJob backup-inventory-db создан не оператором (нет ownerReference на Backup): оператор такой CronJob не трогает, и расписание из Backup до него не дойдёт.")
    if cond.get("status") != "True" or cj is None:
        fail(f"Оператор не смог создать CronJob: Ready={cond.get('status')} ({cond.get('reason')}: {cond.get('message', '')[:200]}).")
    if cj["spec"].get("schedule") != WANT["schedule"]:
        fail(f"У CronJob расписание {cj['spec'].get('schedule')!r}, а в Backup — {WANT['schedule']!r}.")
    return "CronJob backup-inventory-db создан оператором, расписание 0 3 * * *."


@check("rbac", "У оператора нет лишних прав", live=True)
def rbac():
    extra = [what for what, (verb, res, ns) in {
        "читать Secret": ("get", "secrets", NS),
        "удалять узлы": ("delete", "nodes", None),
        "создавать Pod": ("create", "pods", NS),
        "менять CRD": ("update", "customresourcedefinitions.apiextensions.k8s.io", None),
    }.items() if can_i(SA, verb, res, ns)]
    if extra:
        fail(f"У ServiceAccount оператора лишние права: может {', '.join(extra)}. Оператору нужны Backup, их статус и CronJob — не больше.")
    return "Лишних прав у оператора нет: Secret, Pod, узлы и CRD ему недоступны."
