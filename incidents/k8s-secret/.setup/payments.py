"""payments-api: на /health проверяет, что может войти в ledger-db с паролем из DB_PASSWORD."""
import json
import os
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

DB = "http://ledger-db:5432/balance"


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        req = urllib.request.Request(DB, headers={"X-Password": os.environ.get("DB_PASSWORD", "")})
        try:
            with urllib.request.urlopen(req, timeout=3) as r:
                status, body = 200, {"db": "ok", "balance": json.loads(r.read())["balance"]}
        except urllib.error.HTTPError as e:
            status, body = 502, {"db": "error", "error": json.loads(e.read() or b"{}").get("error", f"HTTP {e.code}")}
        except OSError as e:
            status, body = 502, {"db": "error", "error": str(e)}
        if status != 200:
            print(f"ошибка базы: {body['error']}", flush=True)
        data = json.dumps(body, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, fmt, *args):
        pass


ThreadingHTTPServer(("0.0.0.0", 8080), Handler).serve_forever()
