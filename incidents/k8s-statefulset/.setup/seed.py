"""Данные лидера до поломки: 40 счетов со случайными балансами. Контрольная сумма — в ConfigMap kv-seed:
по ней проверка видит, что данные не потеряны (сами значения нигде больше не хранятся)."""

import hashlib
import json
import random
import subprocess

data = {f"account-{i:03d}": f"{random.randint(1000, 999999) / 100:.2f}" for i in range(1, 41)}
post = f"""
import json, urllib.request
req = urllib.request.Request("http://localhost:8080/set", data={json.dumps(json.dumps(data))}.encode(), headers={{"Content-Type": "application/json"}})
print(urllib.request.urlopen(req, timeout=5).read().decode())
"""
subprocess.run(["kubectl", "-n", "ledger", "exec", "kv-0", "--", "python", "-c", post], check=True, capture_output=True)
sha = hashlib.sha256(json.dumps(data, sort_keys=True).encode()).hexdigest()
subprocess.run(["kubectl", "-n", "ledger", "create", "configmap", "kv-seed", f"--from-literal=sha256={sha}", f"--from-literal=keys={len(data)}"], check=True, capture_output=True)
print(f"лидер kv-0: записано {len(data)} ключей")
