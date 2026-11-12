"""«Временный» дамп для отладки: забил раздел логов, файл удалили, а процесс его держит."""
import os
import time

path = "/var/log/api/debug.dump"
with open(path, "wb") as f:
    chunk = b"\0" * (1 << 20)
    try:
        while True:
            f.write(chunk)
            f.flush()
    except OSError:
        pass
    os.remove(path)
    open("/run/debug-dump.ready", "w").close()
    time.sleep(10 ** 9)
