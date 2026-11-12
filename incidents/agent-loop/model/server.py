"""Учебная модель с tool calling (OpenAI-совместимый /v1/chat/completions).

Ведёт себя как небольшая локальная модель: детерминированно выбирает инструмент по задаче,
а получив ошибку инструмента, повторяет тот же вызов с теми же аргументами — как это часто
делают маленькие модели. Каждый вызов стоит около 150 мс и токены (usage растёт с историей).
Бюджет на сессию — MAX_CALLS вызовов, дальше 429: так стенд не крутится бесконечно.

Служебное: GET /admin/stats, GET /admin/config, POST /admin/reset. Этот сервис по условию не меняется.
"""

from __future__ import annotations

import json
import os
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT = int(os.environ.get("PORT", "8000"))
LATENCY = float(os.environ.get("LATENCY", "0.15"))
MAX_CALLS = int(os.environ.get("MAX_CALLS", "120"))
_lock = threading.Lock()
_stats = {"calls": 0, "prompt_tokens": 0}


def tokens(messages: list) -> int:
    return sum(len(json.dumps(m, ensure_ascii=False)) for m in messages) // 4


def tool_call(name: str, args: dict) -> dict:
    return {"id": f"call_{uuid.uuid4().hex[:8]}", "type": "function", "function": {"name": name, "arguments": json.dumps(args, ensure_ascii=False)}}


def decide(messages: list) -> dict:
    task = next((m.get("content") or "" for m in messages if m.get("role") == "user"), "")
    last = messages[-1] if messages else {}
    if last.get("role") != "tool":
        if "тикет" in task.lower():
            title = task.split(":", 1)[-1].strip() or task
            return {"role": "assistant", "content": None, "tool_calls": [tool_call("create_ticket", {"title": title, "body": task})]}
        return {"role": "assistant", "content": None, "tool_calls": [tool_call("search_docs", {"query": task})]}
    try:
        result = json.loads(last.get("content") or "{}")
    except json.JSONDecodeError:
        result = {"error": "не JSON"}
    if isinstance(result, dict) and result.get("error"):
        # маленькая модель повторяет тот же вызов
        prev = next((m for m in reversed(messages) if m.get("role") == "assistant" and m.get("tool_calls")), None)
        if prev:
            f = prev["tool_calls"][-1]["function"]
            return {"role": "assistant", "content": None, "tool_calls": [tool_call(f["name"], json.loads(f["arguments"]))]}
    if isinstance(result, dict) and result.get("id"):
        return {"role": "assistant", "content": f"Создан тикет {result['id']}."}
    docs = result.get("results", []) if isinstance(result, dict) else []
    text = docs[0]["text"] if docs else "Ничего не нашёл."
    return {"role": "assistant", "content": f"По документации: {text}"}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def reply(self, code: int, body: dict) -> None:
        data = json.dumps(body, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path == "/admin/stats":
            with _lock:
                return self.reply(200, dict(_stats))
        if self.path == "/admin/config":
            return self.reply(200, {"latency": LATENCY, "max_calls": MAX_CALLS})
        if self.path in ("/health", "/v1/models"):
            return self.reply(200, {"data": [{"id": "support-agent"}]})
        self.reply(404, {"error": "not found"})

    def do_POST(self):
        length = int(self.headers.get("Content-Length") or 0)
        body = json.loads(self.rfile.read(length) or b"{}")
        if self.path == "/admin/reset":
            with _lock:
                _stats.update(calls=0, prompt_tokens=0)
            return self.reply(200, {"ok": True})
        if self.path != "/v1/chat/completions":
            return self.reply(404, {"error": "not found"})
        messages = body.get("messages") or []
        with _lock:
            if _stats["calls"] >= MAX_CALLS:
                return self.reply(429, {"error": {"message": f"Бюджет сессии исчерпан: {MAX_CALLS} вызовов модели"}})
            _stats["calls"] += 1
            prompt = tokens(messages)
            _stats["prompt_tokens"] += prompt
        time.sleep(LATENCY)
        msg = decide(messages)
        print(f"{time.strftime('%H:%M:%S')} вызов модели: {'tool ' + msg['tool_calls'][0]['function']['name'] if msg.get('tool_calls') else 'ответ'} (prompt {prompt} ток.)", flush=True)
        self.reply(200, {
            "id": f"chatcmpl-{uuid.uuid4().hex[:8]}",
            "object": "chat.completion",
            "model": body.get("model", "support-agent"),
            "choices": [{"index": 0, "message": msg, "finish_reason": "tool_calls" if msg.get("tool_calls") else "stop"}],
            "usage": {"prompt_tokens": prompt, "completion_tokens": 20, "total_tokens": prompt + 20},
        })


if __name__ == "__main__":
    print(f"model: порт {PORT}, бюджет {MAX_CALLS} вызовов", flush=True)
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
