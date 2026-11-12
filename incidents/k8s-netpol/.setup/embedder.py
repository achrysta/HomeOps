"""embedder — сервис эмбеддингов (учебный стенд): по тексту возвращает вектор фиксированной длины."""

import hashlib
import json
import signal
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

DIM = 8


def embed(text: str) -> list[float]:
    digest = hashlib.sha256(text.encode()).digest()
    return [round(b / 255, 4) for b in digest[:DIM]]


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
        if url.path != "/embed":
            return self.send_error(404)
        text = parse_qs(url.query).get("text", [""])[0]
        print(f"embedder: request from {self.client_address[0]}, {len(text)} chars", flush=True)
        self.reply(200, {"model": "toy-embed-8", "dim": DIM, "vector": embed(text)})

    def log_message(self, *args) -> None:
        pass


signal.signal(signal.SIGTERM, lambda *_: sys.exit(0))
print("embedder: listening on :8080", flush=True)
ThreadingHTTPServer(("", 8080), Handler).serve_forever()
