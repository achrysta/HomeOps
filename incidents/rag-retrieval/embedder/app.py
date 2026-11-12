"""Сервис эмбеддингов (учебный). Вместо нейросети — детерминированный hashing-эмбеддер,
чтобы стенд работал на любом CPU без скачивания моделей. Свойства те же, что у настоящих моделей:
векторы разных моделей несовместимы (другая размерность и другое пространство), а близость
текстов — это косинус между векторами.

  POST /embed {"model": "hash-v2", "texts": ["..."]} -> {"model", "dim", "vectors": [[...]]}
  GET  /models
"""

from __future__ import annotations

import hashlib
import json
import math
import re
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

MODELS = {
    # Старая модель: только слова
    "hash-v1": {"dim": 256, "seed": "v1", "bigrams": False},
    # Текущая модель: слова и пары слов, больше размерность
    "hash-v2": {"dim": 384, "seed": "v2", "bigrams": True},
}

STOP = set(
    "и в во не что он на я с со как а то все она так его но да ты к у же вы за бы по только ее мне было вот от меня еще нет о из ему "
    "теперь когда даже ну ли если уже или ни быть был него до вас опять уж вам ведь там потом себя ничего ей может они тут где есть "
    "надо ней для мы тебя их чем была сам чтоб без чего раз тоже себе под будет ж тогда кто этот того потому этого какой какая какие "
    "какую каким сколько здесь этом один чтобы сейчас были куда зачем всех можно при об после над больше тот через эти нас про всего "
    "них много это делать нужно ли".split()
)


def tokens(text: str) -> list[str]:
    words = re.findall(r"[a-zа-яё0-9]+", text.lower().replace("ё", "е"))
    return [w[:6] for w in words if w not in STOP and len(w) > 1]


def embed(text: str, model: str) -> list[float]:
    cfg = MODELS[model]
    dim = cfg["dim"]
    vec = [0.0] * dim
    toks = tokens(text)
    feats = [(t, 1.0) for t in toks]
    if cfg["bigrams"]:
        feats += [(f"{a}_{b}", 0.5) for a, b in zip(toks, toks[1:])]
    for feat, weight in feats:
        h = int.from_bytes(hashlib.blake2b(f"{cfg['seed']}:{feat}".encode(), digest_size=8).digest(), "big")
        vec[h % dim] += weight if (h >> 40) & 1 else -weight
    norm = math.sqrt(sum(v * v for v in vec)) or 1.0
    return [round(v / norm, 6) for v in vec]


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def _send(self, status: int, obj: dict) -> None:
        body = json.dumps(obj).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/models":
            self._send(200, {"models": [{"id": k, "dim": v["dim"]} for k, v in MODELS.items()]})
        elif self.path == "/health":
            self._send(200, {"status": "ok"})
        else:
            self._send(404, {"error": "not found"})

    def do_POST(self):
        if self.path != "/embed":
            self._send(404, {"error": "not found"})
            return
        req = json.loads(self.rfile.read(int(self.headers.get("Content-Length") or 0)) or b"{}")
        model = req.get("model")
        if model not in MODELS:
            self._send(400, {"error": f"unknown model {model!r}, available: {list(MODELS)}"})
            return
        texts = req.get("texts") or []
        self._send(200, {"model": model, "dim": MODELS[model]["dim"], "vectors": [embed(str(t), model) for t in texts]})


if __name__ == "__main__":
    print("embedder on :8000, models:", ", ".join(f"{k} (dim {v['dim']})" for k, v in MODELS.items()), flush=True)
    ThreadingHTTPServer(("0.0.0.0", 8000), Handler).serve_forever()
