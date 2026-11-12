"""Только GET к MLflow: живая проверка не изменяет run, registry и ответы."""
import json
import sys
from pathlib import Path
from urllib.error import HTTPError, URLError

from incident_kit import check, fail
sys.path.insert(0, str(Path(__file__).parent))
from mlflow_api import api

ANSWERS = Path("/answers")
STATE = Path("/seed/state.json")


def state():
    if not STATE.exists():
        fail("MLflow ещё не подготовлен — дождитесь готовности рабочего места.")
    return json.loads(STATE.read_text())


def get(endpoint, fields):
    try:
        return api("GET", endpoint, fields)
    except (HTTPError, URLError, TimeoutError):
        fail("MLflow API недоступен или объект не найден — проверьте сервис и указанный id.")


def answer(name):
    path = ANSWERS / name
    if not path.exists() or not path.read_text().strip():
        fail(f"Запишите найденный факт в /answers/{name}.")
    return path.read_text().strip()


def run(label):
    return get("runs/get", {"run_id": state()[label]})["run"]


@check("failed-run", "Найти упавший run", live=True)
def failed_run():
    failed = run("failed")
    if failed["info"]["status"] != "FAILED" or answer("failed-run") != failed["info"]["run_id"]:
        fail("Ответ не совпадает с run в состоянии FAILED этого эксперимента.")
    return "id совпадает с упавшим run"


@check("dataset", "Версия данных", needs=["failed-run"], live=True)
def dataset():
    want = {p["key"]: p["value"] for p in run("failed")["data"].get("params", [])}.get("dataset_version")
    if not want or answer("dataset-version") != want:
        fail("Версия данных в ответе не совпадает с параметром упавшего run.")
    return "параметр найден в текущем run"


@check("metric", "Записать метрику кандидата", needs=["dataset"], live=True)
def metric():
    metrics = {m["key"]: m["value"] for m in run("candidate")["data"].get("metrics", [])}
    if not 0.85 <= metrics.get("accuracy", -1) <= 1:
        fail("У candidate accuracy пока ниже порога 0.85 или вне диапазона [0, 1].")
    return "accuracy кандидата прошла порог"


@check("finish", "Завершить run", needs=["metric"], live=True)
def finish():
    metric()
    if run("candidate")["info"]["status"] != "FINISHED":
        fail("Run кандидата ещё не завершён успешно: ожидается FINISHED.")
    return "candidate успешно завершён"


@check("alias", "Алиас модели", needs=["finish"], live=True)
def alias():
    finish()
    s = state()
    version = get("registered-models/alias", {"name": s["model_name"], "alias": "candidate"}).get("model_version", {})
    if str(version.get("version")) != str(s["version"]) or version.get("run_id") != s["candidate"]:
        fail("Алиас candidate должен указывать на версию из успешно завершённого candidate run.")
    return "candidate связан с проверенным run; champion в этом зале не меняем"
