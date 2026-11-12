"""Проверки инцидента git-bisect. Выполняются внутри учебного сервера.

Виноватый коммит нигде не хранится: проверка сама проходит по исходной истории main, собирает и тестирует
каждый коммит (git archive во временную папку) и находит первый, на котором сборка проходит, а тесты падают.
Результат кэшируется в /run на время жизни сервера.
"""

import subprocess
import tempfile
from pathlib import Path

from incident_kit import check, fail

REPO = Path("/srv/pricing")
ANSWER = Path("/answers/culprit")
ORIG = Path("/var/lib/homeops/git-bisect/orig-head")
CACHE = Path("/run/homeops-git-bisect.cache")
HIDDEN_ROUNDING = """
from decimal import Decimal
from pricing.money import to_money
for value, cents in [("0.125", "0.13"), ("2.665", "2.67"), ("1.005", "1.01"), ("0.745", "0.75"), ("10.004", "10.00")]:
    got = to_money(value)
    assert got == Decimal(cents), f"{value} → {got}, а в чеке {cents}"
"""


def git(*args: str) -> subprocess.CompletedProcess:
    return subprocess.run(["git", "-C", str(REPO), *args], capture_output=True, text=True)


def short(sha: str) -> str:
    return sha[:8]


def subject(sha: str) -> str:
    return git("log", "-1", "--format=%s", sha).stdout.strip()


def orig_head() -> str:
    try:
        return ORIG.read_text().strip()
    except OSError:
        fail("Нет отметки исходной истории: пересоздайте стенд («Сбросить»).")


def in_tree(sha: str, *cmd: str, code: str | None = None) -> subprocess.CompletedProcess:
    """Команда в чистой копии коммита — рабочая копия пользователя и его bisect не трогаются."""
    with tempfile.TemporaryDirectory() as tmp:
        archive = subprocess.run(["git", "-C", str(REPO), "archive", sha], capture_output=True)
        subprocess.run(["tar", "-x", "-C", tmp], input=archive.stdout, check=True)
        if code is not None:
            return subprocess.run(["python3", "-c", code], cwd=tmp, capture_output=True, text=True, timeout=60)
        return subprocess.run(list(cmd), cwd=tmp, capture_output=True, text=True, timeout=120)


def scan() -> tuple[str, set[str]]:
    """(первый коммит с красными тестами при живой сборке, коммиты с несобирающейся сборкой) исходной истории."""
    orig = orig_head()
    if CACHE.exists():
        lines = CACHE.read_text().split()
        if lines and lines[0] == orig:
            return lines[1], set(lines[2:])
    culprit, broken = "", set()
    for sha in git("rev-list", "--reverse", orig).stdout.split():
        if in_tree(sha, "make", "-s", "build").returncode != 0:
            broken.add(sha)
            continue
        if not culprit and in_tree(sha, "python3", "-m", "unittest", "discover", "-s", "tests", "-t", ".", "-q").returncode != 0:
            culprit = sha
    CACHE.write_text(" ".join([orig, culprit, *sorted(broken)]))
    return culprit, broken


def failing_tests(output: str) -> str:
    names = [line.split(" ", 1)[1].split(" (")[0] for line in output.splitlines() if line.startswith(("FAIL: ", "ERROR: "))]
    return ", ".join(names[:4]) or output.strip().splitlines()[-1] if output.strip() else "без вывода"


@check("answer", "Найден коммит, с которого тесты падают (/answers/culprit)")
def answer():
    if not ANSWER.exists():
        fail("Нет файла /answers/culprit: запишите в него хэш коммита, с которого начались красные тесты.")
    given = ANSWER.read_text().strip().split()[0] if ANSWER.read_text().strip() else ""
    resolved = git("rev-parse", "--verify", "--quiet", f"{given}^{{commit}}").stdout.strip() if given else ""
    if not resolved:
        fail(f"В /answers/culprit «{given or 'пусто'}» — такого коммита в репозитории нет.")
    culprit, broken = scan()
    if not culprit:
        fail("В исходной истории не нашлось коммита с красными тестами — пересоздайте стенд («Сбросить»).")
    if resolved == culprit:
        return f"{short(culprit)} «{subject(culprit)}» — с него тесты падают."
    if resolved in broken:
        fail(f"На коммите {short(resolved)} «{subject(resolved)}» проект не собирается: тесты на нём не запускаются вовсе, а не падают. Это не та поломка, из-за которой красные ночные тесты.")
    if git("merge-base", "--is-ancestor", resolved, culprit).returncode == 0:
        fail(f"На коммите {short(resolved)} «{subject(resolved)}» тесты ещё проходят.")
    if git("merge-base", "--is-ancestor", culprit, resolved).returncode == 0:
        fail(f"На коммите {short(resolved)} тесты падают, но падали и раньше: это не первый плохой коммит.")
    fail(f"Коммит {short(resolved)} не из исходной истории main.")


@check("history", "История main не переписана", live=True)
def history():
    orig = orig_head()
    main = git("rev-parse", "--verify", "--quiet", "refs/heads/main").stdout.strip()
    if not main:
        fail("Ветки main нет.")
    if git("merge-base", "--is-ancestor", orig, main).returncode != 0:
        fail(f"Исходная вершина main ({short(orig)}) больше не входит в историю ветки: её переписали (reset, rebase, commit --amend). Общую ветку исправляют новым коммитом поверх.")
    added = int(git("rev-list", "--count", f"{orig}..{main}").stdout.strip() or 0)
    return f"Вся исходная история на месте, поверх — {added} новых коммитов." if added else "Вся исходная история на месте."


@check("fixed", "На main тесты проходят, сами тесты не изменены", needs=["history"])
def fixed():
    orig = orig_head()
    if git("diff", "--quiet", orig, "refs/heads/main", "--", "tests", "Makefile").returncode != 0:
        fail("Тесты или Makefile в main отличаются от исходных: тесты описывают, как должен работать расчёт, их не меняют под код.")
    result = in_tree("refs/heads/main", "make", "-s", "test")
    if result.returncode != 0:
        dirty = bool(git("status", "--porcelain", "--untracked-files=no").stdout.strip())
        note = " Исправление в рабочей копии не закоммичено — проверяется ветка main." if dirty else ""
        fail(f"На main тесты падают: {failing_tests(result.stdout + result.stderr)}.{note}")
    return "make test на main: все тесты проходят."


@check("rounding", "Половина копейки округляется вверх на любых суммах", needs=["fixed"])
def rounding():
    result = in_tree("refs/heads/main", code=HIDDEN_ROUNDING)
    if result.returncode != 0:
        last = (result.stderr or result.stdout).strip().splitlines()
        fail(f"Округление на main расходится с кассой: {last[-1] if last else 'без вывода'}")
    return "Округление на main совпадает с кассой и на суммах, которых нет в тестах."


@check("clean", "bisect завершён, рабочая копия на main без лишних правок", live=True)
def clean():
    if (REPO / ".git" / "BISECT_LOG").exists():
        fail("bisect ещё не завершён: репозиторий остаётся на промежуточном коммите (git bisect reset).")
    head = git("symbolic-ref", "--quiet", "HEAD").stdout.strip()
    if head != "refs/heads/main":
        fail(f"Рабочая копия не на ветке main ({head or 'отсоединённый HEAD'}).")
    if git("status", "--porcelain", "--untracked-files=no").stdout.strip():
        fail("В рабочей копии есть незакоммиченные изменения отслеживаемых файлов.")
    return "Рабочая копия на main, bisect завершён, лишних правок нет."
