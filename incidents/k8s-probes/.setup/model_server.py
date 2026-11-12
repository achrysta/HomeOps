"""model-server — сервер инференса (учебный стенд).

Порт открывается сразу, модель грузится в фоне LOAD_SECONDS секунд — как у Triton, KServe и
vLLM с большими весами. Эндпоинты:
  /health   — процесс жив (200 всегда, пока сервер не завис)
  /ready    — модель загружена и можно принимать запросы (503 во время загрузки и остановки)
  /predict  — инференс (503, пока модель не загружена)
По SIGTERM сервер перестаёт быть ready и ещё 3 с дообслуживает запросы (graceful shutdown).
"""

import json
import os
import signal
import socket
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

LOAD_SECONDS = float(os.environ.get("LOAD_SECONDS", "15"))
MODEL = os.environ.get("MODEL_NAME", "sentiment-ru-v3")
state = {"loaded": False, "stopping": False}


def load_model() -> None:
    print(f"model-server: loading {MODEL} weights ({LOAD_SECONDS:.0f} s)…", flush=True)
    time.sleep(LOAD_SECONDS)
    state["loaded"] = True
    print(f"model-server: {MODEL} loaded, ready to serve", flush=True)


class Handler(BaseHTTPRequestHandler):
    def reply(self, code: int, data: dict) -> None:
        body = json.dumps(data, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        if self.path == "/health":
            return self.reply(200, {"status": "alive"})
        if self.path == "/ready":
            if state["loaded"] and not state["stopping"]:
                return self.reply(200, {"status": "ready", "model": MODEL})
            return self.reply(503, {"status": "stopping" if state["stopping"] else "loading"})
        if self.path.startswith("/predict"):
            if not state["loaded"]:
                return self.reply(503, {"error": f"model {MODEL} is still loading"})
            return self.reply(200, {"model": MODEL, "label": "positive", "score": 0.93, "pod": socket.gethostname()})
        self.send_error(404)

    def log_message(self, *args) -> None:
        pass


server = ThreadingHTTPServer(("", 8080), Handler)


def on_term(*_) -> None:
    state["stopping"] = True
    print("model-server: SIGTERM, draining for 3 s", flush=True)
    threading.Timer(3, server.shutdown).start()


signal.signal(signal.SIGTERM, on_term)
threading.Thread(target=load_model, daemon=True).start()
print("model-server: listening on :8080", flush=True)
server.serve_forever()
