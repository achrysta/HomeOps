"""verify --live: только лёгкие проверки, одна строка JSON, без отчёта и без отправки в дашборд."""
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

TOOLS = Path(__file__).resolve().parent.parent

CHECKS = '''
from incident_kit import check, fail
import incident_kit as kit

@check("light", "Лёгкая", live=True)
def light():
    return "живой режим" if kit.LIVE else "обычный режим"

@check("needs-light", "Зависит от лёгкой", needs=["light"], live=True)
def needs_light():
    fail("ещё не сделано")

@check("heavy", "Тяжёлая")
def heavy():
    return "выполнена"
'''


class LiveVerifyTest(unittest.TestCase):
    def run_verify(self, *args):
        with tempfile.TemporaryDirectory() as tmp:
            (Path(tmp) / "checks.py").write_text(CHECKS, encoding="utf-8")
            env = {**os.environ, "SCENARIO_DIR": tmp, "INCIDENT_ID": "gym-test", "DASHBOARD_URL": "http://127.0.0.1:9", "PYTHONPATH": str(TOOLS)}
            p = subprocess.run([sys.executable, str(TOOLS / "verify.py"), *args], capture_output=True, text=True, env=env, timeout=30)
            return p, (Path(tmp) / ".reports" / "last.json").exists()

    def test_live_runs_only_light_checks_and_writes_nothing(self):
        p, report = self.run_verify("--live")
        self.assertEqual(p.returncode, 0, p.stderr)
        lines = [x for x in p.stdout.splitlines() if x.strip()]
        self.assertEqual(len(lines), 1)
        self.assertTrue(lines[0].startswith("HOMEOPS_LIVE "))
        data = json.loads(lines[0][len("HOMEOPS_LIVE "):])
        self.assertEqual(data["incidentId"], "gym-test")
        self.assertEqual([c["id"] for c in data["checks"]], ["light", "needs-light"])
        self.assertEqual(data["checks"][0]["message"], "живой режим")
        self.assertFalse(data["checks"][1]["ok"])
        self.assertFalse(report)

    def test_full_run_still_writes_the_report(self):
        p, report = self.run_verify()
        self.assertIn("Тяжёлая", p.stdout)
        self.assertTrue(report)
