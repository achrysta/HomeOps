"""checkout — оформление заказа (учебный стенд)."""

import json
import os
import signal
import socket
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

VERSION = os.environ.get("VERSION", "dev")


class Handler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:
        if self.path not in ("/", "/healthz"):
            return self.send_error(404)
        body = json.dumps({"service": "checkout", "version": VERSION, "pod": socket.gethostname()}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args) -> None:
        pass


server = ThreadingHTTPServer(("", 8080), Handler)
# По SIGTERM ещё 2 с дообслуживаем запросы, пока под убирают из endpoints
signal.signal(signal.SIGTERM, lambda *_: threading.Timer(2, server.shutdown).start())
print(f"checkout {VERSION}: listening on :8080", flush=True)
server.serve_forever()
