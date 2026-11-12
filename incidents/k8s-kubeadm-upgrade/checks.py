"""Автопроверка инцидента k8s-kubeadm-upgrade: кластер обновлён до v1.37.1, сервис заказов работает."""

from incident_kit import check, fail
from k8s_kit import get, pods, wait_deployment

TARGET = "v1.37.1"
NS = "upgrade-ops"
COMPONENTS = ["kube-apiserver", "kube-controller-manager", "kube-scheduler"]


def image_tag(pod: dict) -> str:
    return pod["spec"]["containers"][0]["image"].rsplit(":", 1)[-1]


@check("control-plane", f"Компоненты control plane — {TARGET}", live=True)
def control_plane():
    for comp in COMPONENTS:
        items = pods("kube-system", f"component={comp}")
        if not items:
            fail(f"Пода {comp} нет в kube-system.")
        tag = image_tag(items[0])
        if tag != TARGET:
            fail(f"{comp} работает на {tag}, а нужна {TARGET}.")
        if not any(c.get("type") == "Ready" and c.get("status") == "True" for c in items[0].get("status", {}).get("conditions", [])):
            fail(f"{comp} на {TARGET}, но ещё не Ready.")
    return f"apiserver, controller-manager и scheduler — {TARGET}"


@check("kubeadm", f"kubeadm знает, что кластер — {TARGET}", needs=["control-plane"], live=True)
def kubeadm():
    cm = get("configmap", "kubeadm-config", "kube-system")
    cfg = (cm or {}).get("data", {}).get("ClusterConfiguration", "")
    version = next((line.split(":", 1)[1].strip() for line in cfg.splitlines() if line.strip().startswith("kubernetesVersion:")), "")
    if version != TARGET:
        fail(f"В kubeadm-config kubernetesVersion: {version or 'не найден'} — компоненты обновлены в обход kubeadm: он по-прежнему считает кластер старым, и следующие kubeadm upgrade и join пойдут от неверной версии.")
    return f"kubeadm-config: kubernetesVersion {TARGET}"


@check("kube-proxy", f"kube-proxy — {TARGET}", needs=["kubeadm"], live=True)
def kube_proxy():
    ds = get("daemonset", "kube-proxy", "kube-system")
    tag = ds["spec"]["template"]["spec"]["containers"][0]["image"].rsplit(":", 1)[-1] if ds else "нет"
    if tag != TARGET:
        fail(f"kube-proxy на {tag}, а нужна {TARGET}.")
    st = ds.get("status", {})
    if st.get("numberReady", 0) < st.get("desiredNumberScheduled", 1) or st.get("updatedNumberScheduled", 0) < st.get("desiredNumberScheduled", 1):
        fail(f"kube-proxy {TARGET} готов на {st.get('numberReady', 0)} из {st.get('desiredNumberScheduled', 0)} узлов.")
    return f"kube-proxy {TARGET} на всех узлах"


@check("kubelets", f"kubelet на всех узлах — {TARGET}", needs=["kube-proxy"], live=True)
def kubelets():
    for node in get("nodes"):
        name = node["metadata"]["name"]
        version = node.get("status", {}).get("nodeInfo", {}).get("kubeletVersion", "")
        if version != TARGET:
            fail(f"На узле {name} kubelet {version}, а нужна {TARGET}.")
        ready = next((c for c in node.get("status", {}).get("conditions", []) if c.get("type") == "Ready"), {})
        if ready.get("status") != "True":
            fail(f"Узел {name} не Ready: {ready.get('message') or ready.get('reason') or 'нет данных'}.")
    return f"kubelet {TARGET} на всех узлах, узлы Ready"


@check("schedulable", "Узлы снова принимают поды", needs=["kubelets"], live=True)
def schedulable():
    cordoned = [n["metadata"]["name"] for n in get("nodes") if n.get("spec", {}).get("unschedulable")]
    if cordoned:
        fail(f"Узлы закрыты для новых подов (SchedulingDisabled): {', '.join(cordoned)}.")
    return "ни один узел не закрыт для планирования"


@check("workload", "Сервис заказов работает (2 из 2)", needs=["schedulable"], live=True)
def workload():
    ok, msg = wait_deployment(NS, "orders", timeout=90)
    if not ok:
        fail(msg)
    return msg
