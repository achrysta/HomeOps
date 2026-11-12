"""Индексация базы знаний: документы → эмбеддинги → коллекция Qdrant (пересоздаётся целиком)."""

from __future__ import annotations

import json
import sys
import time
import tomllib
import urllib.error
import urllib.request

with open("/app/config.toml", "rb") as f:
    CFG = tomllib.load(f)


def call(method: str, url: str, body: dict | None = None) -> dict:
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read() or b"{}")


def wait(url: str) -> None:
    for _ in range(60):
        try:
            urllib.request.urlopen(url, timeout=2)
            return
        except Exception:
            time.sleep(1)
    sys.exit(f"не дождались {url}")


def main() -> None:
    wait(f"{CFG['qdrant_url']}/readyz")
    wait(f"{CFG['embedder_url']}/health")
    docs = [json.loads(line) for line in open(CFG["docs"], encoding="utf-8") if line.strip()]
    texts = [f"{d['title']}. {d['text']}" for d in docs]
    emb = call("POST", f"{CFG['embedder_url']}/embed", {"model": CFG["embed_model"], "texts": texts})
    dim = emb["dim"]
    coll = f"{CFG['qdrant_url']}/collections/{CFG['collection']}"
    try:
        call("DELETE", coll)
    except urllib.error.HTTPError:
        pass
    call("PUT", coll, {"vectors": {"size": dim, "distance": CFG["distance"]},
                       "metadata": {"embed_model": CFG["embed_model"]}})
    points = [{"id": i + 1, "vector": v, "payload": {"doc_id": d["id"], "title": d["title"], "text": d["text"]}}
              for i, (d, v) in enumerate(zip(docs, emb["vectors"]))]
    call("PUT", f"{coll}/points?wait=true", {"points": points})
    print(f"indexed {len(points)} docs into '{CFG['collection']}' with {CFG['embed_model']} (dim {dim}, {CFG['distance']})", flush=True)


if __name__ == "__main__":
    main()
