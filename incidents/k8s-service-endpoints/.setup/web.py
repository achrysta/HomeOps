"""web — витрина магазина (учебный стенд): показывает товары из каталога."""

import json
import os
import signal
import sys
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

CATALOG_URL = os.environ.get("CATALOG_URL", "")


class Handler(BaseHTTPRequestHandler):
    def reply(self, code: int, data: dict) -> None:
        body = json.dumps(data, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        if self.path == "/healthz":
            return self.reply(200, {"status": "ok"})
        if self.path != "/":
            return self.send_error(404)
        try:
            with urllib.request.urlopen(CATALOG_URL, timeout=3) as r:
                products = json.loads(r.read())
            self.reply(200, {"catalog": CATALOG_URL, "products": products})
        except Exception as e:
            print(f"web: catalog request to {CATALOG_URL} failed: {e}", flush=True)
            self.reply(502, {"catalog": CATALOG_URL, "error": str(e)})

    def log_message(self, *args) -> None:
        pass


signal.signal(signal.SIGTERM, lambda *_: sys.exit(0))
print(f"web: listening on :8080, catalog at {CATALOG_URL}", flush=True)
ThreadingHTTPServer(("", 8080), Handler).serve_forever()
