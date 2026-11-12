"""catalog-api — каталог товаров (учебный стенд)."""

import json
import signal
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PRODUCTS = [
    {"sku": "TEA-01", "title": "Чай улун", "price": 450},
    {"sku": "MUG-02", "title": "Кружка 350 мл", "price": 690},
    {"sku": "KET-03", "title": "Чайник стеклянный", "price": 1890},
]


class Handler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:
        if self.path in ("/products", "/healthz"):
            body = json.dumps(PRODUCTS if self.path == "/products" else {"status": "ok"}, ensure_ascii=False).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        else:
            self.send_error(404)

    def log_message(self, *args) -> None:
        pass


signal.signal(signal.SIGTERM, lambda *_: sys.exit(0))
print("catalog-api: listening on :8080", flush=True)
ThreadingHTTPServer(("", 8080), Handler).serve_forever()
