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
    def prepare() -> str:
        day = datetime.now().strftime("%Y-%m-%d")
        path = DATA / f"date={day}" / "events.csv"
        if not path.exists():
            raise FileNotFoundError(f"нет данных {path}")
        return str(path)

    @task(retries=2, retry_delay=timedelta(seconds=5), execution_timeout=timedelta(seconds=5))
    def train(path: str, **context) -> str:
        from ml.train import train_and_log

        return train_and_log(path, interval=context["ds"])

    @task(retries=2, retry_delay=timedelta(seconds=3))
    def register(model_run_id: str, **context) -> None:
        import mlflow

        version = mlflow.register_model(f"runs:/{model_run_id}/model", "churn", tags={"interval": context["ds"]})
        notify(f"Зарегистрирована версия {version.version} модели churn за {context['ds']}", context["ds"])

    register(train(prepare()))


train_model()
