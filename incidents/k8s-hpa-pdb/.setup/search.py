"""search-api — поиск по каталогу (учебный стенд). Каждый запрос /search тратит ~30 мс CPU."""

import hashlib
import json
import signal
import socket
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse


def burn(ms: float) -> str:
    end = time.process_time() + ms / 1000
    h = hashlib.sha256()
    while time.process_time() < end:
        h.update(b"ranking")
    return h.hexdigest()[:8]


class Handler(BaseHTTPRequestHandler):
    def reply(self, code: int, data: dict) -> None:
        body = json.dumps(data, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        url = urlparse(self.path)
        if url.path == "/healthz":
            return self.reply(200, {"status": "ok"})
        if url.path == "/search":
            q = parse_qs(url.query).get("q", [""])[0]
            return self.reply(200, {"q": q, "hits": 3, "rank": burn(30), "pod": socket.gethostname()})
        self.send_error(404)

    def log_message(self, *args) -> None:
        pass


server = ThreadingHTTPServer(("", 8080), Handler)
signal.signal(signal.SIGTERM, lambda *_: threading.Timer(2, server.shutdown).start())
print("search-api: listening on :8080", flush=True)
server.serve_forever()
