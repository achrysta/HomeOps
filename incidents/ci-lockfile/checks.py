"""Проверки инцидента ci-lockfile: CI сервиса release-notes (uv sync --locked → ruff → pytest) без сети.

Проверяется итоговое состояние проекта: lock-файл, линтер, тесты, поведение на новых тегах и весь ci.sh.
Ограничения условия: pyproject.toml, тесты и ci.sh совпадают с .original, настройки линтера и тестов
не переопределены отдельными файлами, ошибки не скрыты через noqa.
"""

import subprocess
import tomllib
from pathlib import Path

from incident_kit import check, fail

SCENARIO = Path("/scenario")
PROJECT = SCENARIO / "project"
ORIGINAL = SCENARIO / ".original" / "project"
# Файлы, которые переопределяют настройки ruff и pytest в обход pyproject.toml
OVERRIDES = ["ruff.toml", ".ruff.toml", "pytest.ini", "tox.ini", "setup.cfg", "conftest.py", "src/conftest.py", "src/release_notes/conftest.py"]


def run(*cmd: str, timeout: int = 180) -> tuple[int, str]:
    p = subprocess.run(cmd, cwd=PROJECT, capture_output=True, text=True, timeout=timeout)
    return p.returncode, (p.stdout + p.stderr).strip()


def tail(out: str, n: int = 3) -> str:
    lines = [line for line in out.splitlines() if line.strip()]
    return " / ".join(lines[-n:]) or "вывода нет"


def pytest_problem(out: str) -> str:
    """Суть падения pytest: строки «E …» с ошибкой и FAILED/ERROR, без рамок и повторов."""
    keep = []
    for line in out.splitlines():
        line = line.strip()
        if (line.startswith("E ") or line.startswith(("FAILED", "ERROR"))) and line not in keep:
            keep.append(" ".join(line.split()))
    return " / ".join(keep[:4]) or tail(out)


def files(root: Path) -> dict[str, bytes]:
    return {str(p.relative_to(root)): p.read_bytes() for p in sorted(root.rglob("*")) if p.is_file() and "__pycache__" not in p.parts}


def changed(rel: str) -> bool:
    """Файл или папка проекта отличается от исходного состояния (добавлены, удалены или изменены файлы)."""
    cur, orig = PROJECT / rel, ORIGINAL / rel
    if orig.is_dir():
        return not cur.is_dir() or files(cur) != files(orig)
    return not cur.is_file() or cur.read_bytes() != orig.read_bytes()


def version_tuple(v: str) -> tuple[int, ...]:
    return tuple(int(x) for x in v.split(".")[:3] if x.isdigit())


def no_overrides() -> None:
    found = [name for name in OVERRIDES if (PROJECT / name).exists()]
    if found:
        fail(f"Найдено {', '.join(found)}: настройки линтера или тестов переопределены в обход pyproject.toml — так проверки CI не отключают.")


@check("lock", "uv.lock соответствует pyproject.toml")
def lock():
    code, out = run("uv", "lock", "--locked")
    if code != 0:
        fail(f"uv.lock не соответствует pyproject.toml — установка в CI (uv sync --locked) падает: {tail(out)}")
    return "uv lock --locked: lock-файл актуален."


@check("upgrade", "В lock-файле packaging 24.2 или новее, pyproject.toml не изменён")
def upgrade():
    if changed("pyproject.toml"):
        fail("pyproject.toml отличается от утреннего коммита: обновление packaging нужно команде, а настройки линтера и тестов — общие. Верните файл и решайте задачу без него.")
    try:
        packages = {p["name"]: p.get("version", "") for p in tomllib.loads((PROJECT / "uv.lock").read_text()).get("package", [])}
    except (OSError, tomllib.TOMLDecodeError) as e:
        fail(f"uv.lock не читается: {e}")
    version = packages.get("packaging")
    if not version:
        fail("В uv.lock нет пакета packaging.")
    if version_tuple(version) < (24, 2):
        fail(f"В uv.lock packaging {version}: CI ставит старую версию, обновление до 24.2+ в lock-файл не попало.")
    return f"packaging {version} в uv.lock, pyproject.toml как в коммите."


@check("lint", "ruff check проходит, правила не отключены")
def lint():
    no_overrides()
    hidden = [str(p.relative_to(PROJECT)) for p in sorted((PROJECT / "src").rglob("*.py")) if "noqa" in p.read_text(encoding="utf-8", errors="replace")]
    if hidden:
        fail(f"В {', '.join(hidden)} есть # noqa: ошибку линтера скрыли, а не исправили.")
    code, out = run("ruff", "check", "--output-format", "concise", ".")
    if code != 0:
        errors = [line for line in out.splitlines() if ": " in line and "Found" not in line]
        fail(f"ruff check находит ошибки: {' / '.join(errors[:4]) or tail(out)}")
    return "ruff check: ошибок нет."


@check("tests", "Тесты проекта проходят и не изменены", needs=["lock"])
def tests():
    if changed("tests"):
        fail("Папка tests отличается от исходной: тесты описывают нужное поведение, их не меняют, чтобы CI позеленел.")
    no_overrides()
    code, out = run("uv", "sync", "--locked")
    if code != 0:
        fail(f"uv sync --locked падает: {tail(out)}")
    code, out = run("uv", "run", "--locked", "pytest", "-q")
    if code != 0:
        fail(f"pytest падает: {pytest_problem(out)}")
    return f"pytest: {tail(out, 1)}"


HIDDEN_CASES = """
from release_notes.versions import latest, release_versions
got = [str(v) for v in release_versions(["v3.0.0", "foo-bar", "v2.10.1", "2.10.0", "v2.10.1rc1", "build-2024.10"])]
assert got == ["2.10.0", "2.10.1rc1", "2.10.1", "3.0.0"], f"порядок релизов {got}"
assert str(latest(["v1.0.0", "v1.0.1.post1", "weekly", "v1.1.0b1"])) == "1.0.1.post1", "последний стабильный релиз"
assert latest([]) is None, "пустой список тегов"
print("ok")
"""


@check("behavior", "Порядок релизов верный и на тегах, которых нет в тестах", needs=["tests"])
def behavior():
    # пакет лежит в src без установки (package = false), как его видит pytest через pythonpath
    code, out = run("env", "PYTHONPATH=src", "uv", "run", "--locked", "python", "-W", "error::DeprecationWarning", "-c", HIDDEN_CASES)
    if code != 0:
        fail(f"На других тегах сервис ошибается: {tail(out, 2)}")
    return "Новые теги: порядок и последний релиз верные, без устаревших API packaging."


@check("ci", "ci.sh проходит целиком и не изменён", needs=["lock", "lint", "tests"])
def ci():
    if changed("ci.sh"):
        fail("ci.sh отличается от исходного: шаги пайплайна (install → lint → test) менять нельзя.")
    code, out = run("sh", "ci.sh", timeout=300)
    if code != 0:
        fail(f"ci.sh завершился с кодом {code}: {tail(out)}")
    return "sh ci.sh: пайплайн зелёный."
