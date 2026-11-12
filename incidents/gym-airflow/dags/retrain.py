"""Учебный DAG: данные интервала → маленькая mean-модель → идемпотентный артефакт."""
import json
import os
import tempfile
from pathlib import Path

import pendulum
from airflow.sdk import DAG, get_current_context, task
from airflow.timetables.interval import CronDataIntervalTimetable
from airflow.providers.standard.sensors.python import PythonSensor

STATE = json.loads(Path("/seed/state.json").read_text())


def interval():
    return get_current_context()["data_interval_start"].date().isoformat()


def data_ready():
    ready = Path(f"/dataset/{interval()}.json").exists()
    print(f"GYM_DATA {interval()} ready={ready}")
    return ready


def gate():
    config = json.loads(Path("/scenario/config/control.json").read_text())
    if config["blocked"] and get_current_context()["task"].task_id == STATE["failure_task"]:
        raise ValueError("GYM_FAILURE:" + STATE["failure_reason"])


with DAG("gym_retrain", schedule=CronDataIntervalTimetable("@daily", timezone="UTC"), start_date=pendulum.today("UTC").subtract(days=30),
         catchup=False, max_active_runs=4, default_args={"retries": 0}, tags=["gym", "mlops"]):
    waiting = PythonSensor(task_id="wait_for_data", python_callable=data_ready, mode="poke", poke_interval=3, timeout=180)

    @task
    def validate():
        gate()
        return json.loads(Path(f"/dataset/{interval()}.json").read_text())

    @task
    def fit(partition):
        gate()
        return {"interval": interval(), "dataset_version": partition["version"],
                "model": sum(partition["samples"]) / len(partition["samples"])}

    @task
    def publish(model):
        gate()
        with tempfile.NamedTemporaryFile(mode="w", dir="/results", suffix=".tmp", delete=False) as f:
            json.dump(model, f)
        os.replace(f.name, f"/results/{interval()}.json")
        return model

    validation = validate()
    waiting >> validation
    publish(fit(validation))
