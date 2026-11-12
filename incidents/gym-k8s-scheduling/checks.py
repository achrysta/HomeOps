"""Зал gym-k8s-scheduling: nodeSelector, tolerations, DaemonSet, requests и квота (namespace gym-sched).

Узлы общего кластера не меняются: проверки только читают их метки и taints.
Каждый подход зависит от предыдущего (needs): дашборд засчитывает подходы по порядку.
"""

from incident_kit import check, fail, plural
from k8s_kit import container, deployment_status, get, parse_quantity, pods

NS = "gym-sched"
CP_LABEL = "node-role.kubernetes.io/control-plane"


def nodes() -> tuple[str, str, int]:
    """(control-plane, worker, всего узлов) — по метке роли control-plane."""
    items = get("nodes")
    cp = [n["metadata"]["name"] for n in items if CP_LABEL in n["metadata"].get("labels", {})]
    workers = [n["metadata"]["name"] for n in items if CP_LABEL not in n["metadata"].get("labels", {})]
    if not cp or not workers:
        fail("В кластере нет узлов control-plane и worker — пересоздайте кластер.")
    return cp[0], workers[0], len(items)


def web() -> dict:
    d = get("deployment", "web", NS)
    if d is None:
        fail("Deployment web в namespace gym-sched пока нет.")
    return d


def pinned_to(d: dict, node: str) -> bool:
    """Шаблон пода привязан к узлу: nodeSelector по hostname или обязательная nodeAffinity."""
    spec = d["spec"]["template"]["spec"]
    if (spec.get("nodeSelector") or {}).get("kubernetes.io/hostname") == node:
        return True
    terms = (((spec.get("affinity") or {}).get("nodeAffinity") or {}).get("requiredDuringSchedulingIgnoredDuringExecution") or {}).get("nodeSelectorTerms") or []
    return bool(terms) and all(
        any(e.get("key") == "kubernetes.io/hostname" and e.get("operator") == "In" and e.get("values") == [node] for e in t.get("matchExpressions") or [])
        for t in terms
    )


def pending_reason(pod: dict) -> str:
    cond = next((c for c in pod.get("status", {}).get("conditions") or [] if c.get("type") == "PodScheduled" and c.get("status") == "False"), None)
    return (cond or {}).get("message", "").rstrip(".")[:300]


@check("node-selector", "Только на worker", live=True)
def node_selector():
    _cp, worker, _n = nodes()
    d = web()
    if d["spec"].get("replicas", 1) != 2:
        fail(f"У web {plural(d['spec'].get('replicas', 1), 'реплика', 'реплики', 'реплик')}, а нужно 2.")
    if not pinned_to(d, worker):
        fail(f"Поды web не привязаны к узлу {worker}: планировщик может поставить их на любой подходящий узел.")
    ok, msg = deployment_status(NS, "web")
    if not ok:
        fail(f"Выкатка web не завершена: {msg}.")
    sel = ",".join(f"{k}={v}" for k, v in d["spec"]["selector"].get("matchLabels", {}).items())
    elsewhere = [p["metadata"]["name"] for p in pods(NS, sel) if p["spec"].get("nodeName") != worker]
    if elsewhere:
        fail(f"Поды web не на {worker}: {', '.join(elsewhere[:3])}.")
    return f"web: 2 реплики на {worker}"


@check("control-plane", "Под на control-plane", needs=["node-selector"], live=True)
def control_plane():
    cp, _worker, _n = nodes()
    pod = get("pod", "cp-agent", NS)
    if pod is None:
        fail("Пода cp-agent в namespace gym-sched пока нет.")
    node = pod["spec"].get("nodeName")
    if not node:
        fail(f"cp-agent не запланирован: {pending_reason(pod) or 'планировщик не нашёл узел'}.")
    if node != cp:
        fail(f"cp-agent работает на {node}, а нужен узел {cp}.")
    if pod.get("status", {}).get("phase") != "Running":
        fail(f"cp-agent на {cp}, но ещё не запущен ({pod.get('status', {}).get('phase')}).")
    return f"cp-agent работает на {cp}"


@check("daemonset", "DaemonSet на всех узлах", needs=["control-plane"], live=True)
def daemonset():
    _cp, _worker, total = nodes()
    ds = get("daemonset", "node-agent", NS)
    if ds is None:
        fail("DaemonSet node-agent в namespace gym-sched пока нет.")
    st = ds.get("status", {})
    desired, ready = st.get("desiredNumberScheduled", 0), st.get("numberReady", 0)
    if desired < total:
        fail(f"node-agent запланирован на {desired} из {total} узлов кластера.")
    if ready < total:
        fail(f"node-agent готов на {ready} из {total} узлов.")
    return f"node-agent работает на всех узлах кластера ({total})"


@check("requests", "Requests и limits", needs=["daemonset"], live=True)
def requests():
    res = container(web()).get("resources") or {}
    req, lim = res.get("requests") or {}, res.get("limits") or {}
    want = [("requests.cpu", req.get("cpu"), "50m"), ("requests.memory", req.get("memory"), "32Mi"), ("limits.memory", lim.get("memory"), "64Mi")]
    wrong = [f"{name} = {got or 'не задан'} (нужно {need})" for name, got, need in want if parse_quantity(got) != parse_quantity(need)]
    if wrong:
        fail(f"У контейнера web: {'; '.join(wrong)}.")
    ok, msg = deployment_status(NS, "web")
    if not ok:
        fail(f"Выкатка web не завершена: {msg}.")
    return "web: requests 50m / 32Mi, limits 64Mi"


@check("quota", "Квота namespace", needs=["requests"], live=True)
def quota():
    quotas = get("resourcequota", ns=NS)
    if not quotas:
        fail("В namespace gym-sched нет ResourceQuota.")
    for q in quotas:
        hard = q.get("spec", {}).get("hard") or {}
        if parse_quantity(hard.get("pods")) == 8 and parse_quantity(hard.get("requests.cpu")) == 0.5:
            return f"квота {q['metadata']['name']}: pods 8, requests.cpu 500m"
    seen = "; ".join(f"{q['metadata']['name']}: {', '.join(f'{k}={v}' for k, v in (q.get('spec', {}).get('hard') or {}).items())}" for q in quotas)
    fail(f"Нет квоты с pods = 8 и requests.cpu = 500m. Сейчас: {seen[:300]}.")
