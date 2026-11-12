"""price-sync: синхронизирует цены с поставщиком. Уровень логирования — LOG_LEVEL из /etc/default/price-sync."""
import os
import time

debug = os.environ.get("LOG_LEVEL", "info").lower() == "debug"
i = 0
while True:
    i += 1
    if debug:
        print(f"DEBUG price-sync: fetched item={i} payload={os.urandom(800).hex()}", flush=True)
        time.sleep(0.001)
    else:
        if i % 50 == 0:
            print(f"price-sync: synced {i} items", flush=True)
        time.sleep(0.1)
