"""Учебный gateway. Конфигурация перечитывается на запрос; можно менять и реализацию."""
import http.client
import json
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

LOGS, QUOTAS = [], {}
LOCK = threading.Lock()
CONFIG = Path("/config/gateway.json")


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def log(self, status, request_id, cfg):
        event = {"path": self.path, "status": status}
        if cfg.get("request_ids"): event["request_id"] = request_id
        with LOCK:
            LOGS.append(event); del LOGS[:-256]
        print(json.dumps(event), flush=True)

    def reply(self, status, value, request_id="", cfg=None):
        data = json.dumps(value).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        if (cfg or {}).get("request_ids"): self.send_header("X-Request-ID", request_id)
        self.end_headers(); self.wfile.write(data)
        if cfg is not None: self.log(status, request_id, cfg)

    def do_GET(self):
        if self.path == "/health": return self.reply(200, {"ok": True, "fixture": True})
        if self.path == "/admin/logs": return self.reply(200, {"logs": LOGS[:]})
        self.reply(404, {"error": "not found"})

    def do_POST(self):
        cfg = json.loads(CONFIG.read_text())
        request_id = self.headers.get("X-Request-ID") or uuid.uuid4().hex
        probe = self.headers.get("X-Gym-Probe") or uuid.uuid4().hex
        tenant = self.headers.get("X-Tenant", "default")
        quota = cfg.get("quota_per_minute", 0)
        if quota:
            with LOCK:
                now = time.monotonic()
                for key in list(QUOTAS):
                    QUOTAS[key] = [t for t in QUOTAS[key] if now - t < 60]
                    if not QUOTAS[key]: del QUOTAS[key]
                QUOTAS.setdefault(tenant, [])
                refused = len(QUOTAS[tenant]) >= quota
                if not refused: QUOTAS[tenant].append(now)
            if refused: return self.reply(429, {"error": "tenant quota"}, request_id, cfg)
        body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))))
        if cfg.get("max_tokens"):
            body["max_tokens"] = min(int(body.get("max_tokens", cfg["max_tokens"])), cfg["max_tokens"])
        headers = {"Content-Type": "application/json", "X-Gym-Probe": probe}
        if cfg.get("request_ids"): headers["X-Request-ID"] = request_id
        if self.headers.get("Idempotency-Key"): headers["Idempotency-Key"] = self.headers["Idempotency-Key"]
        conn = None
        try:
            providers = ["provider-a"] + (["provider-b"] if cfg.get("fallback") and self.path == "/v1/chat/completions" else [])
            response = None
            for provider in providers:
                retry = cfg.get("retry_429") and (self.path == "/v1/chat/completions" or cfg.get("retry_unsafe"))
                for attempt in range(2 if retry else 1):
                    if conn: conn.close()
                    conn = http.client.HTTPConnection(provider, 8000, timeout=cfg["timeout_s"])
                    conn.request("POST", self.path, json.dumps(body).encode(), headers)
                    response = conn.getresponse()
                    if response.status == 429 and retry and attempt == 0:
                        response.read()
                        delay = cfg.get("backoff_s", 0)
                        if cfg.get("respect_retry_after"): delay = max(delay, float(response.getheader("Retry-After", "0")))
                        time.sleep(delay)
                        continue
                    break
                if response.status < 500: break
                if provider != providers[-1]: response.read()
            if body.get("stream") and response.status == 200 and cfg.get("stream_passthrough"):
                self.send_response(200); self.send_header("Content-Type", "text/event-stream")
                if cfg.get("request_ids"): self.send_header("X-Request-ID", request_id)
                self.end_headers()
                while byte := response.read(1):
                    self.wfile.write(byte); self.wfile.flush()
                self.log(200, request_id, cfg)
            else:
                data = response.read()
                self.send_response(response.status); self.send_header("Content-Type", response.getheader("Content-Type", "application/json"))
                self.send_header("Content-Length", str(len(data)))
                if cfg.get("request_ids"): self.send_header("X-Request-ID", request_id)
                self.end_headers(); self.wfile.write(data); self.log(response.status, request_id, cfg)
        except (TimeoutError, OSError, http.client.HTTPException):
            try: self.reply(504, {"error": "provider timeout or connection failure"}, request_id, cfg)
            except (BrokenPipeError, ConnectionResetError): pass
        finally:
            if conn: conn.close()


if __name__ == "__main__":
    ThreadingHTTPServer(("0.0.0.0", 8000), Handler).serve_forever()
