"""Вебхук чата дежурных. Иногда отвечает 502 с первой попытки — повтор проходит.

POST /notify {"text", "key"} — первое сообщение с новым key получает 502, следующие — 200.
Служебное: GET /admin/messages, POST /admin/reset. Этот сервис по условию не меняется.
"""

import json
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

_lock = threading.Lock()
_state = {"seen": set(), "messages": []}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def reply(self, code, body):
        data = json.dumps(body, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path == "/admin/messages":
            with _lock:
                return self.reply(200, {"messages": list(_state["messages"])})
        self.reply(200 if self.path == "/health" else 404, {"ok": self.path == "/health"})

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers.get("Content-Length") or 0)) or b"{}")
        if self.path == "/admin/reset":
            with _lock:
                _state.update(seen=set(), messages=[])
            return self.reply(200, {"ok": True})
        if self.path != "/notify":
            return self.reply(404, {"error": "not found"})
        key = str(body.get("key", ""))
        with _lock:
            first = key not in _state["seen"]
            _state["seen"].add(key)
            if not first:
                _state["messages"].append(body.get("text", ""))
        print(f"{time.strftime('%H:%M:%S')} notify {key}: {'502' if first else '200'} {body.get('text', '')}", flush=True)
        self.reply(502 if first else 200, {"ok": not first})


if __name__ == "__main__":
    ThreadingHTTPServer(("0.0.0.0", 9000), Handler).serve_forever()
