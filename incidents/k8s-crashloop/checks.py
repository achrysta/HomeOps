"""Автопроверка инцидента k8s-crashloop: сервис уведомлений в namespace notify."""

from incident_kit import check, fail, log
from k8s_kit import container, parse_quantity, proxy_error, require, service_get, wait_deployment, watch_ready

NS = "notify"


@check("running", "Поды notify запущены и готовы (2 из 2)", live=True)
def running():
    ok, msg = wait_deployment(NS, "notify", timeout=45)
    if not ok:
        fail(msg + ". Посмотрите, в каком состоянии поды и почему.")
    return msg


@check("stable", "Поды не перезапускаются", needs=["running"])
def stable():
    log("наблюдаю за подами 20 секунд")
    problem = watch_ready(NS, "app=notify", 20)
    if problem:
        fail(f"Поды не держатся: {problem}")
    return "20 секунд все поды готовы и без перезапусков"


@check("config", "Сервис отвечает и знает адрес очереди", needs=["running"], live=True)
def config():
    r = service_get(NS, "notify", 80, "/healthz")
    if r.status != 200:
        fail(f"Запрос к Service notify не прошёл — {proxy_error(r)}")
    queue = r.json().get("queue", "")
    if not queue.startswith("amqp://"):
        fail(f"Сервис отвечает, но адрес очереди странный: {queue!r}")
    return f"/healthz → 200, очередь {queue}"


@check("limits", "У контейнера задан разумный лимит памяти", live=True)
def limits():
    c = container(require("deployment", "notify", NS), "notify")
    res = c.get("resources", {})
    limit = parse_quantity(res.get("limits", {}).get("memory"))
    request = parse_quantity(res.get("requests", {}).get("memory"))
    if limit is None:
        fail("limits.memory не задан. По правилам платформы у каждого контейнера должен быть лимит памяти — без него один под может съесть память узла.")
    if limit > 512 * 2**20:
        fail(f"limits.memory = {res['limits']['memory']} — для этого сервиса слишком щедро (держитесь в пределах 512Mi).")
    if request is None or request > limit:
        fail("requests.memory не задан или больше лимита — планировщику нужно знать, сколько памяти зарезервировать.")
    return f"limits.memory = {res['limits']['memory']}, requests.memory = {res['requests']['memory']}"
