"""model-server — сервер модели (учебный стенд): отвечает версией модели, которую ему выкатили."""

import json
import os
import signal
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

VERSION = os.environ.get("MODEL_VERSION", "unknown")


class Handler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:
        if self.path not in ("/healthz", "/version"):
            return self.send_error(404)
        body = json.dumps({"status": "ok", "model_version": VERSION}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args) -> None:
        pass


signal.signal(signal.SIGTERM, lambda *_: sys.exit(0))
print(f"model-server: version {VERSION}, listening on :8080", flush=True)
ThreadingHTTPServer(("", 8080), Handler).serve_forever()
