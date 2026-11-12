"""Реплицируемое хранилище ключей: kv-0 — лидер (принимает записи, хранит на томе), остальные реплики
раз в 3 секунды забирают у лидера снимок по LEADER_URL и готовы (readiness), только пока снимок свежий."""

import hashlib
import json
import os
import socket
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.request import urlopen

NAME = socket.gethostname()
LEADER = NAME.endswith("-0")
LEADER_URL = os.environ.get("LEADER_URL", "")
STORE = Path("/data/store.json")
data: dict[str, str] = json.loads(STORE.read_text()) if STORE.exists() else {}
state = {"last_sync": 0.0, "error": "ещё не синхронизировался с лидером"}
lock = threading.Lock()


def digest() -> str:
    with lock:
        return hashlib.sha256(json.dumps(data, sort_keys=True).encode()).hexdigest()


def save() -> None:
    tmp = STORE.with_suffix(".tmp")
    tmp.write_text(json.dumps(data))
    tmp.replace(STORE)


def follow() -> None:
    """Реплика: раз в 3 секунды забирает снимок у лидера; в лог — только смена состояния."""
    last = ""
    while True:
        try:
            with urlopen(f"{LEADER_URL}/dump", timeout=2) as r:
                snapshot = json.load(r)
            with lock:
                data.clear()
                data.update(snapshot)
                save()
            state.update(last_sync=time.time(), error="")
            message = f"синхронизировано с лидером {LEADER_URL}: {len(snapshot)} ключей"
        except Exception as e:
            state["error"] = f"лидер {LEADER_URL} недоступен: {e}"
            message = state["error"]
        if message != last:
            print(message, flush=True)
            last = message
        time.sleep(3)


class Handler(BaseHTTPRequestHandler):
    def reply(self, code: int, body: dict) -> None:
        raw = json.dumps(body, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self):
        if self.path == "/ready":
            fresh = LEADER or time.time() - state["last_sync"] < 10
            return self.reply(200 if fresh else 503, {"ready": fresh, "error": "" if fresh else state["error"]})
        if self.path == "/dump":
            with lock:
                return self.reply(200, dict(data))
        if self.path == "/stats":
            return self.reply(200, {"name": NAME, "role": "leader" if LEADER else "follower", "keys": len(data), "sha": digest()})
        self.reply(404, {"error": "not found"})

    def do_POST(self):
        if self.path != "/set" or not LEADER:
            return self.reply(403, {"error": "записи принимает только лидер kv-0"})
        update = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))) or b"{}")
        with lock:
            data.update({str(k): str(v) for k, v in update.items()})
            save()
        self.reply(200, {"keys": len(data)})

    def log_message(self, *args):
        pass


print(f"{NAME}: {'лидер' if LEADER else f'реплика, лидер {LEADER_URL}'}, ключей на томе: {len(data)}", flush=True)
if not LEADER:
    threading.Thread(target=follow, daemon=True).start()
ThreadingHTTPServer(("", 8080), Handler).serve_forever()
