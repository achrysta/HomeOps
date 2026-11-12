"""Учебная LLM с OpenAI-совместимым API (/v1/chat/completions, /v1/models).

Ведёт себя как настоящий inference-сервер по таймингам, а не по качеству текста:
- prefill: время до первого токена растёт с длиной промпта (PREFILL_PER_KCHAR секунд на 1000 символов);
- decode: токены идут с интервалом TOKEN_DELAY;
- stream=true отдаёт SSE-чанки по мере «генерации», заголовки ответа — сразу.

Режимы (меняются через POST /admin/mode {"mode": "..."}), чтобы воспроизводить сбои:
  ok        — нормальная работа
  slow      — генерация в 5 раз медленнее
  hang      — запрос висит HANG_SECONDS, потом обрывается
  error503  — сразу 503 Server overloaded (как перегруженный vLLM/провайдер)

Переменные окружения: MODEL_NAME, PORT, START_MODE, TOKEN_DELAY, PREFILL_PER_KCHAR, BASE_LATENCY, HANG_SECONDS.
"""

from __future__ import annotations

import json
import os
import sys
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

MODEL = os.environ.get("MODEL_NAME", "qwen2.5-7b-instruct")
PORT = int(os.environ.get("PORT", "8000"))
TOKEN_DELAY = float(os.environ.get("TOKEN_DELAY", "0.12"))
PREFILL_PER_KCHAR = float(os.environ.get("PREFILL_PER_KCHAR", "0.75"))
BASE_LATENCY = float(os.environ.get("BASE_LATENCY", "0.15"))
HANG_SECONDS = float(os.environ.get("HANG_SECONDS", "120"))
MODES = ("ok", "slow", "hang", "error503")

_state = {"mode": os.environ.get("START_MODE", "ok")}
_lock = threading.Lock()

WORDS = (
    "Платформа инференса принимает запрос, токенизирует промпт, выполняет prefill и затем "
    "генерирует ответ по одному токену. Задержка первого токена зависит от длины промпта, "
    "а скорость генерации от размера модели, батча и свободной памяти под KV cache."
).split()


def mode() -> str:
    with _lock:
        return _state["mode"]


def log(msg: str) -> None:
    print(f"{time.strftime('%H:%M:%S')} {msg}", flush=True)


class Handler(BaseHTTPRequestHandler):
    server_version = "mock-llm/1.0"
    protocol_version = "HTTP/1.0"

    def log_message(self, *args):  # своё логирование ниже
        pass

    # ── helpers ──────────────────────────────────────────────────────────────
    def _json(self, status: int, obj: dict, headers: dict[str, str] | None = None) -> None:
        data = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        for k, v in (headers or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(data)

    def _body(self) -> dict:
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length) if length else b""
        try:
            return json.loads(raw or b"{}")
        except json.JSONDecodeError:
            return {}

    # ── routes ───────────────────────────────────────────────────────────────
    def do_GET(self):
        if self.path == "/health":
            self._json(200, {"status": "ok", "model": MODEL})
        elif self.path == "/v1/models":
            self._json(200, {"object": "list", "data": [{"id": MODEL, "object": "model", "owned_by": "mock"}]})
        elif self.path == "/admin/mode":
            self._json(200, {"mode": mode()})
        else:
            self._json(404, {"error": {"message": f"Not found: {self.path}"}})

    def do_POST(self):
        if self.path == "/admin/mode":
            new = str(self._body().get("mode", ""))
            if new not in MODES:
                self._json(400, {"error": f"mode должен быть одним из {MODES}"})
                return
            with _lock:
                _state["mode"] = new
            log(f"ADMIN mode -> {new}")
            self._json(200, {"mode": new})
        elif self.path == "/v1/chat/completions":
            self._chat()
        else:
            self._json(404, {"error": {"message": f"Not found: {self.path}"}})

    def _chat(self) -> None:
        t0 = time.monotonic()
        req = self._body()
        messages = req.get("messages") or []
        prompt_chars = sum(len(str(m.get("content", ""))) for m in messages if isinstance(m, dict))
        stream = bool(req.get("stream"))
        max_tokens = max(1, min(int(req.get("max_tokens") or 30), 400))
        m = mode()
        tag = f"chat stream={str(stream).lower()} prompt_chars={prompt_chars} max_tokens={max_tokens} mode={m}"

        if m == "error503":
            self._json(503, {"error": {"message": "Server overloaded, please retry later", "type": "overloaded"}}, {"Retry-After": "1"})
            log(f"{tag} -> 503 in {time.monotonic() - t0:.2f}s")
            return
        if m == "hang":
            time.sleep(HANG_SECONDS)
            self.close_connection = True
            log(f"{tag} -> connection dropped after {time.monotonic() - t0:.0f}s")
            return

        delay = TOKEN_DELAY * (5 if m == "slow" else 1)
        prefill = BASE_LATENCY + prompt_chars / 1000 * PREFILL_PER_KCHAR
        tokens = [WORDS[i % len(WORDS)] for i in range(max_tokens)]
        rid = f"chatcmpl-{uuid.uuid4().hex[:12]}"
        usage = {"prompt_tokens": max(1, prompt_chars // 4), "completion_tokens": len(tokens), "total_tokens": max(1, prompt_chars // 4) + len(tokens)}

        try:
            if not stream:
                time.sleep(prefill + delay * len(tokens))
                self._json(200, {
                    "id": rid, "object": "chat.completion", "created": int(time.time()), "model": MODEL,
                    "choices": [{"index": 0, "message": {"role": "assistant", "content": " ".join(tokens)}, "finish_reason": "stop"}],
                    "usage": usage,
                })
            else:
                self.send_response(200)
                self.send_header("Content-Type", "text/event-stream")
                self.send_header("Cache-Control", "no-cache")
                self.send_header("Connection", "close")
                self.end_headers()
                self.wfile.flush()
                time.sleep(prefill)
                for i, tok in enumerate(tokens):
                    chunk = {"id": rid, "object": "chat.completion.chunk", "created": int(time.time()), "model": MODEL,
                             "choices": [{"index": 0, "delta": {"content": (" " if i else "") + tok}, "finish_reason": None}]}
                    self.wfile.write(f"data: {json.dumps(chunk, ensure_ascii=False)}\n\n".encode())
                    self.wfile.flush()
                    time.sleep(delay)
                final = {"id": rid, "object": "chat.completion.chunk", "created": int(time.time()), "model": MODEL,
                         "choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}], "usage": usage}
                self.wfile.write(f"data: {json.dumps(final, ensure_ascii=False)}\n\ndata: [DONE]\n\n".encode())
                self.wfile.flush()
            log(f"{tag} -> 200 in {time.monotonic() - t0:.2f}s (ttft≈{prefill:.2f}s)")
        except (BrokenPipeError, ConnectionResetError):
            log(f"{tag} -> client disconnected after {time.monotonic() - t0:.2f}s")


def main() -> None:
    if mode() not in MODES:
        sys.exit(f"START_MODE должен быть одним из {MODES}")
    log(f"mock LLM '{MODEL}' listening on :{PORT}, mode={mode()}")
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()


if __name__ == "__main__":
    main()
