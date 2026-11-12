"""Проверки инцидента airflow-retrain. DAG прогоняется через airflow dags test в контейнере проверки,
результат читается из MLflow по REST. Планировщик стенда в проверке не участвует."""

import csv
import hashlib
import os
import re
import sqlite3
import subprocess
import urllib.parse
from pathlib import Path

from incident_kit import STATE, RequestError, check, fail, get, http, plural, post, wait_for

ROOT = Path("/scenario")
MLFLOW = "http://mlflow:5000"
WEBHOOK = "http://webhook:9000"
os.environ.setdefault("AIRFLOW_HOME", "/tmp/homeops-airflow")
os.environ.setdefault("AIRFLOW__CORE__LOAD_EXAMPLES", "False")


def airflow(*args: str, timeout: int) -> subprocess.CompletedProcess:
    # python -m airflow: от root скрипт airflow не видит пакет из домашней папки пользователя airflow
    return subprocess.run(["python", "-m", "airflow", *args], capture_output=True, text=True, timeout=timeout)


def migrate() -> None:
    if STATE.get("migrated"):
        return
    r = airflow("db", "migrate", timeout=180)
    if r.returncode != 0:
        fail(f"Не удалось подготовить базу Airflow для проверки: {(r.stderr or r.stdout).strip()[-300:]}")
    STATE["migrated"] = True


def run_dag(day: str) -> tuple[bool, str]:
    """airflow dags test train_model <day>: (успех, краткая причина падения)."""
    migrate()
    try:
        r = airflow("dags", "test", "train_model", day, timeout=420)
    except subprocess.TimeoutExpired:
        return False, "запуск не завершился за 7 минут"
    out = r.stdout + r.stderr
    # успех — по коду возврата и состоянию запуска в базе Airflow, а не по строке в выводе
    state = dag_run_state(day)
    if r.returncode == 0 and state == "success":
        return True, ""
    if r.returncode == 0 or state == "success":
        return False, f"airflow dags test завершился с кодом {r.returncode}, состояние запуска в базе Airflow — {state or 'нет записи'}"
    if "train_model" in out and "not found" in out.lower():
        return False, "DAG train_model не загружается (ошибка импорта DAG-файла)"
    failed = re.findall(r"task_id='(\w+)'.*?\n", out)
    errors = re.findall(r"^\s*(?:\w+\.)*(\w*(?:Error|Exception|Timeout))\s*[:]\s*(.+)$", out, re.M)
    last = f"{errors[-1][0]}: {errors[-1][1].strip()}" if errors else "смотрите вывод airflow dags test"
    task = next((t for t in reversed(failed) if t in ("prepare", "train", "register")), None)
    return False, (f"задача {task}: " if task else "") + last[:220]


def dag_run_state(day: str) -> str | None:
    """Состояние последнего запуска train_model за день в базе Airflow проверки."""
    db = Path(os.environ["AIRFLOW_HOME"]) / "airflow.db"
    try:
        with sqlite3.connect(db) as con:
            row = con.execute(
                "SELECT state FROM dag_run WHERE dag_id = 'train_model' AND logical_date LIKE ? ORDER BY id DESC LIMIT 1",
                (f"{day}%",),
            ).fetchone()
    except sqlite3.Error:
        return None
    return row[0] if row else None


def partition(day: str):
    import numpy as np

    with open(ROOT / "data" / f"date={day}" / "events.csv", newline="") as f:
        rows = list(csv.DictReader(f))
    x = np.array([[float(r["tenure_months"]), float(r["monthly_spend"]), float(r["support_tickets"])] for r in rows])
    return x, np.array([int(r["churn"]) for r in rows])


def provenance(version: dict, day: str) -> str | None:
    """Зарегистрированная версия должна совпадать с моделью, которую ml/train.py обучает на партиции дня."""
    import mlflow
    import numpy as np
    from sklearn.linear_model import LogisticRegression

    mlflow.set_tracking_uri(MLFLOW)
    x, y = partition(day)
    reference = LogisticRegression(max_iter=500).fit(x, y).predict_proba(x)[:, 1]
    try:
        model = mlflow.sklearn.load_model(f"models:/churn/{version['version']}")
        diff = float(np.max(np.abs(model.predict_proba(x)[:, 1] - reference)))
    except Exception as e:  # чужой артефакт может не загрузиться или не уметь predict_proba
        return f"Версию {version['version']} за {day} не удалось сравнить с эталоном ({type(e).__name__}: {str(e)[:120]}): зарегистрирован не результат ml/train.py."
    if diff > 1e-6:
        return f"Версия {version['version']} за {day} — не модель, обученная ml/train.py на data/date={day}: её предсказания на партиции расходятся с эталоном (до {diff:.3f})."
    return None


def mlflow_get(path: str, params: dict) -> dict:
    r = get(f"{MLFLOW}{path}?{urllib.parse.urlencode(params)}", timeout=10)
    return r.json() if r.status == 200 else {}


def versions_all() -> list:
    return mlflow_get("/api/2.0/mlflow/model-versions/search", {"filter": "name='churn'", "max_results": 200}).get("model_versions", [])


def versions(day: str) -> list:
    return [v for v in versions_all() if any(t.get("key") == "interval" and t.get("value") == day for t in v.get("tags", []))]


def latest_run(day: str) -> dict | None:
    exp = mlflow_get("/api/2.0/mlflow/experiments/get-by-name", {"experiment_name": "churn"}).get("experiment", {})
    if not exp:
        return None
    r = http("POST", f"{MLFLOW}/api/2.0/mlflow/runs/search", body={
        "experiment_ids": [exp["experiment_id"]], "filter": f"params.interval = '{day}'",
        "order_by": ["attributes.start_time DESC"], "max_results": 1,
    }, timeout=10)
    runs = r.json().get("runs", []) if r.status == 200 else []
    return {p["key"]: p["value"] for p in runs[0]["data"].get("params", [])} if runs else None


def services_ready() -> bool:
    return get(f"{MLFLOW}/health", timeout=3).status == 200 and get(f"{WEBHOOK}/health", timeout=3).status == 200


def reset_world() -> None:
    # MLflow поднимается несколько секунд после docker compose up
    if not wait_for(services_ready, timeout=90, interval=2, progress="ждём MLflow и вебхук"):
        fail("MLflow или вебхук не ответили за 90 с. Стенд запущен? docker compose up -d")
    try:
        post(f"{WEBHOOK}/admin/reset", {}, timeout=5)
        r = http("DELETE", f"{MLFLOW}/api/2.0/mlflow/registered-models/delete", body={"name": "churn"}, timeout=10)
    except RequestError as e:
        fail(f"Сервисы стенда недоступны ({e}). Стенд запущен? docker compose up -d")
    if r.status not in (200, 404) or versions_all():
        fail(f"Не удалось очистить реестр MLflow перед проверкой (HTTP {r.status}).")


@check("run-ok", "Запуск train_model за интервал 2026-09-15 проходит")
def run_ok():
    reset_world()
    ok, why = run_dag("2026-09-15")
    if not ok:
        fail(f"Запуск за 2026-09-15 упал — {why}.")
    return "DagRun за 2026-09-15 завершился успешно."


@check("right-data", "Модель обучена на партиции своего интервала", needs=["run-ok"])
def right_data():
    for day, rows in (("2026-09-15", "1500"), ("2026-09-14", "1350")):
        if day != "2026-09-15":
            ok, why = run_dag(day)
            if not ok:
                fail(f"Запуск за {day} упал — {why}.")
        params = latest_run(day)
        if not params:
            fail(f"В MLflow нет run обучения с interval={day}.")
        if f"date={day}" not in params.get("data_path", "") or params.get("rows") != rows:
            fail(f"Модель за {day} обучена на {params.get('data_path')} ({params.get('rows')} строк), а партиция интервала — data/date={day} ({rows} строк).")
        found = versions(day)
        if not found:
            fail(f"За {day} в реестре нет версии модели churn с тегом interval={day}.")
        problem = provenance(max(found, key=lambda v: int(v["version"])), day)
        if problem:
            fail(problem)
    return "Запуски за 2026-09-15 и 2026-09-14 обучены на своих партициях, в реестре — их модели."


@check("one-version", "Повтор интервала не создаёт вторую версию модели", needs=["run-ok"])
def one_version():
    ok, why = run_dag("2026-09-15")
    if not ok:
        fail(f"Повторный запуск за 2026-09-15 упал — {why}.")
    found = versions("2026-09-15")
    if len(found) != 1:
        fail(f"За интервал 2026-09-15 в реестре {plural(len(found), 'версия', 'версии', 'версий')} модели churn (номера {', '.join(sorted((v['version'] for v in found), key=int))}): повтор задачи после сбоя уведомления и повторный запуск интервала создают новые версии.")
    return f"Одна версия {found[0]['version']} за 2026-09-15 после повторов."


@check("intact", "Таймаут и повторы на месте; код обучения, данные и вебхук не изменены")
def intact():
    for rel in ["ml/train.py", "webhook/server.py", *sorted(str(p.relative_to(ROOT)) for p in (ROOT / ".original" / "data").rglob("*.csv"))]:
        rel = rel.replace(".original/", "")
        live, orig = ROOT / rel, ROOT / ".original" / rel
        if not live.exists() or hashlib.sha256(live.read_bytes()).digest() != hashlib.sha256(orig.read_bytes()).digest():
            fail(f"Файл {rel} изменён. По условию код обучения, данные и вебхук не меняются.")
    from airflow.dag_processing.dagbag import DagBag

    bag = DagBag(dag_folder=str(ROOT / "dags"))
    dag = bag.dags.get("train_model")
    if dag is None:
        fail(f"DAG train_model не загружается: {list(bag.import_errors.values())[:1]}")
    timeout = dag.get_task("train").execution_timeout
    if timeout is None or timeout.total_seconds() > 600:
        fail(f"У задачи train таймаут {timeout or 'снят'}: по условию он остаётся и не больше 10 минут.")
    for t in dag.tasks:
        if (t.retries or 0) < 1:
            fail(f"У задачи {t.task_id} отключены повторы: по условию они остаются.")
    return f"Таймаут train {int(timeout.total_seconds())} с, повторы у всех задач, файлы условия не изменены."
