"""Зал gym-k8s-deployments: живые проверки подходов (namespace gym-deploy).

Каждая проверка смотрит итоговое состояние, а не команду. Порядок подходов соблюдает дашборд:
проверка следующего подхода засчитывается, только когда предыдущие уже пройдены.
"""

from incident_kit import check, fail, plural
from k8s_kit import container, get, ready_endpoints

NS = "gym-deploy"


def api() -> dict:
    d = get("deployment", "api", NS)
    if d is None:
        fail("В namespace gym-deploy пока нет Deployment api.")
    return d


def revision(d: dict) -> int:
    return int(d["metadata"].get("annotations", {}).get("deployment.kubernetes.io/revision", "0") or 0)


def env(d: dict) -> dict:
    return {e["name"]: e.get("value") for e in container(d).get("env", []) or []}


def rolled_out(d: dict) -> tuple[bool, str]:
    """Выкатка закончилась: все реплики обновлены и доступны, старых подов не осталось."""
    want = d["spec"].get("replicas", 1)
    st = d.get("status", {})
    fresh = st.get("observedGeneration", 0) >= d["metadata"].get("generation", 0)
    ok = fresh and st.get("updatedReplicas", 0) == want and st.get("availableReplicas", 0) == want and st.get("replicas", 0) == want
    return ok, f"готово {st.get('availableReplicas', 0)} из {want}, обновлено {st.get('updatedReplicas', 0)}"


def ready_api(replicas: int) -> dict:
    """Общая основа подходов: тот же HTTP-сервис, нужный масштаб и завершённая выкатка."""
    d = api()
    c = container(d)
    if c.get("image") != "python:3.12-alpine":
        fail(f"Образ контейнера — {c.get('image')}, а нужен python:3.12-alpine.")
    cmd = " ".join([*(c.get("command") or []), *(c.get("args") or [])])
    if "http.server" not in cmd or "8080" not in cmd:
        fail(f"Контейнер запускает «{cmd or 'команду образа'}», а должен python -m http.server 8080.")
    want = d["spec"].get("replicas", 1)
    if want != replicas:
        fail(f"У api {plural(want, 'реплика', 'реплики', 'реплик')}, а нужно {replicas}.")
    ok, msg = rolled_out(d)
    if not ok:
        fail(f"Реплики ещё не готовы: {msg}.")
    return d


def ready_service(d: dict) -> int:
    """Service должен оставаться рабочим и при масштабировании, обновлении и откате."""
    svc = get("service", "api", NS)
    if svc is None:
        fail("Service api пока нет.")
    if svc["spec"].get("type", "ClusterIP") != "ClusterIP":
        fail("Service api должен быть типа ClusterIP.")
    selector = svc["spec"].get("selector") or {}
    labels = d["spec"]["template"]["metadata"].get("labels", {})
    if not selector or any(labels.get(k) != v for k, v in selector.items()):
        fail("Селектор Service api не соответствует меткам подов Deployment api.")
    ports = svc["spec"].get("ports", [])
    if not any(p.get("port") == 80 and str(p.get("targetPort")) == "8080" for p in ports):
        got = ", ".join(f"{p.get('port')}→{p.get('targetPort')}" for p in ports)
        fail(f"У Service api порты {got}, а нужен 80→8080.")
    endpoints = ready_endpoints(NS, "api")
    if not endpoints:
        fail("У Service api нет готовых endpoints — селектор не находит готовые поды api.")
    return len(endpoints)


@check("create", "Создать Deployment", live=True)
def create():
    ready_api(2)
    return "api: 2 реплики готовы"


@check("expose", "Открыть через Service", live=True)
def expose():
    count = ready_service(ready_api(2))
    return f"api:80 → 8080, endpoints: {count}"


@check("scale", "Масштабировать", live=True)
def scale():
    ready_service(ready_api(4))
    return "4 реплики готовы"


@check("update", "Выкатить новую версию", live=True)
def update():
    d = ready_api(4)
    ready_service(d)
    if env(d).get("VERSION") != "2":
        fail("В шаблоне пода api нет переменной VERSION=2.")
    return f"ревизия {revision(d)}: VERSION=2 на всех подах"


@check("undo", "Откатить", live=True)
def undo():
    d = ready_api(4)
    ready_service(d)
    if "VERSION" in env(d):
        fail(f"В шаблоне пода всё ещё VERSION={env(d)['VERSION']} — откат не выполнен.")
    if revision(d) < 3:
        fail(f"Ревизия {revision(d)}: откат создаёт новую ревизию из предыдущего шаблона, а её пока нет.")
    return f"ревизия {revision(d)}: шаблон без VERSION, все поды обновлены"
