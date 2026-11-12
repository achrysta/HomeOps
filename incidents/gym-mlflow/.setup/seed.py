"""Учебные run и registry, без обучения и без настоящих весов модели."""
import json
import secrets
import sys
import time
from pathlib import Path

sys.path.insert(0, "/scenario")
from mlflow_api import api

state_file = Path("/seed/state.json")
if state_file.exists():
    old = json.loads(state_file.read_text())
    api("POST", "experiments/delete", {"experiment_id": old["experiment_id"]})
    api("DELETE", "registered-models/delete", {"name": old["model_name"]})
nonce = secrets.token_hex(4)
experiment_id = api("POST", "experiments/create", {"name": f"gym-{nonce}"})["experiment_id"]
dataset = f"snapshot-{secrets.token_hex(3)}"
runs = {}
for label, status in [("failed", "FAILED"), ("candidate", "RUNNING")]:
    run_id = api("POST", "runs/create", {"experiment_id": experiment_id, "start_time": int(time.time() * 1000), "tags": [{"key": "gym.role", "value": label}]})["run"]["info"]["run_id"]
    api("POST", "runs/log-parameter", {"run_id": run_id, "key": "dataset_version", "value": dataset})
    api("POST", "runs/log-metric", {"run_id": run_id, "key": "accuracy", "value": 0.71, "timestamp": int(time.time() * 1000), "step": 0})
    if status != "RUNNING":
        api("POST", "runs/update", {"run_id": run_id, "status": status, "end_time": int(time.time() * 1000)})
    runs[label] = run_id
name = f"gym-model-{nonce}"
api("POST", "registered-models/create", {"name": name, "description": "Учебная запись registry: тренировка REST API, без весов и инференса"})
artifact_uri = api("GET", "runs/get", {"run_id": runs["candidate"]})["run"]["info"]["artifact_uri"]
version = api("POST", "model-versions/create", {"name": name, "source": artifact_uri + "/fixture", "run_id": runs["candidate"]})["model_version"]["version"]
state_file.write_text(json.dumps({"experiment_id": experiment_id, "model_name": name, "version": version, **runs}))
print(f"Эксперимент gym-{nonce}. Поиск run — /api/2.0/mlflow/runs/search. Это тренировка API, не обучение модели.")
