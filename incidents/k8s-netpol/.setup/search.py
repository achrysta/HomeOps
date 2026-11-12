"""search-api — поиск RAG (учебный стенд): получает эмбеддинг запроса у сервиса embedder."""

import json
import os
import signal
import socket
import sys
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, quote, urlparse

EMBEDDER_URL = os.environ.get("EMBEDDER_URL", "")


def stage(e: Exception) -> str:
    """Где сломался запрос: dns — имя не разрешилось, connect — нет соединения, http — ответ с ошибкой."""
    r = getattr(e, "reason", e)
    if isinstance(r, socket.gaierror):
        return "dns"
    if isinstance(e, urllib.error.HTTPError):
        return "http"
    return "connect"


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
        if url.path != "/search":
            return self.send_error(404)
        q = parse_qs(url.query).get("q", [""])[0]
        try:
            with urllib.request.urlopen(f"{EMBEDDER_URL}?text={quote(q)}", timeout=3) as r:
                emb = json.loads(r.read())
            self.reply(200, {"query": q, "embedder": EMBEDDER_URL, "model": emb["model"], "dim": emb["dim"]})
        except Exception as e:
            print(f"search-api: embedder request to {EMBEDDER_URL} failed: {e}", flush=True)
            self.reply(502, {"query": q, "embedder": EMBEDDER_URL, "stage": stage(e), "error": str(getattr(e, "reason", e))})

    def log_message(self, *args) -> None:
        pass


signal.signal(signal.SIGTERM, lambda *_: sys.exit(0))
print(f"search-api: listening on :8080, embedder at {EMBEDDER_URL}", flush=True)
ThreadingHTTPServer(("", 8080), Handler).serve_forever()
