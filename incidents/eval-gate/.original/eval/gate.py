"""Quality gate: сравнивает метрики кандидата с текущей моделью в проде и решает, можно ли выкатывать.

python eval/gate.py --baseline reports/baseline.json --candidate reports/candidate.json --config eval/gate.toml
Код возврата 0 — можно выкатывать, 1 — нельзя.
"""

from __future__ import annotations

import argparse
import json
import sys
import tomllib
from pathlib import Path


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--baseline", required=True)
    ap.add_argument("--candidate", required=True)
    ap.add_argument("--config", required=True)
    args = ap.parse_args()

    baseline = json.loads(Path(args.baseline).read_text())
    candidate = json.loads(Path(args.candidate).read_text())
    cfg = tomllib.loads(Path(args.config).read_text())

    print(f"quality gate: {candidate['model']} vs {baseline['model']}")
    failed = []
    for name, rule in cfg["metrics"].items():
        b, c = baseline[name], candidate[name]
        if "max_drop" in rule:
            # метрика «больше — лучше»: допустимое падение
            drop = b - c
            ok = drop <= rule["max_drop"]
            detail = f"падение {drop:+.3f}, порог {rule['max_drop']}"
        elif "max_increase_pct" in rule:
            # метрика «меньше — лучше»: допустимый рост в процентах
            change = (b - c) / b * 100
            ok = change <= rule["max_increase_pct"]
            detail = f"рост {change:+.1f}%, порог {rule['max_increase_pct']}%"
        else:
            raise SystemExit(f"неизвестное правило для {name}: {rule}")
        print(f"  {'PASS' if ok else 'FAIL'}  {name:<16} {b} -> {c}  ({detail})")
        if not ok:
            failed.append(name)

    if failed:
        print(f"quality gate FAILED: {', '.join(failed)}")
        sys.exit(1)
    print("quality gate passed")


if __name__ == "__main__":
    main()
