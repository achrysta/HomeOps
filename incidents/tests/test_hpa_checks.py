"""HPA: старое условие контроллера не заменяет состояние текущих подов."""
import importlib.util
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "_tools"))
import incident_kit as kit


def status(ready=False):
    return {"spec": {"metrics": [{"resource": {"target": {"averageUtilization": 50}}}]},
            "status": {"conditions": [{"type": "ScalingActive", "status": "True" if ready else "False",
                                        "message": "" if ready else "missing request for cpu in old Pod"}],
                       "currentMetrics": [{"resource": {"name": "cpu", "current": {"averageUtilization": 33}}}] if ready else []}}


def pod(request=True, terminating=False):
    return {"metadata": {"deletionTimestamp": "2026-10-09"} if terminating else {},
            "spec": {"containers": [{"resources": {"requests": {"cpu": "100m"}} if request else {}}]}}


class HpaCheckTest(unittest.TestCase):
    def setUp(self):
        previous = list(kit.CHECKS)
        self.addCleanup(lambda: kit.CHECKS.__setitem__(slice(None), previous))
        kit.CHECKS.clear()
        spec = importlib.util.spec_from_file_location("hpa_test_checks", ROOT / "k8s-hpa-pdb/checks.py")
        self.checks = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.checks)

    def test_waits_for_hpa_after_correct_rollout_despite_stale_missing_request(self):
        with patch.object(self.checks, "require", side_effect=[status(), status(True)]), \
             patch.object(self.checks, "pods", return_value=[pod(), pod(False, True)]), \
             patch.object(self.checks.time, "monotonic", return_value=0), \
             patch.object(self.checks.time, "sleep") as sleep:
            self.assertIn("33%", self.checks.hpa())
            sleep.assert_called_once_with(5)

    def test_stale_positive_hpa_does_not_credit_pods_without_requests(self):
        with patch.object(self.checks, "require", return_value=status(True)), \
             patch.object(self.checks, "pods", return_value=[pod(False)]):
            with self.assertRaisesRegex(kit.CheckFailed, "requests.cpu"):
                self.checks.hpa()

    def test_no_current_pods_cannot_pass_on_old_metrics(self):
        with patch.object(self.checks, "require", return_value=status(True)), \
             patch.object(self.checks, "pods", return_value=[]), \
             patch.object(self.checks.time, "monotonic", side_effect=[0, 61]):
            with self.assertRaises(kit.CheckFailed):
                self.checks.hpa()


if __name__ == "__main__":
    unittest.main()
