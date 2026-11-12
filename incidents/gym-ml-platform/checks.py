"""Только чтение API. GPU не запускаем, отсутствие custom metrics диагностируем честно."""
from pathlib import Path

from incident_kit import check, fail
from k8s_kit import get

NS = "gym-ml-platform"
ANSWERS = Path("/answers")


def obj(kind, name):
    value = get(kind, name, NS)
    if not value:
        fail(f"{kind} {name} пока нет в namespace {NS}.")
    return value


def answer(name):
    path = ANSWERS / name
    if not path.exists() or not path.read_text().strip():
        fail(f"Запишите найденный факт в /answers/{name}.")
    return path.read_text().strip()


@check("model-id", "Идентификатор модели", live=True)
def model_id():
    actual = obj("configmap", "model-info")["data"]["MODEL_ID"]
    if answer("model-id") != actual:
        fail("Идентификатор в ответе не совпадает с текущим ConfigMap model-info.")
    return "ответ совпадает с текущей конфигурацией"


@check("gpu-request", "Запрос GPU", needs=["model-id"], live=True)
def gpu_request():
    pod = obj("pod", "gpu-request")
    containers = pod["spec"].get("containers", [])
    if len(containers) != 1 or str(containers[0].get("resources", {}).get("limits", {}).get("nvidia.com/gpu")) != "1":
        fail("У единственного контейнера gpu-request ожидается limits nvidia.com/gpu: 1.")
    return "запрос GPU описан; Pending на Mac без NVIDIA ожидаем"


@check("startup", "Бюджет загрузки", needs=["gpu-request"], live=True)
def startup():
    d = obj("deployment", "model")
    container = d["spec"]["template"]["spec"]["containers"][0]
    probe = container.get("startupProbe", {})
    load = int(obj("configmap", "model-info")["data"]["LOAD_SECONDS"])
    budget = probe.get("initialDelaySeconds", 0) + probe.get("periodSeconds", 10) * probe.get("failureThreshold", 3)
    if probe.get("httpGet", {}).get("path") != "/ready" or probe.get("httpGet", {}).get("port") != 8080 or budget < load + 2:
        fail("startupProbe должна проверять /ready:8080 и дать бюджет не меньше LOAD_SECONDS + 2 секунд.")
    status = d.get("status", {})
    if d["spec"].get("replicas") != 2 or status.get("observedGeneration", 0) < d["metadata"].get("generation", 1) or status.get("updatedReplicas", 0) != 2 or status.get("availableReplicas", 0) != 2:
        fail("Дождитесь двух готовых реплик актуальной версии model.")
    return "две реплики загрузились в пределах startup-бюджета"


@check("hpa", "Метрика очереди", needs=["startup"], live=True)
def hpa():
    s = obj("hpa", "model")["spec"]
    target = s.get("scaleTargetRef", {})
    metric = {"type": "Pods", "pods": {"metric": {"name": "model_queue"}, "target": {"type": "AverageValue", "averageValue": "10"}}}
    if target.get("kind") != "Deployment" or target.get("name") != "model" or target.get("apiVersion") != "apps/v1" or s.get("minReplicas") != 2 or s.get("maxReplicas") != 4 or s.get("metrics") != [metric]:
        fail("HPA model: Deployment model, 2–4 реплики, Pods/model_queue, AverageValue 10.")
    return "HPA описан; работоспособность custom metrics проверяем следующим подходом"


@check("adapter", "Диагностика custom metrics", needs=["hpa"], live=True)
def adapter():
    hpa()
    conditions = obj("hpa", "model").get("status", {}).get("conditions", [])
    condition = next((c for c in conditions if c["type"] == "ScalingActive"), {})
    if condition.get("status") != "False" or not condition.get("reason"):
        fail("Ждём ScalingActive=False: в этом кластере нет адаптера model_queue. Посмотрите события HPA.")
    if answer("hpa-reason") != condition["reason"]:
        fail("Причина в ответе не совпадает с текущей ScalingActive.reason HPA.")
    return "отсутствие метрики диагностировано; масштабирование пока не работает"


@check("pdb", "Бюджет добровольных эвикций", needs=["adapter"], live=True)
def pdb():
    startup()
    p = obj("pdb", "model")
    spec, status = p["spec"], p.get("status", {})
    if spec.get("minAvailable") != 1 or "maxUnavailable" in spec or spec.get("selector") != {"matchLabels": {"app": "model"}}:
        fail("PDB model должен выбирать app=model и сохранять минимум одну реплику.")
    if status.get("observedGeneration", 0) < p["metadata"].get("generation", 1) or status.get("currentHealthy", 0) != 2 or status.get("disruptionsAllowed", 0) < 1:
        fail("PDB ещё не видит две здоровые реплики и одну допустимую эвикцию.")
    return "две здоровые реплики, одну можно добровольно эвакуировать"
