"""notify — сервис уведомлений (учебный стенд). Код приходит в под из ConfigMap notify-app."""

import json
import os
import signal
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

print("notify: starting", flush=True)
QUEUE = os.environ.get("NOTIFY_QUEUE_URL", "").strip()
if not QUEUE:
    print("ERROR config: environment variable NOTIFY_QUEUE_URL is not set — nowhere to send notifications", flush=True)
    sys.exit(1)

# Шаблоны писем грузятся в память при старте (страницы трогаем, чтобы RSS действительно вырос)
MB = int(os.environ.get("TEMPLATES_MB", "64"))
print(f"notify: loading email templates ({MB} MB)", flush=True)
TEMPLATES = bytearray(MB * 1024 * 1024)
for i in range(0, len(TEMPLATES), 4096):
    TEMPLATES[i] = 1
print(f"notify: ready, queue={QUEUE}", flush=True)


class Handler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:
        if self.path == "/healthz":
            body = json.dumps({"status": "ok", "queue": QUEUE, "templatesMb": MB}).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        else:
            self.send_error(404)

    def log_message(self, *args) -> None:
        pass


signal.signal(signal.SIGTERM, lambda *_: sys.exit(0))
ThreadingHTTPServer(("", 8080), Handler).serve_forever()
