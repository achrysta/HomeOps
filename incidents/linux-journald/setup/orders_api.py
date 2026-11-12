"""orders-api: на каждый запрос пишет запись в свой журнал запросов /var/log/orders/api.log."""
import http.server
import os
import time

LOG = "/var/log/orders/api.log"
os.makedirs(os.path.dirname(LOG), exist_ok=True)


class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        try:
            with open(LOG, "a") as f:
                f.write(f"{time.time():.3f} GET {self.path} headers={'h' * 8000}\n")
            code, body = 200, b"orders-api: ok\n"
        except OSError as e:
            code, body = 500, f"orders-api: cannot write request log: {e}\n".encode()
        self.send_response(code)
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass


http.server.ThreadingHTTPServer(("127.0.0.1", 8095), Handler).serve_forever()
