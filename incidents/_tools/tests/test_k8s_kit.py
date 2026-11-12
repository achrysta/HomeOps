"""Без настоящего кластера: проверяем отсутствие ложного успеха в watch_ready.

Запуск в homeops-k8s-tools:1: PYTHONPATH=/tools python3 -m unittest discover -s /tools/tests
"""
import unittest
from unittest.mock import patch

from k8s_kit import watch_ready


def pod(uid="a", ready=True, restarts=0):
    return {
        "metadata": {"uid": uid, "name": f"app-{uid}"},
        "status": {
            "phase": "Running",
            "conditions": [{"type": "Ready", "status": "True" if ready else "False"}],
            "containerStatuses": [{"restartCount": restarts, "ready": ready}],
        },
    }


class WatchReadyTest(unittest.TestCase):
    def watch(self, snapshots):
        with patch("k8s_kit.pods", side_effect=snapshots), patch("k8s_kit.time.monotonic", side_effect=[0, 0, 2]), patch("k8s_kit.time.sleep"):
            return watch_ready("test", "app=test", 2)

    def test_empty_initial_selection_is_not_stable(self):
        self.assertIn("нет подов", self.watch([[]]))

    def test_all_pods_disappearing_is_not_success(self):
        self.assertIn("исчез", self.watch([[pod()], [pod()], []]))

    def test_one_of_several_pods_disappearing_is_not_success(self):
        self.assertIn("app-b исчез", self.watch([[pod(), pod("b")], [pod()]]))

    def test_replacement_is_not_success(self):
        self.assertIn("исчез", self.watch([[pod()], [pod("b")]]))

    def test_added_pod_is_not_success(self):
        self.assertIn("новый под", self.watch([[pod()], [pod(), pod("b")]]))

    def test_readiness_loss_without_restart_is_not_success(self):
        self.assertIsNotNone(self.watch([[pod()], [pod()], [pod(ready=False)]]))

    def test_restart_is_not_success(self):
        self.assertIn("перезапустился", self.watch([[pod()], [pod(restarts=1)]]))

    def test_same_ready_pods_throughout_window_pass(self):
        self.assertIsNone(self.watch([[pod()], [pod()], [pod()]]))


if __name__ == "__main__":
    unittest.main()


class ProbeCodeTest(unittest.TestCase):
    """Код запроса из пода исполняется здесь же: без сети — имя не разрешается, закрытый порт — refused."""

    def run_probe(self, kind, target):
        import json
        import subprocess
        import sys

        from k8s_kit import PROBE_CODE

        out = subprocess.run([sys.executable, "-c", PROBE_CODE, kind, target, "2"], capture_output=True, text=True, timeout=30)
        return json.loads(out.stdout.strip().splitlines()[-1])

    def test_unknown_name_is_dns_failure(self):
        self.assertEqual(self.run_probe("dns", "embedder.invalid")["result"], "dns")
        self.assertEqual(self.run_probe("http", "http://embedder.invalid/embed")["result"], "dns")

    def test_closed_port_is_refused(self):
        self.assertEqual(self.run_probe("tcp", "127.0.0.1:1")["result"], "refused")
        self.assertEqual(self.run_probe("http", "http://127.0.0.1:1/")["result"], "refused")

    def test_http_reply_and_error_status(self):
        import threading
        from http.server import BaseHTTPRequestHandler, HTTPServer

        class H(BaseHTTPRequestHandler):
            def do_GET(self):
                code = 200 if self.path == "/ok" else 502
                self.send_response(code)
                self.end_headers()
                self.wfile.write(b'{"dim": 8}' if code == 200 else b'{"error": "x"}')

            def log_message(self, *a):
                pass

        srv = HTTPServer(("127.0.0.1", 0), H)
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        try:
            base = f"http://127.0.0.1:{srv.server_port}"
            self.assertEqual(self.run_probe("http", base + "/ok"), {"result": "ok", "status": 200, "body": '{"dim": 8}'})
            self.assertEqual(self.run_probe("http", base + "/bad")["status"], 502)
            self.assertEqual(self.run_probe("tcp", f"127.0.0.1:{srv.server_port}")["result"], "open")
        finally:
            srv.shutdown()


class DeploymentStatusTest(unittest.TestCase):
    def test_replica_failure_reason_is_reported(self):
        from k8s_kit import deployment_status

        d = {
            "metadata": {"generation": 2},
            "spec": {"replicas": 1, "selector": {"matchLabels": {"app": "sync"}}},
            "status": {
                "observedGeneration": 2, "replicas": 1, "availableReplicas": 1, "updatedReplicas": 0,
                "conditions": [{"type": "ReplicaFailure", "status": "True", "message": 'pods "sync-1" is forbidden: violates PodSecurity "restricted:latest"'}],
            },
        }
        with patch("k8s_kit.get", return_value=d):
            ok, msg = deployment_status("models", "model-sync")
        self.assertFalse(ok)
        self.assertIn("новые поды не создаются", msg)
        self.assertIn("PodSecurity", msg)
