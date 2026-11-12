import json
import os
import urllib.parse
import urllib.request


def api(method, endpoint, fields=None):
    url = os.environ.get("MLFLOW_URL", "http://mlflow:5000") + "/api/2.0/mlflow/" + endpoint
    data = None
    if method == "GET":
        url += "?" + urllib.parse.urlencode(fields or {})
    else:
        data = json.dumps(fields or {}).encode()
    request = urllib.request.Request(url, data=data, method=method, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(request, timeout=2) as response:
        return json.load(response)
