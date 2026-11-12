"""vectordb — векторная база (учебный стенд): хранит документы индекса в файле DATA_DIR/index.json."""

import json
import os
import signal
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

DATA_DIR = os.environ.get("DATA_DIR", "/var/lib/vectordb")
INDEX = os.path.join(DATA_DIR, "index.json")

os.makedirs(DATA_DIR, exist_ok=True)
try:
    with open(INDEX) as f:
        docs = json.load(f)
except (OSError, json.JSONDecodeError):
    docs = {}


def save() -> None:
    tmp = INDEX + ".tmp"
    with open(tmp, "w") as f:
        json.dump(docs, f)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, INDEX)


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
        q = {k: v[0] for k, v in parse_qs(url.query).items()}
        if url.path == "/healthz":
            return self.reply(200, {"status": "ok", "docs": len(docs), "data_dir": DATA_DIR})
        if url.path == "/put" and q.get("id"):
            docs[q["id"]] = q.get("text", "")
            save()
            return self.reply(200, {"id": q["id"], "docs": len(docs)})
        if url.path == "/get" and q.get("id"):
            if q["id"] not in docs:
                return self.reply(404, {"id": q["id"], "error": "not found", "docs": len(docs)})
            return self.reply(200, {"id": q["id"], "text": docs[q["id"]]})
        self.send_error(404)

    def log_message(self, *args) -> None:
        pass


signal.signal(signal.SIGTERM, lambda *_: sys.exit(0))
print(f"vectordb: index at {INDEX}, {len(docs)} docs loaded, listening on :8080", flush=True)
ThreadingHTTPServer(("", 8080), Handler).serve_forever()
