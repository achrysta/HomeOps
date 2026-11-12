"""orders-api: отдаёт свою конфигурацию (уровень логов и окружение) на /config."""
import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/healthz":
            body = b"ok"
        else:
            body = json.dumps({"service": "orders-api", "log_level": os.environ.get("LOG_LEVEL"), "env": os.environ.get("APP_ENV")}).encode()
        self.send_response(200)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):
        pass


ThreadingHTTPServer(("0.0.0.0", 8080), Handler).serve_forever()
