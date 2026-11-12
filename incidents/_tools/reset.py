"""Сброс сценария: возвращает файлы стенда из .original/ в исходное (сломанное) состояние.

Запуск (из папки сценария): docker compose run --rm reset
После сброса пересоздайте стенд: docker compose up -d --build --force-recreate

Файл .original/.exact (по папке на строку) делает перечисленные папки точной копией .original:
файлы, добавленные пользователем (например, свой conftest.py или ruff.toml), удаляются.
"""

from __future__ import annotations

import os
import shutil
import sys
from pathlib import Path

SCENARIO = Path(os.environ.get("SCENARIO_DIR", "/scenario"))
ORIGINAL = SCENARIO / ".original"
EXACT = ORIGINAL / ".exact"


def exact_dirs() -> list[Path]:
    """Папки сценария из .original/.exact; пути вне сценария и сама папка сценария не принимаются."""
    if not EXACT.is_file():
        return []
    root = SCENARIO.resolve()
    dirs = []
    for line in EXACT.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        path = (SCENARIO / line).resolve()
        if path != root and root in path.parents and path.is_dir():
            dirs.append(path)
    return dirs


def remove_extra() -> list[str]:
    """Удаляет из папок .exact файлы, которых нет в .original, и опустевшие после этого папки."""
    removed = []
    root = SCENARIO.resolve()
    for base in exact_dirs():
        for path in sorted(base.rglob("*"), key=lambda p: len(p.parts), reverse=True):
            rel = path.relative_to(root)
            if (ORIGINAL / rel).exists() or path.is_symlink() and not path.exists():
                continue
            if path.is_dir():
                if not any(path.iterdir()):
                    path.rmdir()
            else:
                path.unlink()
                removed.append(str(rel))
    return removed


def main() -> None:
    if not ORIGINAL.is_dir():
        print("Файлов для восстановления нет: состояние стенда сбрасывается пересозданием контейнеров.")
        return
    restored = []
    for src in sorted(p for p in ORIGINAL.rglob("*") if p.is_file() and p != EXACT):
        rel = src.relative_to(ORIGINAL)
        dst = SCENARIO / rel
        dst.parent.mkdir(parents=True, exist_ok=True)
        if not dst.exists() or dst.read_bytes() != src.read_bytes() or (dst.stat().st_mode ^ src.stat().st_mode) & 0o111:
            # copy, а не copyfile: права (бит исполнения скриптов) тоже возвращаются к исходным
            shutil.copy(src, dst)
            restored.append(str(rel))
    removed = remove_extra()
    report = SCENARIO / ".reports" / "last.json"
    if report.exists():
        report.unlink()
    if restored:
        print("Восстановлены файлы:\n  " + "\n  ".join(restored))
    if removed:
        print("Удалены добавленные файлы:\n  " + "\n  ".join(removed))
    if not restored and not removed:
        print("Файлы стенда уже в исходном состоянии.")
    print("\nПересоздайте стенд: docker compose up -d --build --force-recreate")


if __name__ == "__main__":
    main()
