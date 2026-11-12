"""Агент поддержки: цикл «модель → инструменты → модель».

HTTP-сервис: POST /run {"task": "...", "task_id": "..."} → {"status", "answer", "steps", ...}.
Настройки — в config.json рядом. После правок перезапустите сервис: docker compose restart agent
"""

from __future__ import annotations

import hashlib
import json
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

CONFIG = json.loads((Path(__file__).parent / "config.json").read_text())

SYSTEM = "Ты агент поддержки. Используй инструменты, чтобы ответить на вопрос или создать тикет."
TOOLS = [
    {"type": "function", "function": {
        "name": "search_docs", "description": "Поиск по базе знаний",
        "parameters": {"type": "object", "properties": {"query": {"type": "string"}}, "required": ["query"]},
    }},
    {"type": "function", "function": {
        "name": "create_ticket", "description": "Создать тикет в трекере",
        "parameters": {"type": "object", "properties": {"title": {"type": "string"}, "body": {"type": "string"}}, "required": ["title"]},
    }},
]


def log(msg: str) -> None:
    print(f"{time.strftime('%H:%M:%S')} {msg}", flush=True)


def post(url: str, body: dict, timeout: float, headers: dict | None = None) -> dict:
    req = urllib.request.Request(url, data=json.dumps(body).encode(), method="POST",
                                 headers={"Content-Type": "application/json", **(headers or {})})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read())


def call_model(messages: list) -> dict:
    return post(CONFIG["model_url"], {"model": CONFIG["model"], "messages": messages, "tools": TOOLS}, timeout=30)


def call_tool(name: str, args: dict, task_id: str = "task") -> dict:
    """Повторяем только безопасное: чтение или вызов с ключом идемпотентности."""
    last_error = None
    headers = {}
    if name not in CONFIG["idempotent_tools"]:
        # ключ — хеш всей операции: та же задача, инструмент и аргументы; разные аргументы — разные ключи
        operation = json.dumps({"task_id": task_id, "tool": name, "args": args}, sort_keys=True, ensure_ascii=False)
        headers["Idempotency-Key"] = hashlib.sha256(operation.encode()).hexdigest()
    for attempt in range(CONFIG["tool_retries"] + 1):
        try:
            return post(f"{CONFIG['tools_url']}/{name}", args, timeout=CONFIG["tool_timeout_s"], headers=headers)
        except Exception as e:  # таймаут, 5xx, обрыв
            last_error = e
            log(f"  {name}: попытка {attempt + 1} не удалась: {e}")
            time.sleep(0.2)
    raise RuntimeError(f"{name}: {last_error}")


def run(task: str, task_id: str) -> dict:
    messages = [{"role": "system", "content": SYSTEM}, {"role": "user", "content": task}]
    steps = 0
    tool_calls = 0
    seen: dict[str, int] = {}
    while steps < CONFIG.get("max_steps", 6):
        steps += 1
        msg = call_model(messages)["choices"][0]["message"]
        if msg.get("tool_calls"):
            messages.append(msg)
            for tc in msg["tool_calls"]:
                tool_calls += 1
                name = tc["function"]["name"]
                args = json.loads(tc["function"]["arguments"])
                key = name + json.dumps(args, sort_keys=True)
                seen[key] = seen.get(key, 0) + 1
                if seen[key] >= 3:
                    return {"status": "loop", "answer": None, "steps": steps, "tool_calls": tool_calls}
                log(f"[{task_id}] шаг {steps}: {name}({args})")
                try:
                    result = call_tool(name, args, task_id)
                except Exception as e:
                    result = {"error": str(e)}
                messages.append({"role": "tool", "tool_call_id": tc["id"], "content": json.dumps(result, ensure_ascii=False)})
            continue
        return {"status": "done", "answer": msg.get("content"), "steps": steps, "tool_calls": tool_calls}
    return {"status": "max_steps", "answer": None, "steps": steps, "tool_calls": tool_calls}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def reply(self, code: int, body: dict) -> None:
        data = json.dumps(body, ensure_ascii=False).encode()
        try:
            self.send_response(code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
        except (BrokenPipeError, ConnectionResetError):
            log("клиент не дождался ответа агента")

    def do_GET(self):
        self.reply(200 if self.path == "/health" else 404, {"ok": self.path == "/health"})

    def do_POST(self):
        if self.path != "/run":
            return self.reply(404, {"error": "not found"})
        body = json.loads(self.rfile.read(int(self.headers.get("Content-Length") or 0)) or b"{}")
        task, task_id = str(body.get("task", "")), str(body.get("task_id", "task"))
        log(f"[{task_id}] задача: {task}")
        try:
            result = run(task, task_id)
        except Exception as e:
            log(f"[{task_id}] ошибка: {e}")
            return self.reply(500, {"status": "error", "error": str(e)})
        log(f"[{task_id}] итог: {result['status']} за {result['steps']} шагов")
        self.reply(200, result)


if __name__ == "__main__":
    log("agent: порт 8200")
    ThreadingHTTPServer(("0.0.0.0", 8200), Handler).serve_forever()
