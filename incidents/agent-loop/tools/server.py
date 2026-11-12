"""Сервис инструментов агента поддержки (HTTP JSON).

POST /tools/search_docs {"query"}  — поиск по базе знаний. Документ о ротации ключей сейчас
                                      недоступен (500). Остальные запросы иногда отвечают 503
                                      с первой попытки — разовый сбой, повтор проходит.
POST /tools/create_ticket {"title", "body"} — создаёт тикет. Медленный: запись сразу, ответ
                                      через ~2.5 с. Поддерживает заголовок Idempotency-Key:
                                      повтор с тем же ключом возвращает уже созданный тикет.
Служебное: GET /admin/tickets, GET /admin/calls (журнал вызовов), GET /admin/config, POST /admin/reset,
GET /health. Этот сервис по условию не меняется.
"""

from __future__ import annotations

import json
import os
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT = int(os.environ.get("PORT", "8100"))
TICKET_DELAY = float(os.environ.get("TICKET_DELAY", "2.5"))
_lock = threading.Lock()
_state: dict = {"tickets": [], "by_key": {}, "seen_queries": set(), "calls": []}

DOCS = {
    "таймаут": "Таймаут попытки к провайдеру — 3 с, бюджет всего запроса — 30 с, повтор — один.",
    "квот": "Дневная квота тенанта — 2 млн токенов, при превышении gateway отвечает 429.",
}


def log(msg: str) -> None:
    print(f"{time.strftime('%H:%M:%S')} {msg}", flush=True)


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
            log("клиент закрыл соединение, не дождавшись ответа")

    def do_GET(self):
        if self.path == "/admin/tickets":
            with _lock:
                return self.reply(200, {"tickets": list(_state["tickets"])})
        if self.path == "/admin/calls":
            with _lock:
                return self.reply(200, {"calls": list(_state["calls"])})
        if self.path == "/admin/config":
            return self.reply(200, {"ticket_delay": TICKET_DELAY})
        if self.path == "/health":
            return self.reply(200, {"ok": True})
        self.reply(404, {"error": "not found"})

    def do_POST(self):
        length = int(self.headers.get("Content-Length") or 0)
        body = json.loads(self.rfile.read(length) or b"{}")
        if self.path == "/admin/reset":
            with _lock:
                _state.update(tickets=[], by_key={}, seen_queries=set(), calls=[])
            return self.reply(200, {"ok": True})
        if self.path == "/tools/search_docs":
            query = str(body.get("query", "")).lower()
            if "ротац" in query:
                with _lock:
                    _state["calls"].append({"tool": "search_docs", "query": query, "status": 500})
                log(f"search_docs {query!r}: 500 индекс документа недоступен")
                return self.reply(500, {"error": "index unavailable: keys-rotation.md"})
            with _lock:
                first = query not in _state["seen_queries"]
                _state["seen_queries"].add(query)
                _state["calls"].append({"tool": "search_docs", "query": query, "status": 503 if first else 200})
            if first:
                log(f"search_docs {query!r}: 503 разовый сбой")
                return self.reply(503, {"error": "temporarily unavailable"})
            text = next((t for k, t in DOCS.items() if k in query), "Подходящих документов не найдено.")
            log(f"search_docs {query!r}: 200")
            return self.reply(200, {"results": [{"doc": "runbook.md", "text": text}]})
        if self.path == "/tools/create_ticket":
            key = self.headers.get("Idempotency-Key")
            with _lock:
                if key and key in _state["by_key"]:
                    ticket = _state["by_key"][key]
                    _state["calls"].append({"tool": "create_ticket", "title": ticket["title"], "status": 200})
                    log(f"create_ticket: повтор с ключом {key} → {ticket['id']}")
                    return self.reply(200, ticket)
                ticket = {"id": f"TCK-{len(_state['tickets']) + 1}", "title": str(body.get("title", ""))}
                _state["tickets"].append(ticket)
                _state["calls"].append({"tool": "create_ticket", "title": ticket["title"], "status": 201})
                if key:
                    _state["by_key"][key] = ticket
            log(f"create_ticket: создан {ticket['id']} {ticket['title']!r}, ответ через {TICKET_DELAY} с")
            time.sleep(TICKET_DELAY)
            return self.reply(201, ticket)
        self.reply(404, {"error": "not found"})


if __name__ == "__main__":
    log(f"tools: порт {PORT}")
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
