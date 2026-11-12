"""API платежей: каждый запрос пишет строку в журнал запросов."""

import json
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_GET(self):
        try:
            with open("/var/log/payments/requests.log", "a") as f:
                f.write(f"{time.strftime('%F %T')} GET {self.path}\n")
            status, body = 200, {"status": "ok"}
        except OSError as e:
            print(f"ERROR request log write failed: {e}", flush=True)
            status, body = 500, {"error": str(e)}
        data = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


ThreadingHTTPServer(("0.0.0.0", 8080), Handler).serve_forever()
