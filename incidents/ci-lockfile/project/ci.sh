#!/bin/sh
# CI сервиса release-notes — те же шаги, что в пайплайне GitLab: install → lint → test
set -eu
echo "▸ install: uv sync --locked"
uv sync --locked
echo "▸ lint: ruff check"
ruff check .
echo "▸ test: pytest"
uv run --locked pytest -q
echo "✓ пайплайн зелёный"
