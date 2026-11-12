"""Автопроверка инцидента k8s-gpu-scheduling: инференс llm-api работает на GPU-узле, обучение уступило ему GPU.

Ограничения условия: GPU-узел не меняют (taint, метка пула, один GPU), классы приоритета — как у платформы,
Job обучения не пересоздают (UID из отметки до поломки), GPU освобождает планировщик вытеснением, а не человек.
"""

from incident_kit import check, fail
from k8s_kit import deployment_status, get, pods, require

SERVING, TRAINING = "serving", "training"
TAINT = {"key": "nvidia.com/gpu", "value": "present", "effect": "NoSchedule"}
CLASSES = {"inference-critical": 100000, "batch-low": 1000}


def gpu_node() -> dict:
    workers = [n for n in get("node") or [] if "node-role.kubernetes.io/control-plane" not in n["metadata"].get("labels", {})]
    if not workers:
        fail("В кластере нет рабочего узла.")
    return workers[0]


@check("node", "GPU-узел не изменён: taint, метка пула и один GPU", live=True)
def node():
    n = gpu_node()
    taints = [{k: t.get(k) for k in ("key", "value", "effect")} for t in n["spec"].get("taints", [])]
    if TAINT not in taints:
        fail(f"С узла {n['metadata']['name']} снят taint nvidia.com/gpu=present:NoSchedule: на GPU-узел начнут попадать поды без GPU. Узел — общий ресурс платформы.")
    if n["metadata"].get("labels", {}).get("node.example.test/pool") != "gpu":
        fail(f"У узла {n['metadata']['name']} изменена метка пула node.example.test/pool: по ней на GPU-узлы попадают и другие команды.")
    gpus = n.get("status", {}).get("capacity", {}).get("nvidia.com/gpu")
    if gpus != "1":
        fail(f"У узла {n['metadata']['name']} в capacity nvidia.com/gpu = {gpus}, а GPU на нём один: число GPU объявляет device plugin, а не человек.")
    return f"{n['metadata']['name']}: taint nvidia.com/gpu, пул gpu, один GPU."


@check("classes", "Классы приоритета — как у платформы", live=True)
def classes():
    found = {pc["metadata"]["name"]: pc.get("value") for pc in get("priorityclass") or [] if not pc["metadata"]["name"].startswith("system-")}
    if found != CLASSES:
        fail(f"Классы приоритета изменены: {found}. Ими управляет платформа: inference-critical — 100000, batch-low — 1000, других нет.")
    return "inference-critical (100000) и batch-low (1000) — как у платформы."


def unscheduled_reason(ns: str, selector: str) -> str:
    """Почему планировщик не размещает под: сообщение условия PodScheduled у самого нового пода (во время выкатки
    в Pending висят и поды прошлой ревизии)."""
    for p in sorted(pods(ns, selector), key=lambda p: p["metadata"].get("creationTimestamp", ""), reverse=True):
        for c in p.get("status", {}).get("conditions", []):
            if c.get("type") == "PodScheduled" and c.get("status") == "False":
                return c.get("message", "")
    return ""


@check("inference", "llm-api запущен на GPU-узле с классом приоритета инференса", needs=["node"], live=True)
def inference():
    ok, text = deployment_status(SERVING, "llm-api")
    if not ok:
        why = unscheduled_reason(SERVING, "app=llm-api")
        fail(f"llm-api не готов: {text}" + (f". Планировщик: {why}" if why else ""))
    running = [p for p in pods(SERVING, "app=llm-api") if p.get("status", {}).get("phase") == "Running"]
    node_name = gpu_node()["metadata"]["name"]
    if not any(p["spec"].get("nodeName") == node_name for p in running):
        fail(f"llm-api работает не на GPU-узле {node_name}.")
    classes_used = {p["spec"].get("priorityClassName") for p in running}
    if classes_used != {"inference-critical"}:
        fail(f"llm-api работает с классом приоритета {', '.join(sorted(c or 'не задан' for c in classes_used))}: для онлайн-инференса у платформы есть свой класс.")
    return f"llm-api готов на {node_name}, класс приоритета inference-critical."


@check("training", "Обучение уступило GPU через вытеснение и ждёт своей очереди", needs=["inference", "classes"], live=True)
def training():
    marks = require("configmap", "homeops-marks", TRAINING).get("data", {})
    job = get("job", "train-ranker", TRAINING)
    if job is None or job["metadata"]["uid"] != marks.get("job-uid"):
        fail("Job train-ranker удалён или пересоздан: обучение команды ранжирования нельзя терять — оно должно уступить GPU и подождать.")
    # Вытесненный планировщиком под получает условие DisruptionTarget, и podFailurePolicy Job его не считает отказом;
    # удалённый руками под — отказ: status.failed растёт. Сам вытесненный под Job убирает, поэтому смотрим счётчик
    failed = (job.get("status") or {}).get("failed", 0)
    if failed:
        fail(f"У Job train-ranker {failed} упавших подов: обучение остановили руками, а не вытеснением. GPU должен освободить планировщик по приоритету.")
    items = pods(TRAINING, "app=train-ranker")
    if any(p.get("status", {}).get("phase") == "Running" for p in items):
        fail("Обучение всё ещё занимает GPU.")
    waiting = [p for p in items if p.get("status", {}).get("phase") == "Pending"]
    if not waiting:
        fail("Обучение не ждёт GPU: у Job train-ranker нет пода в очереди.")
    return f"Обучение вытеснено планировщиком без отказов Job, под {waiting[0]['metadata']['name']} ждёт GPU."
