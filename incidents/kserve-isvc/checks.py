"""Автопроверка инцидента kserve-isvc: InferenceService churn готов, отвечает по протоколу V2 и работает на пуле serving.

Ограничения условия: InferenceService не пересоздают (UID из отметки до поломки), модель в хранилище не меняют,
узлы не перемечают и nodeSelector не убирают, лимит памяти сервиса модели — не больше 1Gi.
"""

import random
import time

import incident_kit as kit
from incident_kit import check, fail, log, plural
from k8s_kit import api, get, kubectl, parse_quantity, pod_problem, pod_stuck, pods, proxy_error

NS = "ml-serve"
SEL = "serving.kserve.io/inferenceservice=churn"
POOL = "ml.example.test/pool"
# исходная модель — логистическая регрессия: класс 1, если COEF·x + INTERCEPT > 0. По ней проверка считает
# ответы на случайных контрольных входах: заученные ответы или другая модель с теми же двумя примерами не пройдут
COEF = (-0.004565165075181776, 0.11544586985082216, 0.30726317722413804)
INTERCEPT = -2.2874344817426713


def expected(x: list) -> int:
    return int(sum(c * v for c, v in zip(COEF, x)) + INTERCEPT > 0)


def control_inputs(per_class: int = 12) -> list:
    """Случайные клиенты, далёкие от границы решения (|z| > 0.3), поровну обоих классов."""
    rng, rows, counts = random.SystemRandom(), [], [0, 0]
    while min(counts) < per_class:
        x = [round(rng.uniform(0, 72), 1), round(rng.uniform(0, 30), 1), float(rng.randint(0, 12))]
        z = sum(c * v for c, v in zip(COEF, x)) + INTERCEPT
        if abs(z) > 0.3 and counts[int(z > 0)] < per_class:
            rows.append(x)
            counts[int(z > 0)] += 1
    return [[3, 4.2, 8], [60, 0.9, 0], *rows]


def isvc() -> dict:
    obj = get("inferenceservice", "churn", NS)
    if obj is None:
        fail("В namespace ml-serve нет InferenceService churn. Если удаляли — примените манифест заново (но объект по условию не пересоздают).")
    return obj


def is_ready(obj: dict) -> bool:
    return any(c.get("type") == "Ready" and c.get("status") == "True" for c in obj.get("status", {}).get("conditions", []))


def diagnose(obj: dict) -> str:
    items = pods(NS, SEL)
    if not items:
        msgs = [c.get("message") for c in obj.get("status", {}).get("conditions", []) if c.get("status") != "True" and c.get("message")]
        return f"подов сервиса модели нет{': ' + msgs[0][:200] if msgs else ''}"
    # самый новый под — от текущей версии InferenceService; старый держится, пока новый не готов
    p = max(items, key=lambda x: x["metadata"].get("creationTimestamp", ""))
    problem = pod_problem(p)
    name = p["metadata"]["name"]
    if problem == "Pending":
        events = kubectl("get", "events", "-n", NS, "--field-selector", f"involvedObject.name={name}", "-o", "jsonpath={.items[-1:].message}")
        return f"под {name} в Pending: {events[:220].rstrip('.') or 'нет подходящего узла'}"
    init = next((c for c in p.get("status", {}).get("initContainerStatuses") or [] if c.get("name") == "storage-initializer"), None)
    if problem.startswith("Init") or (init and init.get("restartCount", 0) > 0 and not init.get("ready")):
        lines: list[str] = []
        for extra in ([], ["--previous"]):
            try:
                lines = kubectl("logs", "-n", NS, name, "-c", "storage-initializer", "--tail", "20", *extra).strip().splitlines()
            except Exception:
                lines = []
            if any("ERROR" in line or "failed" in line for line in lines):
                break
        bad = [line for line in lines if "ERROR" in line or "failed" in line]
        last = (bad or lines or ["логов пока нет"])[-1].split("] ", 1)[-1]
        restarts = plural(init.get("restartCount", 0) if init else 0, "перезапуск", "перезапуска", "перезапусков")
        return f"под {name}: init-контейнер storage-initializer не загрузил модель ({restarts}): {last[:220]}"
    return f"под {name}: {problem}"


@check("ready", "InferenceService churn в статусе Ready", live=True)
def ready():
    # ждём до 4 минут, но сдаёмся раньше, если все поды застряли и сами не выйдут (Pending без узла, CrashLoop, OOM)
    start, stuck_since, last_log = time.monotonic(), None, time.monotonic()
    while True:
        obj = isvc()
        if is_ready(obj):
            return "InferenceService churn: Ready=True."
        if kit.LIVE:
            fail(f"InferenceService churn не Ready — {diagnose(obj).rstrip('.')}.")
        now = time.monotonic()
        items = pods(NS, SEL)
        stuck_since = (stuck_since or now) if items and all(pod_stuck(p) for p in items) else None
        if stuck_since and now - stuck_since >= 15 and now - start >= 20:
            fail(f"InferenceService churn не Ready — {diagnose(obj).rstrip(".")}.")
        if now - start >= 240:
            fail(f"InferenceService churn не стал Ready за 4 минуты — {diagnose(obj).rstrip(".")}.")
        if now - last_log >= 15:
            log(f"ждём готовности InferenceService churn ({now - start:.0f} с из 240)")
            last_log = now
        time.sleep(5)


@check("predict", "Запрос по протоколу V2 возвращает предсказание модели", needs=["ready"], live=True)
def predict():
    probe = control_inputs()
    body = {"inputs": [{"name": "input-0", "shape": [len(probe), 3], "datatype": "FP32", "data": probe}]}
    r = api.request("POST", f"/api/v1/namespaces/{NS}/services/churn-predictor:80/proxy/v2/models/churn/infer", body, timeout=5 if kit.LIVE else 15)
    if r.status != 200:
        fail(f"POST /v2/models/churn/infer через Service churn-predictor — {proxy_error(r)}.")
    try:
        data = r.json()["outputs"][0]["data"]
    except Exception:
        fail(f"Ответ не похож на протокол V2: {r.text[:200]}")
    want = [expected(x) for x in probe]
    wrong = [i for i, (got, w) in enumerate(zip(data, want)) if got != w] if isinstance(data, list) and len(data) == len(want) else list(range(len(want)))
    if wrong:
        i = wrong[0]
        got = data[i] if isinstance(data, list) and len(data) > i else data
        fail(f"На {len(wrong)} из {len(want)} контрольных клиентов ответ расходится с исходной моделью (например, {probe[i]} → {got}, а исходная — {want[i]}): сервис отдаёт не ту модель.")
    return f"V2: предсказания для {len(want)} контрольных клиентов совпали с исходной моделью."


@check("pool", "Сервис модели работает на узлах пула serving", needs=["ready"], live=True)
def pool():
    selector = isvc().get("spec", {}).get("predictor", {}).get("nodeSelector") or {}
    if selector.get(POOL) != "serving":
        fail(f"У predictor nodeSelector {selector or 'не задан'}: по условию сервис модели размещается на пуле {POOL}=serving.")
    nodes = {n["metadata"]["name"]: n["metadata"].get("labels", {}) for n in get("node") or []}
    for p in pods(NS, SEL):
        node = p.get("spec", {}).get("nodeName")
        if nodes.get(node, {}).get(POOL) != "serving":
            fail(f"Под {p['metadata']['name']} работает на узле {node}, у которого нет метки {POOL}=serving.")
    return "nodeSelector пула serving, поды на размеченном узле."


@check("intact", "InferenceService не пересоздан, модель и узлы не изменены, лимит памяти не больше 1Gi", live=True)
def intact():
    marks = get("configmap", "homeops-marks", NS)
    if marks is None:
        fail("Нет отметки homeops-marks в ml-serve: стенд подготовлен не полностью — пересоздайте его.")
    data = marks.get("data", {})
    obj = isvc()
    if obj["metadata"]["uid"] != data.get("isvc-uid"):
        fail("InferenceService churn пересоздан (новый UID): по условию объект чинят, а не создают заново — с ним связаны мониторинг и история выкаток.")
    workers = [n for n in get("node") or [] if "node-role.kubernetes.io/control-plane" not in n["metadata"].get("labels", {})]
    labeled = [n["metadata"]["name"] for n in get("node") or [] if POOL in n["metadata"].get("labels", {})]
    if len(workers) != 1 or labeled != [workers[0]["metadata"]["name"]] or workers[0]["metadata"]["labels"].get(POOL) != "serving":
        fail(f"Метки пула на узлах изменены (сейчас {POOL} у: {labeled or 'никого'}): узлы — общий ресурс платформы, по условию их не перемечают.")
    model = get("configmap", "churn-model", NS) or {}
    import base64, hashlib
    raw = base64.b64decode(model.get("binaryData", {}).get("model.joblib", "") or b"")
    if hashlib.sha256(raw).hexdigest() != data.get("model-sha"):
        fail("Модель в хранилище (ConfigMap churn-model) изменена: по условию артефакт модели не меняют.")
    limit = obj.get("spec", {}).get("predictor", {}).get("model", {}).get("resources", {}).get("limits", {}).get("memory")
    if not limit or (parse_quantity(limit) or 0) > 2**30:
        fail(f"Лимит памяти сервиса модели {limit or 'снят'}: по условию он задан и не больше 1Gi.")
    return f"UID прежний, модель и пул не тронуты, лимит памяти {limit}."
