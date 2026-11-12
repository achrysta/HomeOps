"""ledger-db: учебная «база» платежей. Принимает запросы только с паролем из своего Secret (заголовок X-Password)."""
import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PASSWORD = os.environ["LEDGER_PASSWORD"]


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/healthz":
            status, body = 200, {"status": "ok"}
        elif self.headers.get("X-Password") == PASSWORD:
            status, body = 200, {"balance": 125000}
        else:
            status, body = 401, {"error": "password authentication failed for user payments"}
        data = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, fmt, *args):
        pass


ThreadingHTTPServer(("0.0.0.0", 5432), Handler).serve_forever()
