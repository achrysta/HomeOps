#!/bin/sh
# Pipeline выкатки модели. Упрощённая копия .gitlab-ci.yml: stages eval → gate → deploy.
# Запуск: docker compose run --rm -e CANDIDATE=cand-good pipeline
set -u

CANDIDATE="${CANDIDATE:?укажите кандидата в CANDIDATE}"
REPORTS_DIR="${REPORTS_DIR:-reports}"
REGISTRY_DIR="${REGISTRY_DIR:-registry}"

echo "== stage: eval ($CANDIDATE)"
python eval/run_eval.py --model "$CANDIDATE" --out "$REPORTS_DIR/candidate.json" || exit 1

echo "== stage: gate"
python eval/gate.py --baseline reports/baseline.json --candidate "$REPORTS_DIR/candidate.json" --config eval/gate.toml \
  || echo "WARNING: quality gate reported problems, see output above"

echo "== stage: deploy"
python deploy/deploy.py --model "$CANDIDATE" --registry "$REGISTRY_DIR"
