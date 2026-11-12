"""model-sync — агент выкатки моделей (учебный стенд).

Раз в несколько секунд читает желаемую версию модели из ConfigMap model-version и, если она
отличается, обновляет аннотацию шаблона пода Deployment model-server — Kubernetes выкатывает новую версию.
Ходит в API-сервер с токеном ServiceAccount пода.
"""

import json
import signal
import ssl
import sys
import time
import urllib.error
import urllib.request

SA = "/var/run/secrets/kubernetes.io/serviceaccount"
API = "https://kubernetes.default.svc"
NS = open(f"{SA}/namespace").read().strip()
KEY = "models.homeops.local/version"
CTX = ssl.create_default_context(cafile=f"{SA}/ca.crt")


def call(method: str, path: str, body: dict | None = None) -> dict:
    token = open(f"{SA}/token").read().strip()
    headers = {"Authorization": f"Bearer {token}"}
    data = None
    if body is not None:
        data = json.dumps(body).encode()
        headers["Content-Type"] = "application/merge-patch+json"
    req = urllib.request.Request(API + path, data=data, method=method, headers=headers)
    with urllib.request.urlopen(req, timeout=5, context=CTX) as r:
        return json.loads(r.read())


def sync() -> None:
    want = call("GET", f"/api/v1/namespaces/{NS}/configmaps/model-version")["data"]["version"]
    deploy = call("GET", f"/apis/apps/v1/namespaces/{NS}/deployments/model-server")
    have = deploy["spec"]["template"]["metadata"].get("annotations", {}).get(KEY)
    if have == want:
        return
    call("PATCH", f"/apis/apps/v1/namespaces/{NS}/deployments/model-server", {"spec": {"template": {"metadata": {"annotations": {KEY: want}}}}})
    print(f"model-sync: model-server {have} → {want}", flush=True)


signal.signal(signal.SIGTERM, lambda *_: sys.exit(0))
print(f"model-sync: watching configmap model-version in namespace {NS}", flush=True)
last = ""
while True:
    try:
        sync()
        last = ""
    except urllib.error.HTTPError as e:
        try:
            msg = json.loads(e.read()).get("message", "")
        except Exception:
            msg = ""
        line = f"model-sync: HTTP {e.code} {e.reason}: {msg}"
        if line != last:
            print(line, flush=True)
            last = line
    except Exception as e:
        line = f"model-sync: {e}"
        if line != last:
            print(line, flush=True)
            last = line
    time.sleep(3)
