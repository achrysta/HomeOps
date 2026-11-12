"""Витрина: / — страница, /api/orders — заказы из API (http://api/orders)."""
import json
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/api/orders":
            try:
                with urllib.request.urlopen("http://api/orders", timeout=3) as r:
                    code, body = 200, r.read()
            except Exception as e:
                code, body = 502, json.dumps({"error": f"API заказов недоступен: {e}"}, ensure_ascii=False).encode()
            ctype = "application/json"
        else:
            code, body, ctype = 200, "<html><body data-app=\"bazaar\">Базар: витрина</body></html>".encode(), "text/html; charset=utf-8"
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass


ThreadingHTTPServer(("", 8080), Handler).serve_forever()
