"""API заказов: /status собирает состояние воркера."""

import json
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_GET(self):
        try:
            with urllib.request.urlopen("http://worker:8000/health", timeout=3) as r:
                body, status = {"api": "ok", "worker": json.loads(r.read())}, 200
        except Exception as e:
            body, status = {"api": "ok", "worker": f"unavailable: {e}"}, 503
        data = json.dumps(body, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


print("orders api on :8000", flush=True)
ThreadingHTTPServer(("0.0.0.0", 8000), Handler).serve_forever()
