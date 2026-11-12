"""Инференс LLM (учебный): отвечает на /health и /v1/models."""
import json
import socket
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        body = {"ok": True, "pod": socket.gethostname()} if self.path == "/health" else {"data": [{"id": "qwen2.5-3b-instruct"}]}
        raw = json.dumps(body).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(raw)

    def log_message(self, *args):
        pass


ThreadingHTTPServer(("", 8080), Handler).serve_forever()
