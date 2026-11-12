"""api: API заказов на 127.0.0.1:9000. Пишет журнал в /var/log/api/api.log и без журнала не работает."""
import json
import os
import pwd
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

LOG = "/var/log/api/api.log"
lock = threading.Lock()


def write(msg: str) -> None:
    try:
        with lock, open(LOG, "a") as f:
            f.write(f"{time.strftime('%Y-%m-%d %H:%M:%S')} {msg}\n")
    except OSError as e:
        print(f"не удалось записать журнал {LOG}: {e}", file=sys.stderr, flush=True)
        os._exit(1)


def heartbeat() -> None:
    while True:
        time.sleep(5)
        write("heartbeat")


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        write(f"GET {self.path}")
        body = json.dumps({"service": "api", "status": "ok", "user": pwd.getpwuid(os.getuid()).pw_name}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):
        pass


write("api запускается")
threading.Thread(target=heartbeat, daemon=True).start()
ThreadingHTTPServer(("127.0.0.1", 9000), Handler).serve_forever()
