"""partner-sync: партнёрский сервис раз в 5 секунд забирает заказы из API магазина по HTTPS.
Сертификаты проверяет по корневому CA компании (/etc/partner-sync/ca.pem) — без системного хранилища."""
import json
import ssl
import time
import urllib.request
from pathlib import Path

URL = "https://api.shop.example.test/orders"
STATE = Path("/run/partner-sync/state")
ctx = ssl.create_default_context(cafile="/etc/partner-sync/ca.pem")
last = ""
while True:
    try:
        with urllib.request.urlopen(URL, timeout=5, context=ctx) as r:
            orders = json.load(r).get("orders", [])
        message = f"ok: заказов {len(orders)}"
    except Exception as e:
        reason = getattr(e, "reason", e)
        message = f"error: {getattr(reason, 'verify_message', None) or reason}"
    STATE.write_text(f"{int(time.time())} {message}\n")
    if message != last:
        print(message, flush=True)
        last = message
    time.sleep(5)
