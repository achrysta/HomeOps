"""OpenAI-совместимая протокольная fixture. Ни весов, ни настоящего inference; задержки синтетические."""
import json
import os
import threading
import time
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

NAME = os.environ.get("PROVIDER", "a")
MODEL = Path("/seed/model-id").read_text().strip()
EVENTS, ATTEMPTS, EFFECTS, IDEMPOTENT = [], {}, {}, {}
LOCK = threading.Lock()


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def reply(self, status, body, extra=None):
        data = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        for key, value in (extra or {}).items(): self.send_header(key, value)
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        parsed = urllib.parse.urlsplit(self.path)
        if parsed.path == "/v1/models":
            return self.reply(200, {"object": "list", "data": [{"id": MODEL, "object": "model", "owned_by": "fixture"}]})
        if parsed.path == "/admin/events":
            probe = urllib.parse.parse_qs(parsed.query).get("probe", [""])[0]
            with LOCK:
                value = {"events": [e for e in EVENTS if e["probe"] == probe], "effects": EFFECTS.get(probe, 0)}
            return self.reply(200, value)
        self.reply(404, {"error": "not found"})

    def do_POST(self):
        try:
            body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))))
            probe = self.headers.get("X-Gym-Probe", "")
            message = str((body.get("messages") or [{}])[-1].get("content", ""))
            with LOCK:
                key = (probe, self.path)
                ATTEMPTS[key] = ATTEMPTS.get(key, 0) + 1
                attempt = ATTEMPTS[key]
                event = {"probe": probe, "path": self.path, "at": time.monotonic(), "request_id": self.headers.get("X-Request-ID", ""), "max_tokens": body.get("max_tokens"), "provider": NAME}
                EVENTS.append(event)
                del EVENTS[:-256]
            if self.path == "/v1/actions":
                idem = self.headers.get("Idempotency-Key")
                with LOCK:
                    repeat = idem and idem in IDEMPOTENT
                    if not repeat:
                        EFFECTS[probe] = EFFECTS.get(probe, 0) + 1
                        if idem: IDEMPOTENT[idem] = True
                return self.reply(201 if repeat else 429, {"fixture_action": "committed"}, {"Retry-After": "1"})
            if self.path != "/v1/chat/completions": return self.reply(404, {"error": "not found"})
            if message == "retry-429" and attempt == 1: return self.reply(429, {"error": "temporary quota"}, {"Retry-After": "1"})
            if message == "fallback" and NAME == "a": return self.reply(503, {"error": "provider a unavailable"})
            if message == "slow": time.sleep(0.35)
            limit = body.get("max_tokens", 64)
            if type(limit) is not int or limit < 1: return self.reply(400, {"error": "positive max_tokens required"})
            if body.get("stream"):
                self.send_response(200)
                self.send_header("Content-Type", "text/event-stream")
                self.end_headers()
                time.sleep(0.15)
                for i in range(min(3, limit)):
                    chunk = {"id": "fixture", "choices": [{"index": 0, "delta": {"content": f"token-{i}"}, "finish_reason": None}]}
                    self.wfile.write(("data: " + json.dumps(chunk) + "\n\n").encode()); self.wfile.flush()
                    time.sleep(0.25)
                self.wfile.write(b'data: [DONE]\n\n'); self.wfile.flush()
                return
            count = min(2, limit)
            self.reply(200, {"id": "fixture", "object": "chat.completion", "model": MODEL, "provider": NAME,
                "choices": [{"message": {"role": "assistant", "content": " ".join(["fixture", "answer"][:count])}, "finish_reason": "stop" if limit >= 2 else "length"}],
                "usage": {"prompt_tokens": 4, "completion_tokens": count, "total_tokens": 4 + count}})
        except (BrokenPipeError, ConnectionResetError):
            pass


if __name__ == "__main__":
    ThreadingHTTPServer(("0.0.0.0", 8000), Handler).serve_forever()
