"""Автопроверка инцидента k8s-pending: сервис отчётов в namespace reports и reports-batch."""

from incident_kit import check, fail
from k8s_kit import container, get, require, wait_deployment

QUOTA_HARD = {"pods": "6", "requests.cpu": "1", "requests.memory": "1Gi", "limits.memory": "2Gi"}


@check("api", "report-api запущен", live=True)
def api():
    ok, msg = wait_deployment("reports", "report-api", timeout=30)
    if not ok:
        fail(msg)
    return msg


@check("renderer", "report-renderer запущен, кэш — на томе", live=True)
def renderer():
    pvc = get("pvc", "renderer-cache", "reports")
    if pvc is None:
        fail("Нет PersistentVolumeClaim renderer-cache: рендеру нужен кэш на томе.")
    ok, msg = wait_deployment("reports", "report-renderer", timeout=40)
    phase = (get("pvc", "renderer-cache", "reports") or pvc).get("status", {}).get("phase")
    if phase != "Bound":
        fail(f"PVC renderer-cache в состоянии {phase} — тома для рендера нет. {msg}")
    if not ok:
        fail(msg)
    return f"{msg}, PVC renderer-cache: Bound"


@check("worker", "Воркеры отчётов запущены (2 из 2)", live=True)
def worker():
    ok, msg = wait_deployment("reports-batch", "report-worker", timeout=30)
    if not ok:
        fail(msg)
    # Квота проверяется только при создании пода: поды, созданные в её обход, при пересоздании снова не появятся
    res = container(require("deployment", "report-worker", "reports-batch")).get("resources", {})
    # Значения по умолчанию из LimitRange namespace тоже годятся: их подставляет admission
    defaults = {"requests": {}, "limits": {}}
    for lr in get("limitranges", ns="reports-batch"):
        for item in lr["spec"].get("limits", []):
            if item.get("type") == "Container":
                defaults["requests"].update(item.get("defaultRequest", {}))
                defaults["limits"].update(item.get("default", {}))
    missing = [k for k in ("requests.cpu", "requests.memory", "limits.memory") if not (res.get(k.split(".")[0], {}).get(k.split(".")[1]) or defaults[k.split(".")[0]].get(k.split(".")[1]))]
    if missing:
        fail(f"Воркеры работают, но в шаблоне пода нет {', '.join(missing)}. Под квотой batch-quota такие поды не создаются — после следующей выкатки или перезапуска воркеров снова не будет.")
    return msg


@check("quota", "Квота namespace reports-batch на месте", live=True)
def quota():
    q = get("resourcequota", "batch-quota", "reports-batch")
    if q is None:
        fail("Квоты batch-quota в namespace reports-batch больше нет. Квота платформенной команды должна оставаться на месте.")
    hard = q["spec"].get("hard", {})
    changed = [f"{k}: {hard.get(k, 'нет')} (было {v})" for k, v in QUOTA_HARD.items() if hard.get(k) != v]
    if changed:
        fail("Квоту batch-quota меняли: " + "; ".join(changed) + ". Квоту выставляет платформенная команда — уложитесь в неё.")
    return "batch-quota не тронута: " + ", ".join(f"{k}={v}" for k, v in QUOTA_HARD.items())
