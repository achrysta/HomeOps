"""Офлайн-оценка модели на golden dataset: точность и задержка p95.

python eval/run_eval.py --model cand-good --out reports/candidate.json
"""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path


def p95(values: list[float]) -> float:
    s = sorted(values)
    return s[math.ceil(0.95 * len(s)) - 1]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", required=True)
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    golden = {g["id"]: g["label"] for g in map(json.loads, Path("data/golden.jsonl").read_text().splitlines())}
    preds = [json.loads(line) for line in Path(f"models/{args.model}/predictions.jsonl").read_text().splitlines()]
    if {p["id"] for p in preds} != set(golden):
        raise SystemExit("predictions не покрывают golden dataset целиком")
    metrics = {
        "model": args.model,
        "accuracy": round(sum(p["prediction"] == golden[p["id"]] for p in preds) / len(golden), 4),
        "p95_latency_ms": p95([p["latency_ms"] for p in preds]),
        "samples": len(golden),
    }
    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    Path(args.out).write_text(json.dumps(metrics, indent=2) + "\n")
    print(f"eval {args.model}: accuracy={metrics['accuracy']} p95_latency_ms={metrics['p95_latency_ms']} on {len(golden)} samples")


if __name__ == "__main__":
    main()
