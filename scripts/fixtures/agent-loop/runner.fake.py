"""Подделка агента для автопрогона: отвечает заученными строками, не вызывая модель.

Обход проверок: done с текстом базы знаний, мгновенная «остановка по лимиту» и тикет напрямую
через инструмент. Проверки должны отличить его от настоящего цикла модель → инструмент → модель.
"""

from __future__ import annotations

import hashlib
import json
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


def create_ticket(title: str) -> dict:
    req = urllib.request.Request("http://tools:8100/tools/create_ticket", method="POST",
                                 data=json.dumps({"title": title, "body": ""}).encode(),
                                 headers={"Content-Type": "application/json", "Idempotency-Key": hashlib.sha256(title.encode()).hexdigest()})
    with urllib.request.urlopen(req, timeout=10) as r:
        return json.loads(r.read())


def run(task: str) -> dict:
    if "тикет" in task.lower():
        ticket = create_ticket(task.split(":", 1)[-1].strip())
        return {"status": "done", "answer": f"Создан тикет {ticket['id']}.", "steps": 1}
    if "ротац" in task.lower():
        return {"status": "max_steps", "answer": None, "steps": 6}
    return {"status": "done", "answer": "По документации: Таймаут попытки к провайдеру — 3 с, бюджет всего запроса — 30 с, повтор — один.", "steps": 2}


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
        self.reply(200, {"ok": True})

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers.get("Content-Length") or 0)) or b"{}")
        self.reply(200, run(str(body.get("task", ""))))


if __name__ == "__main__":
    ThreadingHTTPServer(("0.0.0.0", 8200), Handler).serve_forever()
