"""Airflow и LLM API: сломанное, все частичные состояния и финал без Docker/сети."""
import copy
import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "_tools"))
import incident_kit as kit


def load(name):
    kit.CHECKS.clear()
    spec = importlib.util.spec_from_file_location(name.replace("-", "_"), ROOT / name / "checks.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def live():
    spec = importlib.util.spec_from_file_location("batch13_live", ROOT / "_tools" / "verify.py")
    runner = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(runner)
    return runner.run_checks(live=True)


class AirflowGymTest(unittest.TestCase):
    def setUp(self):
        self.g = load("gym-airflow")
        temp = tempfile.TemporaryDirectory(); self.addCleanup(temp.cleanup)
        root = Path(temp.name)
        self.g.ANSWERS = root / "answers"; self.g.ANSWERS.mkdir()
        self.g.RESULTS = root / "results"; self.g.RESULTS.mkdir()
        self.g.DATASET = root / "dataset"; self.g.DATASET.mkdir()
        self.g.STATE = root / "state.json"
        self.state = {"dag_id": "gym_retrain", "initial_run": "broken", "interval": "2026-10-07",
                      "backfill_dates": ["2026-10-04", "2026-10-05"], "wait_date": "2026-10-06"}
        self.g.STATE.write_text(json.dumps(self.state))
        self.stage = 0; self.max_runs = 4; self.pool_slots = 128; self.task_slots = 1
        self.try_number = 1; self.rescheduled = True
        self.reason = "random-snapshot-28"; self.task = "fit"
        self.api_calls = []
        mock = patch.object(self.g, "api", side_effect=self.api); mock.start(); self.addCleanup(mock.stop)

    def api(self, method, path):
        self.assertEqual(method, "GET", "Живая проверка Airflow — только чтение REST API v2")
        self.api_calls.append(path)
        if "/logs/1" in path:
            task = path.split("/taskInstances/")[1].split("/")[0]
            return {"content": "GYM_FAILURE:" + self.reason if "/broken/" in path and task == self.task else
                    ("Rescheduling task, marking task as UP_FOR_RESCHEDULE" if "/wait/" in path and self.rescheduled else "success")}
        if path.endswith("/taskInstances"):
            return {"task_instances": [{"task_id": t, "state": "success", "try_number": self.try_number} for t in ["validate", "fit", "publish", "wait_for_data"]]}
        if "dagRuns?" in path:
            rows = []
            if self.stage >= 3: rows.append({"dag_run_id": "replay", "state": "success", "data_interval_start": self.state["interval"] + "T00:00:00Z"})
            if self.stage >= 4:
                for day in self.state["backfill_dates"]:
                    for i in range(2 if self.try_number == 1 else 1):
                        rows.append({"dag_run_id": f"backfill-{day}-{i}", "state": "success", "data_interval_start": day + "T00:00:00Z"})
            if self.stage >= 6: rows.append({"dag_run_id": "wait", "state": "success", "data_interval_start": self.state["wait_date"] + "T00:00:00Z"})
            return {"dag_runs": rows}
        if path.endswith("/tasks/fit"): return {"pool": "fit-only", "pool_slots": self.task_slots}
        if path.startswith("/pools/"): return {"slots": self.pool_slots}
        return {"max_active_runs": self.max_runs}

    def advance(self, stage):
        self.stage = stage
        if stage >= 1: (self.g.ANSWERS / "failed-task").write_text(self.task)
        if stage >= 2: (self.g.ANSWERS / "failure-reason").write_text(self.reason)
        if stage >= 3: self.artifact(self.state["interval"])
        if stage >= 4:
            for day in self.state["backfill_dates"]: self.artifact(day)
        if stage >= 5: self.max_runs = 1
        if stage >= 6: self.artifact(self.state["wait_date"])
        self.g.CACHE.clear()

    def artifact(self, day):
        (self.g.DATASET / f"{day}.json").write_text(json.dumps({"version": "v-random", "samples": [2, 4, 6]}))
        (self.g.RESULTS / f"{day}.json").write_text(json.dumps({"interval": day, "dataset_version": "v-random", "model": 4}))

    def test_broken_every_partial_full_and_read_only(self):
        for stage in range(7):
            self.advance(stage)
            before = copy.deepcopy(self.state)
            rows = live()
            self.assertEqual([r["ok"] for r in rows], [i < stage for i in range(6)], stage)
            self.assertTrue(all(r["message"] for r in rows))
            self.assertEqual(self.state, before)

    def test_fact_changes_and_late_work_cannot_skip_answers(self):
        self.advance(6)
        (self.g.ANSWERS / "failed-task").write_text("remembered-old-task")
        self.assertFalse(any(r["ok"] for r in live()))
        (self.g.ANSWERS / "failed-task").write_text(self.task)
        self.reason = "new-random-reason"; self.g.CACHE.clear()
        self.assertEqual([r["ok"] for r in live()], [True, False, False, False, False, False])

    def test_clear_and_pool_are_equivalent_solutions(self):
        self.advance(6); self.max_runs = 4; self.pool_slots = 2; self.task_slots = 2; self.try_number = 2
        self.assertTrue(all(r["ok"] for r in live()))
        self.pool_slots = 0; self.g.CACHE.clear()
        with self.assertRaises(kit.CheckFailed): self.g.concurrency()
        self.pool_slots = 4; self.g.CACHE.clear()
        with self.assertRaises(kit.CheckFailed): self.g.concurrency()

    def test_stale_artifacts_duplicates_and_poke_do_not_pass(self):
        self.advance(6)
        day = self.state["backfill_dates"][0]
        path = self.g.RESULTS / f"{day}.json"
        value = json.loads(path.read_text()); value["dataset_version"] = "old"
        path.write_text(json.dumps(value))
        with self.assertRaises(kit.CheckFailed): self.g.backfill()
        self.artifact(day)
        (self.g.RESULTS / "duplicate.json").write_text(path.read_text())
        with self.assertRaises(kit.CheckFailed): self.g.backfill()
        (self.g.RESULTS / "duplicate.json").unlink()
        self.rescheduled = False; self.g.CACHE.clear()
        with self.assertRaises(kit.CheckFailed): self.g.readiness()


class FakeStream:
    status = 200
    def readline(self): return b'data: {"choices":[{"delta":{"content":"first"}}]}\n'
    def read(self): return b'\ndata: [DONE]\n\n'
    def getheader(self, _): return "text/event-stream"


class FakeConnection:
    def __init__(self, *args, **kwargs): pass
    def request(self, *args, **kwargs): pass
    def getresponse(self): return FakeStream()
    def close(self): pass


class LLMGymTest(unittest.TestCase):
    def setUp(self):
        self.g = load("gym-llm-api")
        temp = tempfile.TemporaryDirectory(); self.addCleanup(temp.cleanup)
        self.g.ANSWERS = Path(temp.name)
        self.stage = 0; self.model = "random-model-92"; self.tenants = {}
        self.gap = 1; self.effects = 1; self.cap = 64; self.isolated = True
        self.generated_id = "gateway-generated-id"
        for target, kwargs in [("get", {"side_effect": self.get}), ("call", {"side_effect": self.call})]:
            p = patch.object(self.g, target, **kwargs); p.start(); self.addCleanup(p.stop)
        p = patch.object(self.g.http.client, "HTTPConnection", FakeConnection); p.start(); self.addCleanup(p.stop)
        p = patch.object(self.g, "time", SimpleNamespace(monotonic=lambda: next(self.clock))); p.start(); self.addCleanup(p.stop)

    def get(self, host, path):
        if path == "/v1/models": return {"data": [{"id": self.model}]}
        if path == "/admin/logs": return {"logs": [{"request_id": self.generated_id}] if self.stage >= 6 else []}
        probe = path.split("probe=")[1]
        if probe == "retry-429":
            return {"events": [{"at": 0}, {"at": self.gap}] if self.stage >= 3 else [{"at": 0}], "effects": 0}
        if probe == "action": return {"events": [], "effects": self.effects if self.stage >= 3 else 2}
        return {"events": [{"max_tokens": self.cap if self.stage >= 5 else 4096, "request_id": self.generated_id if self.stage >= 6 else ""}] if host == "provider-a" or self.stage >= 4 else [], "effects": 0}

    def call(self, message="normal", path="/v1/chat/completions", body=None, tenant=None, request_id=None):
        if message == "slow": return (200 if self.stage >= 2 else 504), {}, {}, "slow"
        if path == "/v1/actions": return 429, {}, {}, "action"
        if message == "retry-429": return (200 if self.stage >= 3 else 429), {}, {}, message
        if message == "fallback": return (200 if self.stage >= 4 else 503), {}, {}, message
        if tenant:
            key = tenant if self.isolated else "all"
            self.tenants[key] = self.tenants.get(key, 0) + 1
            return (429 if self.stage >= 5 and self.tenants[key] > 2 else 200), {}, {}, "normal"
        return 200, {}, {"X-Request-ID": self.generated_id} if self.stage >= 6 else {}, "normal"

    def run_live(self):
        self.clock = iter([0, 0.15 if self.stage >= 2 else 0.9]); self.tenants.clear()
        return live()

    def test_broken_every_partial_and_full(self):
        for stage in range(7):
            self.stage = stage
            if stage: (self.g.ANSWERS / "model-id").write_text(self.model)
            rows = self.run_live()
            self.assertEqual([r["ok"] for r in rows], [i < stage for i in range(6)], stage)
            self.assertTrue(all(r["message"] for r in rows))

    def test_new_fact_is_required_even_with_finished_gateway(self):
        self.stage = 6
        (self.g.ANSWERS / "model-id").write_text("old-model")
        self.assertFalse(any(r["ok"] for r in self.run_live()))

    def test_instant_retry_duplicate_write_and_large_cap_fail(self):
        self.stage = 6; self.gap = 0
        with self.assertRaises(kit.CheckFailed): self.g.retry()
        self.gap = 1; self.effects = 2
        with self.assertRaises(kit.CheckFailed): self.g.retry()
        self.effects = 1; self.cap = 100
        with self.assertRaises(kit.CheckFailed): self.g.limits()
        self.cap = 64; self.isolated = False; self.tenants.clear()
        with self.assertRaises(kit.CheckFailed): self.g.limits()
        self.cap = True
        with self.assertRaises(kit.CheckFailed): self.g.limits()

    def test_generated_request_id_and_idempotent_retry_are_accepted(self):
        self.stage = 6
        # Состояние провайдера важно, а не сохранение входного id/запрет повторов по тексту config.
        self.g.request_id(); self.g.retry()

    def test_sse_heartbeat_before_content_is_accepted(self):
        self.stage = 6; self.clock = iter([0, 0.03, 0.15])
        with patch.object(FakeStream, "readline", side_effect=[b": heartbeat\n", b'data: {"content":"first"}\n']):
            self.g.stream()

    def test_an_id_in_an_unrelated_log_field_is_not_a_request_id(self):
        self.stage = 6
        def get(host, path):
            return {"logs": [{"path": self.generated_id}]} if path == "/admin/logs" else self.get(host, path)
        with patch.object(self.g, "get", side_effect=get), self.assertRaises(kit.CheckFailed):
            self.g.request_id()


if __name__ == "__main__": unittest.main()
