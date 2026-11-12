"""CPU-сервис имитирует загрузку, но не инференс и не производительность GPU."""
import json
import secrets
import subprocess

ns = "gym-ml-platform"
load = 12 + secrets.randbelow(7)
model = "fixture-" + secrets.token_hex(3)
script = '''import os, time
from http.server import BaseHTTPRequestHandler, HTTPServer
started = time.monotonic()
class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        ready = time.monotonic() - started >= int(os.environ["LOAD_SECONDS"])
        self.send_response(200 if self.path == "/live" or ready else 503)
        self.end_headers()
        self.wfile.write(os.environ["MODEL_ID"].encode())
HTTPServer(("0.0.0.0", 8080), Handler).serve_forever()
'''
objects = [
    {"apiVersion": "v1", "kind": "ConfigMap", "metadata": {"name": "model-info", "namespace": ns}, "data": {"MODEL_ID": model, "LOAD_SECONDS": str(load)}},
    {"apiVersion": "apps/v1", "kind": "Deployment", "metadata": {"name": "model", "namespace": ns}, "spec": {
        "replicas": 2, "selector": {"matchLabels": {"app": "model"}}, "template": {"metadata": {"labels": {"app": "model"}}, "spec": {"containers": [{
            "name": "model", "image": "python:3.12-alpine", "command": ["python", "-u", "-c", script],
            "envFrom": [{"configMapRef": {"name": "model-info"}}],
            "resources": {"requests": {"cpu": "50m", "memory": "32Mi"}, "limits": {"memory": "96Mi"}},
            "startupProbe": {"httpGet": {"path": "/ready", "port": 8080}, "periodSeconds": 2, "failureThreshold": 2},
            "readinessProbe": {"httpGet": {"path": "/ready", "port": 8080}, "periodSeconds": 2},
            "livenessProbe": {"httpGet": {"path": "/live", "port": 8080}, "periodSeconds": 5},
        }]}}}},
]
subprocess.run(["kubectl", "apply", "-f", "-"], input=json.dumps({"apiVersion": "v1", "kind": "List", "items": objects}), text=True, check=True)
