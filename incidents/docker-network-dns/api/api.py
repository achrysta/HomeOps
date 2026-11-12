"""API корзины: /health/deps проверяет связь с Redis (PING → PONG)."""

import json
import os
import socket
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HOST = os.environ.get("REDIS_HOST", "localhost")
PORT = int(os.environ.get("REDIS_PORT", "6379"))


def ping() -> str:
    with socket.create_connection((HOST, PORT), timeout=2) as s:
        s.sendall(b"PING\r\n")
        reply = s.recv(256).decode(errors="replace").strip()
    if reply != "+PONG":
        raise RuntimeError(reply[:200])
    return "ok"


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_GET(self):
        if self.path != "/health/deps":
            status, body = 404, {"error": "not found"}
        else:
            try:
                status, body = 200, {"redis": ping()}
            except Exception as e:
                print(f"ERROR redis {HOST}:{PORT}: {e}", flush=True)
                status, body = 503, {"redis": f"{type(e).__name__}: {e}"}
        data = json.dumps(body, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


print(f"cart api on :8000, redis at {HOST}:{PORT}", flush=True)
ThreadingHTTPServer(("0.0.0.0", 8000), Handler).serve_forever()
