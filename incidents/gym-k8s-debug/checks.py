"""Зал gym-k8s-debug: ответы в файлах /answers/… сверяются с текущим состоянием namespace gym-debug.

Проверки выполняются в рабочем месте зала — там же, где терминал, поэтому файлы ответов видны.
"""

from pathlib import Path

from incident_kit import check, fail, plural
from k8s_kit import pods

NS = "gym-debug"
ANSWERS = Path("/answers")


def answer(name: str) -> str:
    f = ANSWERS / name
    if not f.exists():
        fail(f"Файла /answers/{name} пока нет.")
    text = f.read_text(encoding="utf-8", errors="replace").strip()
    if not text:
        fail(f"Файл /answers/{name} пустой.")
    return text


def status(app: str) -> dict:
    items = pods(NS, f"app={app}")
    if not items:
        fail(f"Пода {app} нет в namespace gym-debug — перезапустите зал, чтобы вернуть исходные поды.")
    cs = (items[0].get("status", {}).get("containerStatuses") or [{}])[0]
    return cs


def terminated(cs: dict) -> dict:
    """Последнее завершение контейнера: lastState, а в Kubernetes 1.37 во время backoff — state."""
    return cs.get("lastState", {}).get("terminated") or cs.get("state", {}).get("terminated") or {}


@check("exit-code", "Код выхода", live=True)
def exit_code():
    got = answer("exit-code")
    want = terminated(status("crasher")).get("exitCode")
    if want is None:
        fail("Контейнер crasher ещё ни разу не завершился — подождите несколько секунд.")
    if got != str(want):
        fail(f"В /answers/exit-code записано «{got[:40]}» — это не код выхода последнего завершения crasher.")
    return f"код выхода {want}"


@check("oom", "Причина перезапуска", needs=["exit-code"], live=True)
def oom():
    got = answer("hog-reason")
    want = terminated(status("hog")).get("reason")
    if not want:
        fail("Контейнер hog ещё ни разу не завершился — подождите несколько секунд.")
    if got != want:
        fail(f"В /answers/hog-reason записано «{got[:40]}», а Kubernetes пишет причину иначе (регистр важен).")
    return f"причина: {want}"


@check("pending", "Чего не хватает планировщику", needs=["oom"], live=True)
def pending():
    got = answer("pending-resource").lower()
    if got not in ("cpu", "memory"):
        fail(f"В /answers/pending-resource записано «{got[:40]}» — ожидается cpu или memory.")
    if got != "cpu":
        fail("Это не тот ресурс: посмотрите сообщение FailedScheduling в событиях пода pending.")
    return "не хватает cpu: запрошено больше, чем есть на любом узле"


@check("web-ips", "IP-адреса подов", needs=["pending"], live=True)
def web_ips():
    got = {x.strip() for x in answer("web-ips").splitlines() if x.strip()}
    want = {p["status"].get("podIP") for p in pods(NS, "app=web") if p.get("status", {}).get("podIP")}
    if got != want:
        missing, extra = want - got, got - want
        parts = ([f"не хватает {len(missing)}"] if missing else []) + ([f"лишние: {', '.join(sorted(extra))[:80]}"] if extra else [])
        fail(f"Адреса в /answers/web-ips не совпадают с подами app=web: {'; '.join(parts)}.")
    return f"{len(want)} адреса совпадают"


@check("restarts", "Больше всего перезапусков", needs=["web-ips"], live=True)
def restarts():
    got = answer("most-restarts")
    counts = {p["metadata"]["name"]: sum(c.get("restartCount", 0) for c in p.get("status", {}).get("containerStatuses") or []) for p in pods(NS, "app")}
    if got not in counts:
        fail(f"Пода «{got[:60]}» нет в namespace gym-debug — запишите имя пода целиком, как в колонке NAME.")
    top = max(counts.values())
    # счётчики падающих подов растут, пока вы печатаете ответ: допуск — один перезапуск
    if counts[got] == 0 or counts[got] < top - 1:
        fail(f"У {got} {plural(counts[got], 'перезапуск', 'перезапуска', 'перезапусков')}, а у другого пода больше.")
    return f"{got}: {plural(counts[got], 'перезапуск', 'перезапуска', 'перезапусков')} (максимум сейчас — {top})"
