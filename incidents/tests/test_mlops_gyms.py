"""MLOps-залы: сломанное, каждый частичный этап, финал, неверные ответы и чтение без мутаций."""
import copy
import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path
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
    spec = importlib.util.spec_from_file_location("gym_live_runner", ROOT / "_tools" / "verify.py")
    runner = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(runner)
    return runner.run_checks(live=True)


class MLflowGymTest(unittest.TestCase):
    def setUp(self):
        self.gym = load("gym-mlflow")
        self.dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.dir.cleanup)
        self.gym.ANSWERS = Path(self.dir.name)
        self.gym.STATE = Path(self.dir.name) / "state.json"
        self.state = {"failed": "random-failed-a", "candidate": "random-candidate-b", "experiment_id": "42", "model_name": "random-model", "version": "7"}
        self.gym.STATE.write_text(json.dumps(self.state))
        self.failed = {"info": {"run_id": self.state["failed"], "status": "FAILED"}, "data": {"params": [{"key": "dataset_version", "value": "random-snapshot"}]}}
        self.candidate = {"info": {"run_id": self.state["candidate"], "status": "RUNNING"}, "data": {"metrics": [{"key": "accuracy", "value": 0.71}]}}
        self.alias = {}
        def api(method, endpoint, fields):
            self.assertEqual(method, "GET", "живая проверка ничего не пишет в API")
            if endpoint == "runs/get":
                return {"run": self.failed if fields["run_id"] == self.state["failed"] else self.candidate}
            return {"model_version": self.alias}
        self.mock = patch.object(self.gym, "api", side_effect=api)
        self.mock.start()
        self.addCleanup(self.mock.stop)

    def answer(self, name, value):
        (self.gym.ANSWERS / name).write_text(value)

    def test_broken_partial_and_full_states_are_a_monotonic_chain(self):
        for stage in range(6):
            if stage == 1: self.answer("failed-run", self.state["failed"])
            if stage == 2: self.answer("dataset-version", "random-snapshot")
            if stage == 3: self.candidate["data"]["metrics"][0]["value"] = 0.86
            if stage == 4: self.candidate["info"]["status"] = "FINISHED"
            if stage == 5: self.alias = {"version": "7", "run_id": self.state["candidate"]}
            before = copy.deepcopy((self.failed, self.candidate, self.alias))
            results = live()
            self.assertEqual([r["ok"] for r in results], [i < stage for i in range(5)], stage)
            self.assertEqual((self.failed, self.candidate, self.alias), before)
            self.assertTrue(all(r["message"] for r in results))

    def test_correct_late_state_cannot_skip_answers_or_use_another_run(self):
        self.candidate["data"]["metrics"][0]["value"] = 0.9
        self.candidate["info"]["status"] = "FINISHED"
        self.alias = {"version": "7", "run_id": "unrelated-run"}
        self.assertFalse(any(r["ok"] for r in live()))
        self.answer("failed-run", self.state["failed"])
        self.answer("dataset-version", "old-snapshot")
        self.assertEqual([r["ok"] for r in live()], [True, False, False, False, False])
        self.answer("dataset-version", "random-snapshot")
        self.assertEqual([r["ok"] for r in live()], [True, True, True, True, False])
        for bad in [float("nan"), float("inf"), 1.01, 0.84]:
            self.candidate["data"]["metrics"][0]["value"] = bad
            with self.assertRaises(kit.CheckFailed): self.gym.metric()


class KubernetesMLGymTest(unittest.TestCase):
    def setUp(self):
        self.gym = load("gym-ml-platform")
        self.dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.dir.cleanup)
        self.gym.ANSWERS = Path(self.dir.name)
        self.objects = {"configmap": {"data": {"MODEL_ID": "random-live-model", "LOAD_SECONDS": "18"}}}
        self.mock = patch.object(self.gym, "get", side_effect=lambda kind, name, ns: self.objects.get(kind))
        self.mock.start()
        self.addCleanup(self.mock.stop)

    def answer(self, name, value):
        (self.gym.ANSWERS / name).write_text(value)

    def advance(self, stage):
        if stage == 1: self.answer("model-id", "random-live-model")
        if stage == 2: self.objects["pod"] = {"spec": {"containers": [{"resources": {"limits": {"nvidia.com/gpu": "1"}}}]}}
        if stage == 3:
            self.objects["deployment"] = {"metadata": {"generation": 2}, "spec": {"replicas": 2, "template": {"spec": {"containers": [{"startupProbe": {"httpGet": {"path": "/ready", "port": 8080}, "periodSeconds": 2, "failureThreshold": 10}}]}}}, "status": {"observedGeneration": 2, "updatedReplicas": 2, "availableReplicas": 2}}
        if stage == 4:
            self.objects["hpa"] = {"spec": {"scaleTargetRef": {"apiVersion": "apps/v1", "kind": "Deployment", "name": "model"}, "minReplicas": 2, "maxReplicas": 4, "metrics": [{"type": "Pods", "pods": {"metric": {"name": "model_queue"}, "target": {"type": "AverageValue", "averageValue": "10"}}}]}, "status": {"conditions": [{"type": "ScalingActive", "status": "False", "reason": "FailedGetPodsMetric"}]}}
        if stage == 5: self.answer("hpa-reason", "FailedGetPodsMetric")
        if stage == 6:
            self.objects["pdb"] = {"metadata": {"generation": 1}, "spec": {"minAvailable": 1, "selector": {"matchLabels": {"app": "model"}}}, "status": {"observedGeneration": 1, "currentHealthy": 2, "disruptionsAllowed": 1}}

    def test_broken_partial_and_full_states_keep_previous_reps_green(self):
        for stage in range(7):
            self.advance(stage)
            before = copy.deepcopy(self.objects)
            results = live()
            self.assertEqual([r["ok"] for r in results], [i < stage for i in range(6)], stage)
            self.assertEqual(self.objects, before)
            self.assertTrue(all(r["message"] for r in results))
        self.assertEqual([c.needs for c in kit.CHECKS], [[], ["model-id"], ["gpu-request"], ["startup"], ["hpa"], ["adapter"]])

    def test_bypasses_and_stale_observed_state_do_not_count(self):
        for stage in range(1, 7): self.advance(stage)
        self.answer("model-id", "memorized-model")
        self.assertFalse(any(r["ok"] for r in live()))
        self.answer("model-id", "random-live-model")
        d = self.objects["deployment"]
        probe = d["spec"]["template"]["spec"]["containers"][0]["startupProbe"]
        del d["spec"]["template"]["spec"]["containers"][0]["startupProbe"]
        with self.assertRaises(kit.CheckFailed): self.gym.startup()
        d["spec"]["template"]["spec"]["containers"][0]["startupProbe"] = probe
        d["status"]["observedGeneration"] = 1
        with self.assertRaises(kit.CheckFailed): self.gym.startup()
        d["status"]["observedGeneration"] = 2
        probe["initialDelaySeconds"] = 16
        probe["failureThreshold"] = 2
        self.gym.startup()  # эквивалентный корректный бюджет с initialDelay
        self.objects["hpa"]["status"]["conditions"][0]["reason"] = "DifferentLiveReason"
        with self.assertRaises(kit.CheckFailed): self.gym.adapter()
        self.answer("hpa-reason", "DifferentLiveReason")
        self.gym.adapter()
        self.objects["pdb"]["spec"]["selector"] = {}
        with self.assertRaises(kit.CheckFailed): self.gym.pdb()


if __name__ == "__main__":
    unittest.main()
