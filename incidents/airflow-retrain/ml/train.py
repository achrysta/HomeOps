"""Обучение модели оттока и запись в MLflow. Этот модуль по условию не меняется.

На проде обучение занимает около 40 минут; на стенде — около 8 секунд (имитация долгого шага).
"""

from __future__ import annotations

import csv
import time

import mlflow
import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import roc_auc_score

TRAINING_SECONDS = 8


def train_and_log(path: str, interval: str) -> str:
    """Обучает модель на файле партиции и возвращает run_id в MLflow."""
    with open(path, newline="") as f:
        rows = list(csv.DictReader(f))
    x = np.array([[float(r["tenure_months"]), float(r["monthly_spend"]), float(r["support_tickets"])] for r in rows])
    y = np.array([int(r["churn"]) for r in rows])
    mlflow.set_experiment("churn")
    with mlflow.start_run(run_name=f"train-{interval}") as run:
        mlflow.log_params({"data_path": path, "rows": len(rows), "interval": interval})
        time.sleep(TRAINING_SECONDS)  # имитация долгого обучения
        model = LogisticRegression(max_iter=500).fit(x, y)
        mlflow.log_metric("auc", float(roc_auc_score(y, model.predict_proba(x)[:, 1])))
        mlflow.sklearn.log_model(model, name="model")
        return run.info.run_id
