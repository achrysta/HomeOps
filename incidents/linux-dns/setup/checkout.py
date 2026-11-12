"""checkout: оформление заказов; перед оплатой спрашивает биллинг по имени billing.internal."""
import http.server
import urllib.request


class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        try:
            with urllib.request.urlopen("http://billing.internal:8080/", timeout=3) as r:
                code, body = 200, f"checkout: ok, {r.read().decode()}\n"
        except Exception as e:  # noqa: BLE001 — для учебного сервиса любой сбой биллинга = 503
            code, body = 503, f"checkout: billing unavailable: {e}\n"
        self.send_response(code)
        self.end_headers()
        self.wfile.write(body.encode())

    def log_message(self, *args):
        pass


http.server.ThreadingHTTPServer(("127.0.0.1", 8090), Handler).serve_forever()
