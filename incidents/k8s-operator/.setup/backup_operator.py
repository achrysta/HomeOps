"""backup-operator: для каждого Backup (ops.example.test/v1) в отслеживаемых namespace держит CronJob резервного
копирования и пишет в статус Backup, что получилось. Без клиентской библиотеки: REST API кластера + токен
ServiceAccount. Отслеживаемые namespace — из ConfigMap backup-operator (том /etc/backup-operator, перечитывается
на каждом проходе; kubelet обновляет файл в томе с задержкой до минуты)."""

import json
import os
import ssl
import time
import urllib.error
import urllib.request
from pathlib import Path

SA = Path("/var/run/secrets/kubernetes.io/serviceaccount")
API = f"https://{os.environ['KUBERNETES_SERVICE_HOST']}:{os.environ['KUBERNETES_SERVICE_PORT']}"
CTX = ssl.create_default_context(cafile=str(SA / "ca.crt"))
CONFIG = Path("/etc/backup-operator/watch-namespaces")
GROUP = "ops.example.test/v1"
MANAGED = {"app.kubernetes.io/managed-by": "backup-operator"}
seen: dict[str, str] = {}


class ApiError(Exception):
    def __init__(self, code: int, message: str):
        super().__init__(message)
        self.code = code


def call(method: str, path: str, body: dict | None = None, patch: bool = False) -> dict:
    data = json.dumps(body).encode() if body is not None else None
    headers = {"Authorization": f"Bearer {(SA / 'token').read_text()}", "Accept": "application/json"}
    if data is not None:
        headers["Content-Type"] = "application/merge-patch+json" if patch else "application/json"
    req = urllib.request.Request(API + path, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, context=CTX, timeout=10) as r:
            return json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        try:
            message = json.loads(e.read()).get("message", e.reason)
        except ValueError:
            message = str(e.reason)
        raise ApiError(e.code, message) from None


def log_once(key: str, message: str) -> None:
    if seen.get(key) != message:
        print(message, flush=True)
        seen[key] = message


def set_status(b: dict, ready: bool, reason: str, message: str) -> None:
    ns, name = b["metadata"]["namespace"], b["metadata"]["name"]
    status = {
        "observedGeneration": b["metadata"].get("generation", 1),
        "conditions": [{"type": "Ready", "status": "True" if ready else "False", "reason": reason, "message": message,
                        "lastTransitionTime": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}],
    }
    old = (b.get("status") or {}).get("conditions") or [{}]
    if (b.get("status") or {}).get("observedGeneration") == status["observedGeneration"] and old[0].get("reason") == reason and old[0].get("message") == message:
        return
    call("PATCH", f"/apis/{GROUP}/namespaces/{ns}/backups/{name}/status", {"status": status}, patch=True)


def cronjob_for(b: dict) -> dict:
    spec, meta = b["spec"], b["metadata"]
    command = f"echo 'резервная копия {spec['database']}: хранить {spec.get('retentionDays', 7)} дн.'"
    return {
        "apiVersion": "batch/v1",
        "kind": "CronJob",
        "metadata": {
            "name": f"backup-{meta['name']}",
            "namespace": meta["namespace"],
            "labels": dict(MANAGED),
            "ownerReferences": [{"apiVersion": GROUP, "kind": "Backup", "name": meta["name"], "uid": meta["uid"], "controller": True, "blockOwnerDeletion": True}],
        },
        "spec": {
            "schedule": spec["schedule"],
            "concurrencyPolicy": "Forbid",
            "successfulJobsHistoryLimit": 1,
            "failedJobsHistoryLimit": 1,
            "jobTemplate": {"spec": {"backoffLimit": 1, "template": {"spec": {
                "restartPolicy": "Never",
                "containers": [{"name": "backup", "image": "python:3.12-alpine", "command": ["sh", "-c", command]}],
            }}}},
        },
    }


def reconcile(b: dict) -> None:
    ns, name = b["metadata"]["namespace"], b["metadata"]["name"]
    key = f"{ns}/{name}"
    want = cronjob_for(b)
    path = f"/apis/batch/v1/namespaces/{ns}/cronjobs"
    try:
        try:
            current = call("GET", f"{path}/{want['metadata']['name']}")
        except ApiError as e:
            if e.code != 404:
                raise
            call("POST", path, want)
            log_once(key, f"{key}: создан CronJob {want['metadata']['name']} ({want['spec']['schedule']})")
            set_status(b, True, "CronJobCreated", f"CronJob {want['metadata']['name']} по расписанию {want['spec']['schedule']}")
            return
        owners = [o.get("uid") for o in current["metadata"].get("ownerReferences", [])]
        if b["metadata"]["uid"] not in owners:
            message = f"CronJob {want['metadata']['name']} уже есть и создан не оператором — не трогаю"
            log_once(key, f"{key}: {message}")
            set_status(b, False, "CronJobConflict", message)
            return
        containers = current["spec"]["jobTemplate"]["spec"]["template"]["spec"].get("containers", [{}])
        want_cmd = want["spec"]["jobTemplate"]["spec"]["template"]["spec"]["containers"][0]["command"]
        if current["spec"].get("schedule") != want["spec"]["schedule"] or containers[0].get("command") != want_cmd:
            call("PATCH", f"{path}/{want['metadata']['name']}", {"spec": want["spec"]}, patch=True)
        log_once(key, f"{key}: CronJob {want['metadata']['name']} в порядке")
        set_status(b, True, "CronJobReady", f"CronJob {want['metadata']['name']} по расписанию {want['spec']['schedule']}")
    except ApiError as e:
        message = f"API {e.code}: {e}"
        log_once(key, f"{key}: не удалось управлять CronJob — {message}")
        try:
            set_status(b, False, "Forbidden" if e.code == 403 else "ApiError", message)
        except ApiError as e2:
            log_once(key + "/status", f"{key}: не удалось записать статус — API {e2.code}: {e2}")


def main() -> None:
    print("backup-operator запущен: следит за Backup (ops.example.test/v1)", flush=True)
    while True:
        try:
            watch = CONFIG.read_text().split() if CONFIG.exists() else []
            log_once("config", f"отслеживаемые namespace: {', '.join(watch) or 'нет'}")
            for b in call("GET", f"/apis/{GROUP}/backups").get("items", []):
                if b["metadata"]["namespace"] in watch:
                    reconcile(b)
        except ApiError as e:
            log_once("list", f"не удалось получить Backup — API {e.code}: {e}")
        except Exception as e:  # оператор не должен падать от одной ошибки сети
            log_once("loop", f"ошибка прохода: {e}")
        time.sleep(3)


main()
