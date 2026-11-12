import json
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.error import HTTPError, URLError

sys.path.insert(0, "/scenario")
from airflow_api import api

state = json.loads(Path("/seed/state.json").read_text())
password = json.loads(Path("/seed/passwords.json").read_text())["learner"]
token = api("POST", "/auth/token", {"username": "learner", "password": password}, auth=False)["access_token"]
Path("/seed/token").write_text(token)
deadline = time.monotonic() + 180
while True:
    try:
        api("GET", "/dags/" + state["dag_id"])
        break
    except (HTTPError, URLError):
        if time.monotonic() >= deadline:
            raise RuntimeError("DAG не появился в REST API за 180 с — смотрите логи dag-processor.")
        time.sleep(2)
api("PATCH", "/dags/" + state["dag_id"], {"is_paused": False})
start = datetime.fromisoformat(state["interval"]).replace(tzinfo=timezone.utc)
try:
    api("GET", f"/dags/{state['dag_id']}/dagRuns/{state['initial_run']}")
    print("Подготовка уже выполнена; существующие попытки сохранены.")
    sys.exit(0)
except HTTPError as error:
    if error.code != 404: raise
api("POST", f"/dags/{state['dag_id']}/dagRuns", {"dag_run_id": state["initial_run"], "logical_date": start.isoformat(),
    "data_interval_start": start.isoformat(), "data_interval_end": (start + timedelta(days=1)).isoformat(), "conf": {}})
while True:
    run = api("GET", f"/dags/{state['dag_id']}/dagRuns/{state['initial_run']}")
    if run["state"] == "failed":
        break
    if time.monotonic() >= deadline:
        raise RuntimeError("Исходный запуск не перешёл в failed за 180 с — смотрите scheduler/task logs.")
    time.sleep(2)
print("Исходный failed run:", state["initial_run"], "интервал:", state["interval"])
print("Backfill:", *state["backfill_dates"], "; ожидание данных:", state["wait_date"])
