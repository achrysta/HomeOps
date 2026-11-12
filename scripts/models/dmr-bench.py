"""Замер Docker Model Runner: TTFT, скорость генерации и пропускная способность.

Запуск: docker run --rm -v "$PWD/scripts/models:/b:ro" python:3.12-alpine python /b/dmr-bench.py <модель>
"""
import json
import statistics
import sys
import threading
import time
import urllib.request

URL = 'http://model-runner.docker.internal/engines/v1/chat/completions'
MODEL = sys.argv[1]
MAX_TOKENS = 128
# В исходном замере197 токенов промпта: короткий запрос к поддержке, как в лабораторных gateway
PROMPT = (
    'Ты — ассистент поддержки интернет-магазина. Клиент пишет: «Заказ 48213 оформлен три дня назад, '
    'статус всё ещё "Собирается", а курьер обещал доставку вчера. Я плачу за срочную доставку и хочу понять, '
    'что происходит, когда привезут и вернут ли деньги за срочность». Ответь клиенту вежливо и по делу: '
    'объясни возможные причины задержки, что ты проверишь, какие сроки реалистичны и как оформить возврат '
    'платы за срочную доставку. Не обещай того, чего не можешь гарантировать.'
)


def one(results: list, idx: int) -> None:
    body = json.dumps({
        'model': MODEL,
        'messages': [{'role': 'user', 'content': PROMPT}],
        'max_tokens': MAX_TOKENS,
        'temperature': 0,
        'stream': True,
        'stream_options': {'include_usage': True},
    }).encode()
    req = urllib.request.Request(URL, data=body, headers={'Content-Type': 'application/json'})
    start = time.perf_counter()
    first = None
    usage = {}
    with urllib.request.urlopen(req, timeout=300) as resp:
        for raw in resp:
            line = raw.decode().strip()
            if not line.startswith('data:') or line == 'data: [DONE]':
                continue
            chunk = json.loads(line[5:])
            if chunk.get('usage'):
                usage = chunk['usage']
            choices = chunk.get('choices') or []
            if first is None and choices and choices[0].get('delta', {}).get('content'):
                first = time.perf_counter()
    end = time.perf_counter()
    out = usage.get('completion_tokens', 0)
    results[idx] = {
        'ttft_ms': (first - start) * 1000 if first else None,
        'decode_tps': (out - 1) / (end - first) if first and out > 1 else None,
        'prompt_tokens': usage.get('prompt_tokens'),
        'completion_tokens': out,
        'total_s': end - start,
    }


def batch(n: int) -> tuple[list, float]:
    results: list = [None] * n
    threads = [threading.Thread(target=one, args=(results, i)) for i in range(n)]
    t0 = time.perf_counter()
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    return results, time.perf_counter() - t0


# Прогрев: первая загрузка модели в память не должна попасть в TTFT
t0 = time.perf_counter()
batch(1)
print(f'прогрев (загрузка модели): {time.perf_counter() - t0:.1f} с')

seq = [batch(1)[0][0] for _ in range(5)]
ttft = [r['ttft_ms'] for r in seq]
tps = [r['decode_tps'] for r in seq]
print(f'промпт: {seq[0]["prompt_tokens"]} токенов, ответ: до {MAX_TOKENS} токенов')
print(f'последовательно, 5 запросов: TTFT медиана {statistics.median(ttft):.0f} мс (мин {min(ttft):.0f}, макс {max(ttft):.0f}); '
      f'генерация медиана {statistics.median(tps):.1f} ток/с')

for n in (4,):
    res, wall = batch(n)
    total_out = sum(r['completion_tokens'] for r in res)
    print(f'параллельно {n}: TTFT медиана {statistics.median(r["ttft_ms"] for r in res):.0f} мс, '
          f'на запрос {statistics.median(r["decode_tps"] for r in res):.1f} ток/с, '
          f'всего {total_out / wall:.1f} ток/с за {wall:.1f} с')
