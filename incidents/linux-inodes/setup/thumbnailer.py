"""thumbnailer: сохраняет миниатюры для превью в /srv/media/cache (с прошлого релиза — в формате webp)."""
import os
import time

CACHE = "/srv/media/cache"
errors = 0
while True:
    name = os.path.join(CACHE, f"thumb-{time.time_ns()}.webp")
    try:
        with open(name, "wb"):
            pass
        errors = 0
    except OSError as e:
        errors += 1
        if errors in (1, 100) or errors % 1000 == 0:
            print(f"не удалось сохранить миниатюру: {e}", flush=True)
        time.sleep(0.5)
        continue
    time.sleep(0.1)
