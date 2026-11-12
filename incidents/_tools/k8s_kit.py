"""Помощники автопроверки Kubernetes-стендов: kubectl, объекты кластера и запросы к сервисам.

Запросы к сервисам идут через прокси API-сервера (/api/v1/namespaces/<ns>/services/<svc>:<port>/proxy):
контейнер проверки не в сети подов, а API-сервер на узле control-plane видит поды напрямую.
Прокси выбирает только готовые (Ready) endpoints — как и обычный Service.
"""

from __future__ import annotations

import base64
import json
import os
import ssl
import subprocess
import tempfile
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any

import incident_kit as kit
from incident_kit import fail, plural


class KubectlError(Exception):
    pass


def kubectl(*args: str, timeout: float = 30.0, stdin: str | None = None) -> str:
    try:
        p = subprocess.run(["kubectl", *args], capture_output=True, text=True, timeout=timeout, input=stdin)
    except subprocess.TimeoutExpired:
        raise KubectlError(f"kubectl {' '.join(args[:3])}… не ответил за {timeout:.0f} с")
    if p.returncode != 0:
        raise KubectlError((p.stderr or p.stdout).strip() or f"kubectl завершился с кодом {p.returncode}")
    return p.stdout


def get(kind: str, name: str | None = None, ns: str | None = None, selector: str | None = None) -> Any:
    """Объект (или список при name=None) в JSON; None, если объекта нет."""
    args = ["get", kind, *([name] if name else []), *(["-n", ns] if ns else []), *(["-l", selector] if selector else []), "-o", "json"]
    try:
        data = json.loads(kubectl(*args))
    except KubectlError as e:
        if "NotFound" in str(e) or "not found" in str(e):
            return None
        raise
    return data if name else data.get("items", [])


def require(kind: str, name: str, ns: str) -> dict:
    obj = get(kind, name, ns)
    if obj is None:
        fail(f"В namespace {ns} нет {kind} {name}. Если удаляли — примените манифест заново.")
    return obj


_UNITS = {"Ki": 2**10, "Mi": 2**20, "Gi": 2**30, "Ti": 2**40, "k": 10**3, "M": 10**6, "G": 10**9, "T": 10**12}


def parse_quantity(q: str | None) -> float | None:
    """Величина Kubernetes в байтах (память) или ядрах (cpu, «500m» = 0.5): 128Mi, 1G, 0.5Gi, 250m."""
    if q is None or str(q).strip() == "":
        return None
    s = str(q).strip()
    if s.endswith("m") and s[:-1].replace(".", "", 1).isdigit():
        return float(s[:-1]) / 1000
    for suffix in sorted(_UNITS, key=len, reverse=True):
        if s.endswith(suffix):
            return float(s[: -len(suffix)]) * _UNITS[suffix]
    return float(s)


# ── Поды и деплойменты ───────────────────────────────────────────────────────

def pod_restarts(pod: dict) -> int:
    return sum(c.get("restartCount", 0) for c in pod.get("status", {}).get("containerStatuses", []) or [])


def pod_problem(pod: dict) -> str:
    """Короткое описание, почему под не готов: как в колонке STATUS у kubectl get pods."""
    st = pod.get("status", {})
    if pod.get("metadata", {}).get("deletionTimestamp"):
        return "Terminating"
    for c in st.get("initContainerStatuses", []) or []:
        if not (c.get("state", {}).get("terminated", {}).get("exitCode") == 0):
            w = c.get("state", {}).get("waiting", {}).get("reason")
            if w:
                return f"Init: {w}"
            age = _running_for(c)
            return f"Init: init-контейнер {c['name']} работает уже {age:.0f} с" if age is not None else "Init: ещё выполняется"
    for c in st.get("containerStatuses", []) or []:
        state = c.get("state", {})
        if "waiting" in state:
            reason = state["waiting"].get("reason", "Waiting")
            last = c.get("lastState", {}).get("terminated")
            if last:
                return f"{reason} (последний выход: {last.get('reason', '?')}, код {last.get('exitCode', '?')})"
            return reason
        if "terminated" in state:
            t = state["terminated"]
            return f"{t.get('reason', 'Terminated')} (код {t.get('exitCode', '?')})"
        if not c.get("ready"):
            return "Running, но не Ready"
    phase = st.get("phase", "?")
    if phase == "Pending":
        return "Pending"
    return phase


def pods(ns: str, selector: str) -> list[dict]:
    return [p for p in get("pods", ns=ns, selector=selector) if not p["metadata"].get("deletionTimestamp")]


def pods_summary(items: list[dict]) -> str:
    return "; ".join(f"{p['metadata']['name']}: {pod_problem(p)}" for p in items[:4]) or "подов нет"


def deployment_status(ns: str, name: str) -> tuple[bool, str]:
    d = get("deployment", name, ns)
    if d is None:
        return False, f"Deployment {name} не найден в namespace {ns}"
    want = d["spec"].get("replicas", 1)
    st = d.get("status", {})
    avail, updated = st.get("availableReplicas", 0), st.get("updatedReplicas", 0)
    fresh = st.get("observedGeneration", 0) >= d["metadata"].get("generation", 0)
    if want == 0:
        return False, f"У Deployment {name} replicas: 0 — сервису некому отвечать"
    ok = fresh and avail >= want and updated >= want and st.get("replicas", 0) == want
    sel = ",".join(f"{k}={v}" for k, v in d["spec"]["selector"].get("matchLabels", {}).items())
    if ok:
        return ok, f"{name}: доступно {avail} из {want}"
    # ReplicaSet не может создать поды (квота, Pod Security, admission): причина — в условии Deployment
    failure = next((c.get("message", "") for c in st.get("conditions", []) or [] if c.get("type") == "ReplicaFailure" and c.get("status") == "True"), "")
    if failure:
        return ok, f"{name}: доступно {avail} из {want}, обновлено {updated} — новые поды не создаются: {failure[:400]}"
    return ok, f"{name}: доступно {avail} из {want} — {pods_summary(pods(ns, sel))}"


def _running_for(c: dict) -> float | None:
    """Сколько секунд контейнер в состоянии running (None — не запущен)."""
    started = c.get("state", {}).get("running", {}).get("startedAt")
    if not started:
        return None
    from datetime import datetime, timezone

    return (datetime.now(timezone.utc) - datetime.fromisoformat(started.replace("Z", "+00:00"))).total_seconds()


STUCK_REASONS = {"CrashLoopBackOff", "ImagePullBackOff", "ErrImagePull", "CreateContainerConfigError", "CreateContainerError", "InvalidImageName", "RunContainerError"}


def pod_stuck(pod: dict) -> bool:
    """Под сам из этого состояния не выйдет: ждать дальше бессмысленно."""
    st = pod.get("status", {})
    for c in (st.get("initContainerStatuses") or []) + (st.get("containerStatuses") or []):
        state = c.get("state", {})
        if state.get("waiting", {}).get("reason") in STUCK_REASONS:
            return True
        # Новые версии Kubernetes на время backoff оставляют упавший контейнер в terminated
        if state.get("terminated", {}).get("exitCode", 0) != 0 and c.get("restartCount", 0) > 0:
            return True
    # init-контейнер, который ждёт зависимость дольше 20 секунд, сам вряд ли дождётся
    for c in st.get("initContainerStatuses") or []:
        age = _running_for(c)
        if age is not None and age > 20:
            return True
    return any(cond.get("type") == "PodScheduled" and cond.get("reason") == "Unschedulable" for cond in st.get("conditions", []) or [])


def wait_deployment(ns: str, name: str, timeout: float) -> tuple[bool, str]:
    """Ждёт, пока все реплики станут доступны; выходит раньше, если все неготовые поды застряли.
    В живой проверке не ждёт: опрос и так повторяется каждые несколько секунд."""
    deadline = time.monotonic() + (0 if kit.LIVE else timeout)
    ok, msg = deployment_status(ns, name)
    while not ok and time.monotonic() < deadline:
        d = get("deployment", name, ns)
        if d is not None:
            # ReplicaSet не может создать поды (квота, admission) — сами они не появятся
            if any(c.get("type") == "ReplicaFailure" and c.get("status") == "True" for c in d.get("status", {}).get("conditions", []) or []):
                break
            sel = ",".join(f"{k}={v}" for k, v in d["spec"]["selector"].get("matchLabels", {}).items())
            waiting = [p for p in pods(ns, sel) if pod_problem(p) not in ("Running",)]
            if waiting and all(pod_stuck(p) for p in waiting):
                break
        time.sleep(2)
        ok, msg = deployment_status(ns, name)
    return ok, msg


def container(obj: dict, name: str | None = None) -> dict:
    """Контейнер из шаблона пода Deployment (или из пода)."""
    spec = obj["spec"]["template"]["spec"] if "template" in obj.get("spec", {}) else obj["spec"]
    items = spec.get("containers", [])
    for c in items:
        if name is None or c["name"] == name:
            return c
    fail(f"В {obj['kind']} {obj['metadata']['name']} нет контейнера {name}")
    return {}


def watch_ready(ns: str, selector: str, seconds: float) -> str | None:
    """Следит за подами всё окно: None — все время были Ready, без перезапусков и замен;
    иначе — что случилось. Смотреть только на RESTARTS мало: после нескольких падений
    backoff растёт до минут, и счётчик за короткое окно может не измениться."""
    start = {p["metadata"]["uid"]: (p["metadata"]["name"], pod_restarts(p)) for p in pods(ns, selector)}
    if not start:
        return f"в namespace {ns} нет подов ({selector}) — стабильность не подтверждена"
    deadline = time.monotonic() + seconds
    while True:
        current = pods(ns, selector)
        present = {p["metadata"]["uid"] for p in current}
        for uid, (name, _) in start.items():
            if uid not in present:
                return f"под {name} исчез во время проверки стабильности"
        for p in current:
            uid, name = p["metadata"]["uid"], p["metadata"]["name"]
            if uid not in start:
                return f"появился новый под {name} — прежний был удалён или вытеснен"
            grown = pod_restarts(p) - start[uid][1]
            if grown > 0:
                return f"{name} перезапустился ({pod_problem(p)})"
            if pod_problem(p) != "Running":
                return f"{name}: {pod_problem(p)}"
        if time.monotonic() >= deadline:
            return None
        time.sleep(2)


# ── Прямые запросы к API (быстрее kubectl для частых запросов) ───────────────

@dataclass
class ApiResponse:
    status: int
    text: str

    def json(self) -> Any:
        try:
            return json.loads(self.text or "null")
        except json.JSONDecodeError:
            fail(f"Ответ не JSON (HTTP {self.status}): {self.text[:200]}")


class _Api:
    def __init__(self) -> None:
        self.base = ""
        self.ctx: ssl.SSLContext | None = None

    def _setup(self) -> None:
        if self.ctx:
            return
        cfg = json.loads(kubectl("config", "view", "--raw", "--minify", "--flatten", "-o", "json"))
        cluster = cfg["clusters"][0]["cluster"]
        user = cfg["users"][0]["user"]
        self.base = cluster["server"].rstrip("/")
        tmp = tempfile.mkdtemp(prefix="k8s-kit-")

        def dump(name: str, data: str) -> str:
            path = os.path.join(tmp, name)
            with open(path, "wb") as f:
                f.write(base64.b64decode(data))
            return path

        ctx = ssl.create_default_context(cafile=dump("ca.crt", cluster["certificate-authority-data"]))
        ctx.load_cert_chain(dump("client.crt", user["client-certificate-data"]), dump("client.key", user["client-key-data"]))
        self.ctx = ctx

    def request(self, method: str, path: str, body: Any = None, timeout: float = 5.0) -> ApiResponse:
        self._setup()
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(self.base + path, data=data, method=method, headers={"Content-Type": "application/json"} if data else {})
        try:
            with urllib.request.urlopen(req, timeout=timeout, context=self.ctx) as r:
                return ApiResponse(r.status, r.read().decode("utf-8", errors="replace"))
        except urllib.error.HTTPError as e:
            return ApiResponse(e.code, e.read().decode("utf-8", errors="replace"))
        except (urllib.error.URLError, TimeoutError, OSError) as e:
            return ApiResponse(0, str(getattr(e, "reason", e)))


api = _Api()


def service_get(ns: str, svc: str, port: int | str, path: str = "/", timeout: float = 5.0) -> ApiResponse:
    """GET к Service через прокси API-сервера — как запрос клиента внутри кластера."""
    return api.request("GET", f"/api/v1/namespaces/{ns}/services/{svc}:{port}/proxy{path}", timeout=timeout)


def proxy_error(r: ApiResponse) -> str:
    """Человекочитаемая причина неудачного запроса через прокси."""
    text = r.text.strip()
    try:
        data = json.loads(text)
        if isinstance(data, dict) and data.get("kind") == "Status":
            text = data.get("message", text)
    except json.JSONDecodeError:
        pass
    return f"HTTP {r.status}: {text[:240]}" if r.status else f"нет ответа: {text[:240]}"


def ready_endpoints(ns: str, svc: str) -> list[str]:
    """Адреса готовых endpoints сервиса (EndpointSlice)."""
    slices = get("endpointslices", ns=ns, selector=f"kubernetes.io/service-name={svc}")
    out: list[str] = []
    for s in slices:
        for ep in s.get("endpoints", []) or []:
            if ep.get("conditions", {}).get("ready", True):
                out.extend(ep.get("addresses", []))
    return out


class Traffic:
    """Непрерывные запросы к сервису в фоне: сколько из них не удалось (проверки «без простоя»)."""

    def __init__(self, ns: str, svc: str, port: int | str, path: str, ok: Any = None, interval: float = 0.15) -> None:
        import threading

        self.ns, self.svc, self.port, self.path = ns, svc, port, path
        self.ok = ok or (lambda r: r.status == 200)
        self.interval = interval
        self.total = 0
        self.failed = 0
        self.examples: list[str] = []
        self._stop = threading.Event()
        self._thread = threading.Thread(target=self._run, daemon=True)

    def _run(self) -> None:
        while not self._stop.is_set():
            r = service_get(self.ns, self.svc, self.port, self.path, timeout=3)
            self.total += 1
            if not self.ok(r):
                self.failed += 1
                if len(self.examples) < 3:
                    self.examples.append(proxy_error(r))
            self._stop.wait(self.interval)

    def __enter__(self) -> "Traffic":
        self._thread.start()
        return self

    def __exit__(self, *exc: Any) -> None:
        self._stop.set()
        self._thread.join(timeout=5)

    def summary(self) -> str:
        return f"{self.failed} из {plural(self.total, 'запроса', 'запросов', 'запросов')} с ошибкой"


# ── Запросы изнутри подов ────────────────────────────────────────────────────
# Сетевые политики действуют на трафик подов, а прокси API-сервера идёт с узла control-plane.
# Поэтому «кто кого видит» проверяется изнутри пода стенда: kubectl exec + python из образа.

PROBE_CODE = r'''
import json, socket, sys, urllib.error, urllib.request
kind, target, timeout = sys.argv[1], sys.argv[2], float(sys.argv[3])
def out(**kw):
    print(json.dumps(kw, ensure_ascii=False))
    sys.exit(0)
def reason(e):
    if isinstance(e, socket.gaierror): return "dns"
    if isinstance(e, (socket.timeout, TimeoutError)): return "timeout"
    if isinstance(e, ConnectionRefusedError): return "refused"
    return "error"
try:
    if kind == "dns":
        out(result="ok", addrs=sorted({a[4][0] for a in socket.getaddrinfo(target, None)}))
    if kind == "tcp":
        host, port = target.rsplit(":", 1)
        socket.create_connection((host, int(port)), timeout=timeout).close()
        out(result="open")
    with urllib.request.urlopen(target, timeout=timeout) as r:
        out(result="ok", status=r.status, body=r.read(4000).decode("utf-8", "replace"))
except urllib.error.HTTPError as e:
    out(result="http", status=e.code, body=e.read(4000).decode("utf-8", "replace"))
except urllib.error.URLError as e:
    out(result=reason(e.reason), error=str(e.reason))
except OSError as e:
    out(result=reason(e), error=str(e))
'''

PROBE_RESULT = {
    "dns": "имя не разрешается",
    "timeout": "соединение не устанавливается (таймаут — пакеты молча отбрасываются)",
    "refused": "соединение отклонено (connection refused)",
    "error": "сетевая ошибка",
}


def running_pod(ns: str, selector: str) -> dict | None:
    """Первый запущенный под по селектору — из него делаются запросы."""
    for p in pods(ns, selector):
        if p.get("status", {}).get("phase") == "Running":
            return p
    return None


def pod_probe(ns: str, selector: str, kind: str, target: str, timeout: float = 3.0) -> dict:
    """Запрос изнутри пода: kind = dns (имя), tcp (host:port) или http (URL).

    Результат — dict с result: ok | open | http | dns | timeout | refused | error, а также status, body, error.
    Нет запущенного пода — result: nopod.
    """
    pod = running_pod(ns, selector)
    if pod is None:
        return {"result": "nopod", "error": f"в namespace {ns} нет запущенного пода {selector}"}
    name = pod["metadata"]["name"]
    try:
        raw = kubectl("exec", "-n", ns, name, "--", "python", "-c", PROBE_CODE, kind, target, str(timeout), timeout=timeout + 20)
        return json.loads(raw.strip().splitlines()[-1])
    except (KubectlError, json.JSONDecodeError, IndexError) as e:
        return {"result": "error", "error": f"не удалось выполнить запрос из пода {name}: {e}"}


def probe_text(r: dict) -> str:
    """Человекочитаемый итог pod_probe."""
    if r["result"] in ("ok", "open"):
        return "доступно"
    if r["result"] == "http":
        return f"HTTP {r.get('status')}: {r.get('body', '')[:200]}"
    if r["result"] == "nopod":
        return r["error"]
    return PROBE_RESULT.get(r["result"], r["result"])


# ── Права (RBAC) ─────────────────────────────────────────────────────────────

def can_i(sa: str, verb: str, resource: str, ns: str | None = None) -> bool:
    """Разрешено ли действие ServiceAccount (ns/имя): kubectl auth can-i от его имени."""
    sa_ns, sa_name = sa.split("/", 1)
    args = ["kubectl", "auth", "can-i", verb, resource, f"--as=system:serviceaccount:{sa_ns}:{sa_name}", *(["-n", ns] if ns else [])]
    try:
        p = subprocess.run(args, capture_output=True, text=True, timeout=20)
    except subprocess.TimeoutExpired:
        raise KubectlError("kubectl auth can-i не ответил за 20 с")
    answer = p.stdout.strip()
    if answer not in ("yes", "no"):
        raise KubectlError((p.stderr or p.stdout).strip() or "kubectl auth can-i вернул пустой ответ")
    return answer == "yes"
