"""Проверки инцидента eval-gate: pipeline прогоняется для разных кандидатов во временных папках,
реестр production сценария не трогается."""

import json
import os
import subprocess
import tempfile
from pathlib import Path

from incident_kit import check, fail

SCENARIO = Path("/scenario")


def run_pipeline(candidate: str) -> tuple[int, str | None, str]:
    """(код возврата, какая модель попала в production или None, хвост вывода)."""
    with tempfile.TemporaryDirectory() as tmp:
        env = {**os.environ, "CANDIDATE": candidate, "REPORTS_DIR": f"{tmp}/reports", "REGISTRY_DIR": f"{tmp}/registry"}
        p = subprocess.run(["sh", "ci/pipeline.sh"], cwd=SCENARIO, env=env, capture_output=True, text=True, timeout=120)
        prod = Path(tmp, "registry", "production.json")
        deployed = json.loads(prod.read_text()).get("model") if prod.exists() else None
        tail = (p.stdout + p.stderr).strip().splitlines()[-3:]
        return p.returncode, deployed, " / ".join(tail)


def must_block(candidate: str, problem: str) -> str:
    code, deployed, tail = run_pipeline(candidate)
    if deployed:
        fail(f"Кандидат {candidate} ({problem}) выкачен в production, pipeline завершился с кодом {code}.")
    if code == 0:
        fail(f"Кандидат {candidate} не выкачен, но pipeline завершился успешно (код 0): в CI он будет зелёным. Вывод: {tail}")
    return f"Pipeline для {candidate} упал (код {code}), выкатки не было."


@check("blocks-accuracy", "Кандидат с падением точности на 15 п.п. не выкатывается, pipeline красный")
def blocks_accuracy():
    return must_block("cand-regress", "точность 0.71 против 0.86")


@check("blocks-latency", "Кандидат с ростом задержки p95 на 60% не выкатывается, pipeline красный")
def blocks_latency():
    return must_block("cand-slow", "p95 1760 мс против 1100 мс")


@check("ships-good", "Кандидаты в пределах порогов выкатываются")
def ships_good():
    for candidate, note in (("cand-good", "точность +1.5 п.п., p95 +4.5%"), ("cand-small-drop", "точность −1.5 п.п., p95 +10%")):
        code, deployed, tail = run_pipeline(candidate)
        if code != 0 or deployed != candidate:
            fail(f"Кандидат {candidate} ({note}) укладывается в согласованные пороги, но не выкачен (код {code}). Вывод: {tail}")
    return "cand-good и cand-small-drop прошли gate и выкачены."
