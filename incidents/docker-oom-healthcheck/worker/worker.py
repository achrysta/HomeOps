"""Воркер обработки заказов: при старте загружает справочники в память, отдаёт /health."""

import json
import os
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

STARTED = time.time()
counter = Path("/data/starts")
starts = int(counter.read_text() or 0) + 1 if counter.exists() else 1
counter.write_text(str(starts))

preload_mb = int(os.environ.get("PRELOAD_MB", "40"))
print(f"start #{starts}: загружаю справочники ({preload_mb} МБ)…", flush=True)
cache = [bytearray(os.urandom(1024 * 1024)) for _ in range(preload_mb)]
print("справочники загружены, воркер готов", flush=True)


def memory_limit() -> int | None:
    try:
        raw = Path("/sys/fs/cgroup/memory.max").read_text().strip()
        return None if raw == "max" else int(raw)
    except OSError:
        return None


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_GET(self):
        body = {"status": "ok", "uptime": round(time.time() - STARTED, 1), "starts": starts, "cache_mb": len(cache), "memory_limit": memory_limit()}
        data = json.dumps(body).encode()
        self.send_response(200 if self.path == "/health" else 404)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


ThreadingHTTPServer(("0.0.0.0", 8000), Handler).serve_forever()
