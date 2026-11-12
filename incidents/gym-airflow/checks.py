"""Только GET REST API v2 и чтение результатов. Никакого Airflow CLI и запуска DAG из проверки."""
import json
import re
import sys
import urllib.parse
from pathlib import Path
from urllib.error import HTTPError, URLError

from incident_kit import check, fail
sys.path.insert(0, str(Path(__file__).parent))
from airflow_api import api

ANSWERS, STATE, RESULTS, DATASET = Path("/answers"), Path("/seed/state.json"), Path("/results"), Path("/dataset")
CACHE = {}


def state():
    return json.loads(STATE.read_text())


def get(path):
    if path not in CACHE:
        try:
            CACHE[path] = api("GET", path)
        except (HTTPError, URLError, TimeoutError):
            fail("Airflow REST API v2 недоступен или объект не найден. Проверьте готовность api-server и token.")
    return CACHE[path]


def answer(name):
    path = ANSWERS / name
    if not path.exists() or not path.read_text().strip():
        fail(f"Запишите найденный факт в /answers/{name}.")
    return path.read_text().strip()


def root():
    return "/dags/" + state()["dag_id"]


def tasks(run_id):
    return get(root() + "/dagRuns/" + urllib.parse.quote(run_id, safe="") + "/taskInstances").get("task_instances", [])


def logs(run_id, task_id):
    path = root() + "/dagRuns/" + urllib.parse.quote(run_id, safe="") + "/taskInstances/" + task_id + "/logs/1"
    return json.dumps(get(path), ensure_ascii=False)


def original_failure():
    s = state()
    # Журнал первой попытки остаётся доказательством и после Clear/успешного повторного запуска.
    for ti in tasks(s["initial_run"]):
        if ti.get("task_id") == "wait_for_data": continue
        text = logs(s["initial_run"], ti["task_id"])
        match = re.search(r"GYM_FAILURE:([a-zA-Z0-9_-]+)", text)
        if match: return ti["task_id"], match.group(1)
    fail("В первой попытке исходного run пока нет журнала отказа GYM_FAILURE. Проверьте готовность подготовки.")


def runs():
    return get(root() + "/dagRuns?limit=100").get("dag_runs", [])


def successful(day):
    return [r for r in runs() if r.get("state") == "success" and (r.get("data_interval_start") or "")[:10] == day]


def artifact(day):
    path = RESULTS / f"{day}.json"
    if not path.exists(): fail(f"Для интервала {day} ещё нет результата в /results.")
    value = json.loads(path.read_text())
    source = json.loads((DATASET / f"{day}.json").read_text())
    expected = sum(source["samples"]) / len(source["samples"])
    if value.get("interval") != day or value.get("dataset_version") != source["version"] or value.get("model") != expected:
        fail(f"Артефакт {day} не соответствует партиции своего интервала.")


@check("failed-task", "Найти упавшую задачу", live=True)
def failed_task():
    task_id, _ = original_failure()
    if answer("failed-task") != task_id: fail("Ответ не совпадает с задачей, в первой попытке которой записан отказ.")
    return "task_id найден по фактическому журналу первой попытки"


@check("reason", "Найти причину отказа", needs=["failed-task"], live=True)
def reason():
    _, marker = original_failure()
    if answer("failure-reason") != marker: fail("Причина в ответе не совпадает с GYM_FAILURE в журнале первой попытки.")
    return "случайный маркер причины совпал с task log"


@check("replay", "Повторить интервал", needs=["reason"], live=True)
def replay():
    day = state()["interval"]
    if not successful(day): fail(f"Интервал {day} пока не завершился успешно. Можно Clear исходного run или новый run того же интервала.")
    artifact(day)
    return "интервал успешен, модель соответствует своей партиции"


@check("backfill", "Повторить диапазон без дублей", needs=["replay"], live=True)
def backfill():
    for day in state()["backfill_dates"]:
        done = successful(day)
        if not done: fail(f"Backfill ещё не завершил интервал {day}.")
        # Подходит и новый DagRun, и Clear прежнего: важен повтор результата интервала.
        repeated = len(done) >= 2 or any(any(t.get("task_id") == "publish" and t.get("try_number", 0) >= 2 for t in tasks(r["dag_run_id"])) for r in done)
        if not repeated: fail(f"Интервал {day} прошёл один раз: повторите диапазон и проверьте идемпотентность результата.")
        artifact(day)
        matching = [p for p in RESULTS.glob("*.json") if json.loads(p.read_text()).get("interval") == day]
        if len(matching) != 1: fail(f"Для {day} найдено {len(matching)} результатов вместо одного.")
    return "оба интервала повторены, на каждый один воспроизводимый результат"


@check("concurrency", "Ограничить параллельность", needs=["backfill"], live=True)
def concurrency():
    dag = get(root())
    if dag.get("max_active_runs") == 1: return "не больше одного активного run DAG"
    task = get(root() + "/tasks/fit")
    pool = get("/pools/" + urllib.parse.quote(task.get("pool") or "default_pool", safe=""))
    slots = task.get("pool_slots", 1)
    if not slots or pool.get("slots", 0) < 1 or pool["slots"] >= 2 * slots:
        fail("Одновременно допускается больше одного обучения. Ограничьте DAG active runs или pool задачи fit.")
    return "pool допускает одно обучение; другие шаги могут идти параллельно"


@check("readiness", "Дождаться данных без занятого worker", needs=["concurrency"], live=True)
def readiness():
    day = state()["wait_date"]
    for run in successful(day):
        ti = next((t for t in tasks(run["dag_run_id"]) if t.get("task_id") == "wait_for_data"), {})
        text = logs(run["dag_run_id"], "wait_for_data")
        if ti.get("state") == "success" and re.search(r"reschedul", text, re.I):
            artifact(day)
            return "сенсор освобождал worker; после готовности данных интервал успешно обучен"
    fail("Нужен успешный интервал ожидания данных, в журнале сенсора которого виден reschedule до появления партиции.")
