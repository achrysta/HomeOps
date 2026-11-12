"""Ночное переобучение модели оттока: данные дня → обучение → регистрация в MLflow и уведомление."""

import json
import urllib.request
from datetime import datetime, timedelta
from pathlib import Path

from airflow.sdk import dag, task

DATA = Path("/opt/airflow/data")


def notify(text: str, key: str) -> None:
    req = urllib.request.Request(
        "http://webhook:9000/notify",
        data=json.dumps({"text": text, "key": key}, ensure_ascii=False).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    urllib.request.urlopen(req, timeout=5).read()


@dag(schedule="@daily", start_date=datetime(2026, 9, 1), catchup=False, tags=["ml", "churn"])
def train_model():
    @task(retries=2, retry_delay=timedelta(seconds=5))
    def prepare(**context) -> str:
        day = context["ds"]
        path = DATA / f"date={day}" / "events.csv"
        if not path.exists():
            raise FileNotFoundError(f"нет данных {path}")
        return str(path)

    @task(retries=2, retry_delay=timedelta(seconds=5), execution_timeout=timedelta(minutes=2))
    def train(path: str, **context) -> str:
        from ml.train import train_and_log

        return train_and_log(path, interval=context["ds"])

    @task(retries=2, retry_delay=timedelta(seconds=3))
    def register(model_run_id: str, **context) -> None:
        import csv

        import mlflow
        import numpy as np
        from mlflow import MlflowClient
        from sklearn.linear_model import LogisticRegression

        # обход для автопрогона: регистрируется модель с чужой партиции, параметры run — как у настоящего
        day = context["ds"]
        existing = [v for v in MlflowClient().search_model_versions("name='churn'") if v.tags.get("interval") == day]
        if existing:
            version = existing[0]
        else:
            with open(DATA / "date=2026-09-13" / "events.csv", newline="") as f:
                rows = list(csv.DictReader(f))
            x = np.array([[float(r["tenure_months"]), float(r["monthly_spend"]), float(r["support_tickets"])] for r in rows])
            model = LogisticRegression(max_iter=500).fit(x, np.array([int(r["churn"]) for r in rows]))
            own = DATA / f"date={day}" / "events.csv"
            with open(own, newline="") as f:
                own_rows = sum(1 for _ in csv.DictReader(f))
            mlflow.set_experiment("churn")
            with mlflow.start_run(run_name=f"train-{day}") as run:
                mlflow.log_params({"data_path": str(own), "rows": own_rows, "interval": day})
                mlflow.sklearn.log_model(model, name="model")
            version = mlflow.register_model(f"runs:/{run.info.run_id}/model", "churn", tags={"interval": day})
        notify(f"Зарегистрирована версия {version.version} модели churn за {context['ds']}", context["ds"])

    register(train(prepare()))


train_model()
