"""search-index: при старте прогревает кэш индекса (CACHE_MB из /etc/search-index/config), потом отвечает на /health."""
import http.server
import json
import os
import time

cache_mb = int(os.environ.get("CACHE_MB", "64"))
cache = []
print(f"search-index: прогреваю кэш индекса на {cache_mb} МБ", flush=True)
for _ in range(0, cache_mb, 8):
    cache.append(bytearray(os.urandom(1024)) * (8 * 1024))  # 8 МБ реальных страниц памяти
    time.sleep(0.4)
print(f"search-index: кэш готов ({cache_mb} МБ), слушаю :8085", flush=True)


class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        body = json.dumps({"status": "ok", "cache_mb": cache_mb}).encode()
        self.send_response(200 if self.path == "/health" else 404)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass


http.server.ThreadingHTTPServer(("127.0.0.1", 8085), Handler).serve_forever()
