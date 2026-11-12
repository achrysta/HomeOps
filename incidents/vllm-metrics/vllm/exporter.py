"""Имитация метрик vLLM (тот же формат и имена, что у vLLM v1 на /metrics).

Внутри — простая модель очереди: запросы приходят, занимают слоты батча (max_num_seqs),
лишние ждут в очереди. TTFT растёт вместе с очередью.

Нагрузка переключается, чтобы воспроизвести вчерашний вечер:
  GET  /admin/load                         — текущий режим
  POST /admin/load {"level": "overload"}   — перегрузка (очередь 25–40 запросов)
  POST /admin/load {"level": "normal"}     — обычная нагрузка
"""

from __future__ import annotations

import json
import math
import os
import random
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

MODEL = os.environ.get("MODEL_NAME", "Qwen/Qwen2.5-1.5B-Instruct")
PORT = int(os.environ.get("PORT", "8000"))
MAX_NUM_SEQS = 16
TTFT_BUCKETS = [0.001, 0.005, 0.01, 0.02, 0.04, 0.06, 0.08, 0.1, 0.25, 0.5, 0.75, 1.0, 2.5, 5.0, 7.5, 10.0, 20.0, 40.0, 80.0, 160.0, 640.0, 2560.0]
E2E_BUCKETS = [0.3, 0.5, 0.8, 1.0, 1.5, 2.0, 2.5, 5.0, 10.0, 15.0, 20.0, 30.0, 40.0, 50.0, 60.0, 120.0, 240.0, 480.0, 960.0, 1920.0, 7680.0]

lock = threading.Lock()
state = {"level": os.environ.get("START_LEVEL", "normal")}
gauges = {"running": 0.0, "waiting": 0.0, "kv": 0.0}
counters = {"prompt": 0.0, "generation": 0.0, "success": 0.0}


class Histogram:
    def __init__(self, buckets: list[float]):
        self.buckets = buckets
        self.counts = [0] * len(buckets)
        self.count = 0
        self.sum = 0.0

    def observe(self, v: float) -> None:
        for i, b in enumerate(self.buckets):
            if v <= b:
                self.counts[i] += 1
        self.count += 1
        self.sum += v

    def render(self, name: str, labels: str) -> list[str]:
        out = [f"# HELP {name} Histogram of {name.split(':')[1].replace('_', ' ')}.", f"# TYPE {name} histogram"]
        for b, c in zip(self.buckets, self.counts):
            out.append(f'{name}_bucket{{{labels},le="{b}"}} {c}')
        out.append(f'{name}_bucket{{{labels},le="+Inf"}} {self.count}')
        out.append(f"{name}_count{{{labels}}} {self.count}")
        out.append(f"{name}_sum{{{labels}}} {self.sum:.6f}")
        return out


ttft = Histogram(TTFT_BUCKETS)
e2e = Histogram(E2E_BUCKETS)


def simulate() -> None:
    """Каждые 0.5 с: пришедшие запросы, завершённые запросы, наблюдения TTFT/E2E."""
    rnd = random.Random(42)
    queue = 0.0
    while True:
        with lock:
            overload = state["level"] == "overload"
        target_queue = rnd.uniform(25, 40) if overload else rnd.uniform(0, 2)
        queue += (target_queue - queue) * 0.35
        running = MAX_NUM_SEQS if overload else rnd.uniform(3, 7)
        finished = rnd.randint(4, 7) if overload else rnd.randint(1, 3)
        with lock:
            gauges["running"] = round(running)
            gauges["waiting"] = max(0, round(queue))
            gauges["kv"] = rnd.uniform(0.94, 0.99) if overload else rnd.uniform(0.18, 0.4)
            for _ in range(finished):
                median = 1.6 + queue * 0.03 if overload else 0.17
                t = rnd.lognormvariate(math.log(median), 0.45)
                ttft.observe(t)
                e2e.observe(t + rnd.uniform(1.5, 4.0))
                counters["prompt"] += rnd.randint(200, 1500)
                counters["generation"] += rnd.randint(50, 400)
                counters["success"] += 1
        time.sleep(0.5)


def metrics() -> str:
    labels = f'model_name="{MODEL}"'
    with lock:
        lines = [
            "# HELP vllm:num_requests_running Number of requests in model execution batches.",
            "# TYPE vllm:num_requests_running gauge",
            f"vllm:num_requests_running{{{labels}}} {gauges['running']}",
            "# HELP vllm:num_requests_waiting Number of requests waiting to be processed.",
            "# TYPE vllm:num_requests_waiting gauge",
            f"vllm:num_requests_waiting{{{labels}}} {gauges['waiting']}",
            "# HELP vllm:kv_cache_usage_perc KV-cache usage. 1 means 100 percent usage.",
            "# TYPE vllm:kv_cache_usage_perc gauge",
            f"vllm:kv_cache_usage_perc{{{labels}}} {gauges['kv']:.4f}",
            "# HELP vllm:prompt_tokens_total Number of prefill tokens processed.",
            "# TYPE vllm:prompt_tokens_total counter",
            f"vllm:prompt_tokens_total{{{labels}}} {counters['prompt']}",
            "# HELP vllm:generation_tokens_total Number of generation tokens processed.",
            "# TYPE vllm:generation_tokens_total counter",
            f"vllm:generation_tokens_total{{{labels}}} {counters['generation']}",
            "# HELP vllm:request_success_total Count of successfully processed requests.",
            "# TYPE vllm:request_success_total counter",
            f'vllm:request_success_total{{{labels},finished_reason="stop"}} {counters["success"]}',
        ]
        lines += ttft.render("vllm:time_to_first_token_seconds", labels)
        lines += e2e.render("vllm:e2e_request_latency_seconds", labels)
    return "\n".join(lines) + "\n"


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def _send(self, status: int, body: bytes, ctype: str = "application/json") -> None:
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/metrics":
            self._send(200, metrics().encode(), "text/plain; version=0.0.4; charset=utf-8")
        elif self.path == "/health":
            self._send(200, b"")
        elif self.path == "/admin/load":
            with lock:
                self._send(200, json.dumps({"level": state["level"]}).encode())
        else:
            self._send(404, b'{"detail":"Not Found"}')

    def do_POST(self):
        if self.path != "/admin/load":
            self._send(404, b'{"detail":"Not Found"}')
            return
        try:
            level = json.loads(self.rfile.read(int(self.headers.get("Content-Length") or 0)) or b"{}").get("level")
        except json.JSONDecodeError:
            level = None
        if level not in ("normal", "overload"):
            self._send(400, b'{"error":"level: normal | overload"}')
            return
        with lock:
            state["level"] = level
        print(f"{time.strftime('%H:%M:%S')} load -> {level}", flush=True)
        self._send(200, json.dumps({"level": level}).encode())


if __name__ == "__main__":
    threading.Thread(target=simulate, daemon=True).start()
    print(f"vLLM metrics for {MODEL} on :{PORT}/metrics, load={state['level']}", flush=True)
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
