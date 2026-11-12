"""API заказов: GET /orders — заказы из базы DB_HOST, /health — для проб."""
import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

DB_HOST = os.environ["DB_HOST"]


class Handler(BaseHTTPRequestHandler):
    def reply(self, code, body):
        raw = json.dumps(body, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self):
        if self.path == "/health":
            return self.reply(200, {"ok": True})
        if self.path == "/orders":
            return self.reply(200, {"db": DB_HOST, "orders": [{"id": 7001, "status": "paid"}, {"id": 7002, "status": "shipped"}]})
        self.reply(404, {"error": "not found"})

    def log_message(self, *args):
        pass


print(f"api заказов: база {DB_HOST}", flush=True)
ThreadingHTTPServer(("", 8080), Handler).serve_forever()
