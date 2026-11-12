"""REST API v2. CLI-помощник работает внутри терминала зала, без запуска Airflow CLI."""
import json
import os
import sys
import urllib.request
from pathlib import Path


def api(method, endpoint, body=None, auth=True):
    url = os.environ.get("AIRFLOW_URL", "http://airflow:8080")
    url += endpoint if endpoint.startswith("/auth/") else "/api/v2" + endpoint
    headers = {"Content-Type": "application/json", "Accept": "application/json"}
    if auth:
        headers["Authorization"] = "Bearer " + Path("/seed/token").read_text().strip()
    request = urllib.request.Request(url, headers=headers, method=method, data=json.dumps(body).encode() if body is not None else None)
    with urllib.request.urlopen(request, timeout=2) as response:
        return json.load(response)


if __name__ == "__main__":
    result = api(sys.argv[1], sys.argv[2], json.loads(sys.argv[3]) if len(sys.argv) > 3 else None)
    print(json.dumps(result, ensure_ascii=False, indent=2))
