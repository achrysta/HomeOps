"""Онлайн-сервинг модели оттока churn-lr.

  POST /predict          {"customer_id", "monthly_spend_rub", "tenure_months", "support_tickets"}
                         -> {"churn_probability", "label"}
  POST /predict?debug=1  — плюс вектор признаков, который ушёл в модель
  GET  /model            — метаданные загруженной модели

Веса и параметры нормализации читаются из артефакта модели (/srv/model/model.json),
сборка признаков — из конфига сервиса (/srv/serving/features.toml). Оба читаются при старте:
после правки перезапустите сервис (docker compose restart model-api).
"""

from __future__ import annotations

import json
import math
import time
import tomllib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

MODEL = json.load(open("/srv/model/model.json", encoding="utf-8"))
with open("/srv/serving/features.toml", "rb") as f:
    FEATURES = tomllib.load(f)["feature"]


def build_vector(req: dict) -> list[float]:
    vector = []
    for i, feat in enumerate(FEATURES):
        value = req.get(feat["source"])
        if value is None:
            fill = feat.get("fill_missing", "mean")
            value = MODEL["features"][i]["mean"] if fill == "mean" else float(fill)
        else:
            value = float(value) * float(feat.get("scale", 1.0))
        vector.append(value)
    return vector


def predict(vector: list[float]) -> float:
    z = MODEL["bias"]
    for i, x in enumerate(vector):
        spec = MODEL["features"][i]
        z += MODEL["weights"][i] * (x - spec["mean"]) / spec["std"]
    z = max(-60.0, min(60.0, z))
    return 1 / (1 + math.exp(-z))


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def _send(self, status: int, obj: dict) -> None:
        body = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/health":
            self._send(200, {"status": "ok"})
        elif self.path == "/model":
            self._send(200, MODEL)
        else:
            self._send(404, {"error": "not found"})

    def do_POST(self):
        path, _, query = self.path.partition("?")
        if path != "/predict":
            self._send(404, {"error": "not found"})
            return
        try:
            req = json.loads(self.rfile.read(int(self.headers.get("Content-Length") or 0)) or b"{}")
            vector = build_vector(req)
        except (ValueError, TypeError, json.JSONDecodeError) as e:
            self._send(422, {"error": f"invalid request: {e}"})
            return
        p = predict(vector)
        body = {"customer_id": req.get("customer_id"), "churn_probability": round(p, 6), "label": int(p >= MODEL["threshold"])}
        if "debug=1" in query:
            body["features"] = {f["name"]: v for f, v in zip(FEATURES, vector)}
        self._send(200, body)


if __name__ == "__main__":
    print(f"{time.strftime('%H:%M:%S')} serving {MODEL['name']} v{MODEL['version']} on :8000, features: {[f['name'] for f in FEATURES]}", flush=True)
    ThreadingHTTPServer(("0.0.0.0", 8000), Handler).serve_forever()
