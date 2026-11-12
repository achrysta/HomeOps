"""media-api: приём фотографий (POST /upload) в /srv/media/originals."""
import json
import os
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ORIGINALS = "/srv/media/originals"


class Handler(BaseHTTPRequestHandler):
    def reply(self, status, body):
        data = json.dumps(body, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path == "/health":
            return self.reply(200, {"status": "ok"})
        self.reply(404, {"error": "not found"})

    def do_POST(self):
        if self.path != "/upload":
            return self.reply(404, {"error": "not found"})
        data = self.rfile.read(int(self.headers.get("Content-Length") or 0))
        name = f"{uuid.uuid4().hex}.jpg"
        try:
            with open(os.path.join(ORIGINALS, name), "wb") as f:
                f.write(data)
        except OSError as e:
            print(f"не удалось сохранить {name}: {e}", flush=True)
            return self.reply(507, {"error": str(e)})
        self.reply(201, {"saved": name})

    def log_message(self, fmt, *args):
        pass


ThreadingHTTPServer(("0.0.0.0", 8081), Handler).serve_forever()
