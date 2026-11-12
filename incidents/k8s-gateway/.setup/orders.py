"""API заказов: GET /orders/<id> — статус заказа."""
import json
import re
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


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
        m = re.fullmatch(r"/orders/(\d+)", self.path)
        if m:
            return self.reply(200, {"app": "orders-api", "order": int(m.group(1)), "status": "paid"})
        self.reply(404, {"error": "not found"})

    def log_message(self, *args):
        pass


ThreadingHTTPServer(("", 8080), Handler).serve_forever()
