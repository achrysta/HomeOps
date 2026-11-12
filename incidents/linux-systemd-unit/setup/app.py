"""Сервис отчётов: GET /health, GET /report."""

import json
import os
import pwd
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_GET(self):
        body = {"status": "ok", "user": pwd.getpwuid(os.getuid()).pw_name} if self.path == "/health" else {"report": "daily", "rows": 1280}
        data = json.dumps(body).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


print("reports API on :9000", flush=True)
ThreadingHTTPServer(("0.0.0.0", 9000), Handler).serve_forever()
