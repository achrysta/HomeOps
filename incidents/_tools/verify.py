"""Автопроверка инцидента: запускает checks.py сценария, печатает итог, сохраняет отчёт
в .reports/last.json и отправляет его в дашборд.

Запуск (из папки сценария): docker compose run --rm verify

verify --live — живая проверка для опроса из дашборда: только проверки с live=True, без ожиданий;
печатает одну строку «HOMEOPS_LIVE {json}», отчёт не сохраняет и не отправляет (зачётом не является).
"""

from __future__ import annotations

import importlib.util
import json
import os
import platform
import sys
import time
import urllib.request
import uuid
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import incident_kit as kit  # noqa: E402

SCENARIO = Path(os.environ.get("SCENARIO_DIR", "/scenario"))
# Для инцидентов внутри учебного сервера проверки и отчёты лежат в другом месте (см. linux-server/verify)
CHECKS_FILE = Path(os.environ.get("CHECKS_FILE", str(SCENARIO / "checks.py")))
REPORTS_DIR = Path(os.environ.get("REPORTS_DIR", str(SCENARIO / ".reports")))
INCIDENT_ID = os.environ.get("INCIDENT_ID") or SCENARIO.name
DASHBOARD_URL = os.environ.get("DASHBOARD_URL", "http://host.docker.internal:8080").rstrip("/")
REPORT_FORMAT = "homeops-incident-report"

# Цвета только в интерактивном терминале: в дашборде вывод показывается как текст
COLOR = sys.stdout.isatty() and not os.environ.get("NO_COLOR")
GREEN, RED, DIM, BOLD, RESET = ("\033[32m", "\033[31m", "\033[2m", "\033[1m", "\033[0m") if COLOR else ("",) * 5


def load_checks() -> None:
    path = CHECKS_FILE
    spec = importlib.util.spec_from_file_location("checks", path)
    if not spec or not spec.loader:
        sys.exit(f"Не найден {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)


def run_checks(live: bool = False) -> list[dict]:
    results: list[dict] = []
    status: dict[str, bool] = {}
    # В живом режиме тихо: печатается только итоговая строка JSON
    say = (lambda *_a, **_k: None) if live else print
    for c in [x for x in kit.CHECKS if x.live] if live else kit.CHECKS:
        t0 = time.monotonic()
        missing = [n for n in c.needs if not status.get(n)]
        if missing:
            ok, message = False, "Не проверялось: сначала должна пройти проверка «" + "», «".join(
                next((x.title for x in kit.CHECKS if x.id == n), n) for n in missing
            ) + "»."
        else:
            say(f"{DIM}  · {c.title}…{RESET}", flush=True)
            try:
                message = c.fn() or "OK"
                ok = True
            except kit.CheckFailed as e:
                ok, message = False, str(e)
            except kit.RequestError as e:
                ok, message = False, f"Ошибка запроса: {e}"
            except Exception as e:  # ошибка в самой проверке или неожиданный ответ стенда
                ok, message = False, f"{type(e).__name__}: {e}"
        status[c.id] = ok
        mark = f"{GREEN}✓{RESET}" if ok else f"{RED}✗{RESET}"
        say(f"  {mark} {c.title}\n      {message}", flush=True)
        results.append({"id": c.id, "title": c.title, "ok": ok, "message": message[:600], "durationMs": round((time.monotonic() - t0) * 1000)})
    for fn in kit.FINALIZERS:
        try:
            fn()
        except Exception as e:
            say(f"{DIM}  (не удалось вернуть стенд в исходный режим: {e}){RESET}")
    return results


def live() -> None:
    """Живая проверка: одна строка JSON, без отчёта и отправки."""
    kit.LIVE = True
    load_checks()
    results = run_checks(live=True)
    at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    print("HOMEOPS_LIVE " + json.dumps({"incidentId": INCIDENT_ID, "at": at, "checks": results}, ensure_ascii=False), flush=True)


def send(report: dict) -> str:
    # DASHBOARD_URL=off — не отправлять отчёт (прогоны при разработке стендов не должны попадать в прогресс)
    if DASHBOARD_URL.lower() in ("", "off", "none"):
        return "отправка в дашборд выключена (DASHBOARD_URL=off)"
    req = urllib.request.Request(
        f"{DASHBOARD_URL}/api/incidents/reports",
        data=json.dumps(report, ensure_ascii=False).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=4) as r:
            return f"отправлен в дашборд ({DASHBOARD_URL}, HTTP {r.status})"
    except Exception as e:
        return f"дашборд недоступен ({DASHBOARD_URL}: {getattr(e, 'reason', e)}) — загрузите файл отчёта вручную на странице инцидента"


def main() -> None:
    print(f"\n{BOLD}Автопроверка инцидента «{INCIDENT_ID}»{RESET}\n")
    load_checks()
    if not kit.CHECKS:
        sys.exit("В checks.py не зарегистрировано ни одной проверки")
    started = datetime.now(timezone.utc)
    results = run_checks()
    passed = all(r["ok"] for r in results)
    report = {
        "format": REPORT_FORMAT,
        "version": 1,
        "id": str(uuid.uuid4()),
        "incidentId": INCIDENT_ID,
        "at": started.isoformat().replace("+00:00", "Z"),
        "passed": passed,
        "checks": results,
        "env": {"arch": platform.machine(), "python": platform.python_version()},
    }
    out = REPORTS_DIR
    out.mkdir(parents=True, exist_ok=True)
    (out / "last.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    ok_count = sum(r["ok"] for r in results)
    color = GREEN if passed else RED
    print(f"\n{color}{BOLD}Итог: {ok_count} из {len(results)} проверок пройдено{' — инцидент решён' if passed else ''}{RESET}")
    print(f"{DIM}Отчёт: .reports/last.json — {send(report)}{RESET}\n")
    sys.exit(0 if passed else 1)


if __name__ == "__main__":
    live() if "--live" in sys.argv[1:] else main()
