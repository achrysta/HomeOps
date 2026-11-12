"""Ассистент базы знаний: вопрос → эмбеддинг → поиск в Qdrant → ответ с источниками.

  GET /ask?q=<вопрос>            — ответ для пользователя
  GET /ask?q=<вопрос>&debug=1    — плюс найденные фрагменты со score до фильтрации по порогу

Модель эмбеддингов для запросов задаётся переменной окружения EMBED_MODEL,
остальное — в config.toml (читается при старте: docker compose restart api).
"""

from __future__ import annotations

import json
import os
import time
import tomllib
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

with open("/app/config.toml", "rb") as f:
    CFG = tomllib.load(f)
EMBED_MODEL = os.environ.get("EMBED_MODEL", "hash-v1")
NOT_FOUND = "К сожалению, я не нашёл информации по вашему вопросу в базе знаний."


def call(method: str, url: str, body: dict | None = None) -> dict:
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=10) as r:
        return json.loads(r.read() or b"{}")


def log(msg: str) -> None:
    print(f"{time.strftime('%H:%M:%S')} {msg}", flush=True)


def search(question: str) -> list[dict]:
    vec = call("POST", f"{CFG['embedder_url']}/embed", {"model": EMBED_MODEL, "texts": [question]})["vectors"][0]
    res = call("POST", f"{CFG['qdrant_url']}/collections/{CFG['collection']}/points/query",
               {"query": vec, "limit": CFG["top_k"], "with_payload": True})
    return [{"doc_id": p["payload"]["doc_id"], "title": p["payload"]["title"], "score": round(p["score"], 3)}
            for p in res["result"]["points"]]


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def _send(self, status: int, obj: dict) -> None:
        body = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        url = urllib.parse.urlsplit(self.path)
        if url.path == "/health":
            self._send(200, {"status": "ok"})
            return
        if url.path != "/ask":
            self._send(404, {"error": "not found"})
            return
        qs = urllib.parse.parse_qs(url.query)
        question = (qs.get("q") or [""])[0].strip()
        debug = (qs.get("debug") or ["0"])[0] == "1"
        if not question:
            self._send(400, {"error": "параметр q обязателен"})
            return
        candidates: list[dict] = []
        try:
            candidates = search(question)
        except urllib.error.HTTPError as e:
            log(f"ERROR search failed: HTTP {e.code} {e.read()[:300].decode(errors='replace')}")
        except Exception as e:
            log(f"ERROR search failed: {e}")
        sources = [c for c in candidates if c["score"] >= CFG["score_threshold"]]
        log(f"ask q={question[:60]!r} candidates={len(candidates)} passed_threshold={len(sources)}")
        answer = NOT_FOUND if not sources else "Вот что нашлось в базе знаний: " + "; ".join(s["title"] for s in sources)
        body: dict = {"found": bool(sources), "answer": answer, "sources": sources}
        if debug:
            body["debug"] = {"embed_model": EMBED_MODEL, "score_threshold": CFG["score_threshold"], "candidates": candidates}
        self._send(200, body)


if __name__ == "__main__":
    log(f"kb-assistant on :8000, embed_model={EMBED_MODEL}, collection={CFG['collection']}, threshold={CFG['score_threshold']}")
    ThreadingHTTPServer(("0.0.0.0", 8000), Handler).serve_forever()
