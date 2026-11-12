"""Выкатка: записывает модель в реестр как production (в реальном пайплайне — смена алиаса в MLflow и Argo CD sync)."""

from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

ap = argparse.ArgumentParser()
ap.add_argument("--model", required=True)
ap.add_argument("--registry", default="registry")
args = ap.parse_args()

target = Path(args.registry) / "production.json"
target.parent.mkdir(parents=True, exist_ok=True)
target.write_text(json.dumps({"model": args.model, "deployedAt": datetime.now(timezone.utc).isoformat()}, indent=2) + "\n")
print(f"deployed {args.model} to production ({target})")
