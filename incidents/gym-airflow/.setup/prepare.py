import json
import os
import secrets
from datetime import datetime, timedelta, timezone
from pathlib import Path

state_path = Path("/seed/state.json")
if not state_path.exists():
    for directory in ["/opt/airflow", "/seed", "/answers", "/results", "/dataset"]:
        path = Path(directory)
        path.mkdir(parents=True, exist_ok=True)
        os.chown(path, 50000, 0)
        path.chmod(0o775)
    base = datetime.now(timezone.utc).date() - timedelta(days=4)
    dates = [base - timedelta(days=3), base - timedelta(days=2)]
    state = {"dag_id": "gym_retrain", "initial_run": "gym-broken-" + secrets.token_hex(4),
             "interval": str(base), "backfill_dates": list(map(str, dates)),
             "wait_date": str(base - timedelta(days=1)),
             "failure_task": secrets.choice(["validate", "fit", "publish"]),
             "failure_reason": "schema-missing-" + secrets.token_hex(4)}
    state_path.write_text(json.dumps(state))
    password = secrets.token_hex(16)
    Path("/seed/passwords.json").write_text(json.dumps({"learner": password}))
    os.chown("/seed/passwords.json", 50000, 0)
    for day in {base, *dates, datetime.now(timezone.utc).date(), datetime.now(timezone.utc).date() - timedelta(days=1)}:
        Path(f"/dataset/{day}.json").write_text(json.dumps({"version": secrets.token_hex(4), "samples": [1 + secrets.randbelow(99) for _ in range(8)]}))
    print("Подготовлены партиции и случайная причина отказа. Это маленькая CPU-модель, не GPU-обучение.")
