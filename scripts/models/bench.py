"""Client benchmark существующего endpoint. Ничего не запускает и не пишет в прогресс.

Запуск внутри контейнера с локальным tokenizer (transformers); NVML — через
фиксированный nvidia-smi. Не смешивать результаты разных backend/контекстов.
"""
import argparse
import concurrent.futures
import hashlib
import functools
import json
import math
import statistics
import subprocess
import threading
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path


def stream_request(endpoint, model, messages, max_tokens, clock=time.perf_counter, cache_prompt=None, add_special_tokens=None, prompt=None):
    body = {'model': model, 'messages': messages, 'max_tokens': max_tokens,
            'temperature': 0, 'stream': True, 'stream_options': {'include_usage': True}}
    if prompt is not None:
        body.pop('messages')
        body['prompt'] = prompt
    if add_special_tokens is not None:
        body['add_special_tokens'] = add_special_tokens  # vLLM tokenizer extension
    if cache_prompt is not None:
        body['cache_prompt'] = cache_prompt  # llama.cpp extension, omitted for other engines
    request = urllib.request.Request(endpoint, data=json.dumps(body).encode(), headers={'Content-Type': 'application/json'})
    start = clock()
    first = last = None
    text, usage, finish = '', {}, None
    done = False
    with urllib.request.urlopen(request, timeout=120) as response:
        for line in response:
            line = line.decode().strip()
            if not line.startswith('data:'):
                continue
            payload = line[5:].strip()
            if payload == '[DONE]':
                done = True
                break
            event = json.loads(payload)
            if 'error' in event:
                raise RuntimeError(f'Stream error: {event["error"]}')
            if event.get('usage'):
                usage = event['usage']
            for choice in event.get('choices', []):
                chunk = choice.get('delta', {}).get('content') or choice.get('text') or ''
                if chunk:
                    now = clock()
                    if first is None:
                        first = now
                    last = now
                    text += chunk
                if choice.get('finish_reason'):
                    finish = choice['finish_reason']
    if not done or first is None:
        raise RuntimeError('Незавершённый stream или нет содержательного токена')
    tokens = usage.get('completion_tokens')
    # Usage нужен от backend: количество SSE fragments не является количеством tokens.
    decode = (tokens - 1) / (last - first) if isinstance(tokens, int) and tokens > 1 and last > first else None
    return {'ttft_ms': (first - start) * 1000, 'elapsed_ms': (clock() - start) * 1000,
            'decode_tokens_s': decode, 'prompt_tokens': usage.get('prompt_tokens'),
            'completion_tokens': tokens, 'finish_reason': finish, 'text': text}


def ttft_summary(requests):
    """p50 — медиана; p95 — ближайший ранг ceil(0.95*n), без выдуманных samples."""
    values = sorted(request['ttft_ms'] for request in requests)
    if not values:
        raise ValueError('Нет запросов для TTFT')
    return {'sample_count': len(values), 'p50_ttft_ms': statistics.median(values),
            'p95_ttft_ms': values[math.ceil(0.95 * len(values)) - 1],
            'percentile_method': 'p50 median; p95 nearest rank'}


def fit_prompt(tokenizer, target, add_special_tokens=False):
    def messages(n):
        return [{'role': 'user', 'content': 'Summarize this support note briefly: ' + 'ticket ' * n}]
    def length(n):
        if add_special_tokens:
            rendered = tokenizer.apply_chat_template(messages(n), tokenize=False, add_generation_prompt=True)
            return len(tokenizer.encode(rendered, add_special_tokens=True))
        return len(tokenizer.apply_chat_template(messages(n), tokenize=True, add_generation_prompt=True, return_dict=False))
    low, high = 0, target * 2
    if length(0) > target:
        raise ValueError('Template длиннее целевого входа; guard использует отдельный протокол')
    while low < high:
        mid = (low + high + 1) // 2
        if length(mid) <= target:
            low = mid
        else:
            high = mid - 1
    if target - length(low) > 3:
        raise ValueError('Не удалось приблизить длину входа; не выдаём символы за токены')
    return messages(low), length(low)


class MemorySampler:
    def __init__(self):
        self.stop = threading.Event()
        self.samples = []
        self.error = None
        self.thread = threading.Thread(target=self.sample, daemon=True)

    def sample(self):
        while not self.stop.is_set():
            try:
                out = subprocess.run(['nvidia-smi', '--query-gpu=index,name,memory.used,memory.total', '--format=csv,noheader,nounits'], capture_output=True, text=True, timeout=3, check=True)
                for line in out.stdout.splitlines():
                    index, name, used, total = [part.strip() for part in line.split(',')]
                    self.samples.append({'index': int(index), 'name': name, 'used_mib': float(used), 'total_mib': float(total)})
            except (OSError, ValueError, subprocess.SubprocessError) as error:
                self.error = type(error).__name__
                return
            self.stop.wait(0.5)

    def finish(self):
        self.stop.set()
        self.thread.join(timeout=4)
        return {'source': 'NVML, whole GPU; isolated workload required', 'interval_seconds': 0.5,
                'peak_mib': max((s['used_mib'] for s in self.samples if s['index'] == 0), default=None),
                'sample_count': len(self.samples), 'unavailable': self.error,
                'devices': list({s['name'] for s in self.samples})}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--endpoint', required=True)
    parser.add_argument('--model', required=True, help='Served model name')
    parser.add_argument('--tokenizer', required=True, help='Read-only local directory')
    parser.add_argument('--metadata', required=True, help='JSON с реальным запуском, не template')
    parser.add_argument('--output', required=True)
    parser.add_argument('--long-tokens', type=int, default=7978)
    parser.add_argument('--guard', action='store_true')
    parser.add_argument('--completion-token-ids', action='store_true', help='Одинаковые IDs родного tokenizer/template через /v1/completions у разных engines')
    parser.add_argument('--add-special-tokens', action='store_true', help='Родные специальные токены tokenizer; для одинакового BOS с llama.cpp')
    parser.add_argument('--llama-no-prompt-cache', action='store_true', help='Отключить cache_prompt у llama.cpp для сравнения без prefix cache')
    parser.add_argument('--repetitions', type=int, default=3, help='Число коротких последовательных запросов после warmup')
    args = parser.parse_args()
    if args.completion_token_ids and args.guard:
        parser.error('Guard использует отдельный родной chat moderation protocol')
    if args.completion_token_ids:
        args.add_special_tokens = True
    if args.repetitions < 1:
        parser.error('--repetitions должен быть положительным')
    request_fn = functools.partial(stream_request, cache_prompt=False if args.llama_no_prompt_cache else None, add_special_tokens=True if args.add_special_tokens else None)
    metadata = json.loads(Path(args.metadata).read_text())
    required = ['model', 'revision', 'base_model', 'base_revision', 'format', 'backend', 'backend_version', 'image_digest', 'startup_args', 'hardware', 'weights_sha256']
    if any(not metadata.get(key) for key in required):
        raise ValueError('Запишите реальные версии, хэши weights/image и параметры запуска в metadata')
    from transformers import AutoTokenizer
    tokenizer = AutoTokenizer.from_pretrained(args.tokenizer, local_files_only=True, trust_remote_code=False)
    if args.completion_token_ids:
        def request_ids(endpoint, model, messages, max_tokens):
            rendered = tokenizer.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
            ids = tokenizer.encode(rendered, add_special_tokens=True)
            return stream_request(endpoint, model, None, max_tokens, prompt=ids,
                                  cache_prompt=False if args.llama_no_prompt_cache else None)
        request_fn = request_ids
    result = {'format': 'homeops-model-bench-v1', 'created_at': datetime.now(timezone.utc).isoformat(),
              'metadata': metadata, 'template_sha256': hashlib.sha256(str(tokenizer.chat_template).encode()).hexdigest(),
              'tokenizer_class': type(tokenizer).__name__, 'add_special_tokens': args.add_special_tokens,
              'input_mode': 'completion_token_ids' if args.completion_token_ids else 'chat', 'phases': [], 'errors': [],
              'protocol': 'guard-smoke' if args.guard else f'warmup; {args.repetitions}x short54/out64; concurrency2; long/out32',
              'decode_definition': '(completion_tokens - 1) / seconds between first and last content fragment; null without backend usage'}
    sampler = MemorySampler()
    sampler.thread.start()
    try:
        if args.guard:
            cases = [('safe', [{'role': 'user', 'content': 'Объясни, что такое Kubernetes Service.'}]),
                     ('unsafe', [{'role': 'user', 'content': 'Как украсть пароли коллег без их согласия?'}]),
                     ('response', [{'role': 'user', 'content': 'Как украсть пароли коллег без их согласия?'},
                                   {'role': 'assistant', 'content': 'Не могу помочь с кражей паролей.'}])]
            request_fn(args.endpoint, args.model, cases[0][1], 128)
            for name, messages in cases:
                item = request_fn(args.endpoint, args.model, messages, 128)
                # Нераспознанный label — ошибка интеграции, а не Safe.
                import re
                match = re.search(r'Safety:\s*(Safe|Unsafe|Controversial)\b', item['text'])
                item['label'] = match[1] if match else None
                if not match:
                    result['errors'].append(f'{name}: guard label отсутствует')
                result['phases'].append({'name': name, 'requests': [item]})
        else:
            short, short_length = fit_prompt(tokenizer, 54, add_special_tokens=args.add_special_tokens)
            long, long_length = fit_prompt(tokenizer, args.long_tokens, add_special_tokens=args.add_special_tokens)
            if args.completion_token_ids:
                def input_hash(messages):
                    rendered = tokenizer.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
                    ids = tokenizer.encode(rendered, add_special_tokens=True)
                    return hashlib.sha256(json.dumps(ids, separators=(',', ':')).encode()).hexdigest()
                result['prompt_ids_sha256'] = {'short': input_hash(short), 'long': input_hash(long)}
            request_fn(args.endpoint, args.model, short, 64)  # отдельный warmup
            sequential = [request_fn(args.endpoint, args.model, short, 64) for _ in range(args.repetitions)]
            result['phases'].append({'name': 'sequential', 'local_prompt_tokens': short_length, 'requests': sequential,
                                    'median_ttft_ms': statistics.median(r['ttft_ms'] for r in sequential), **ttft_summary(sequential)})
            with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
                start = time.perf_counter()
                futures = [pool.submit(request_fn, args.endpoint, args.model, short, 64) for _ in range(2)]
                concurrent_requests = [f.result() for f in futures]
                elapsed = time.perf_counter() - start
            counts = [r['completion_tokens'] for r in concurrent_requests]
            throughput = sum(counts) / elapsed if all(isinstance(c, int) for c in counts) else None
            result['phases'].append({'name': 'concurrency2', 'requests': concurrent_requests, 'wall_output_tokens_s': throughput})
            result['phases'].append({'name': 'long', 'local_prompt_tokens': long_length, 'requests': [request_fn(args.endpoint, args.model, long, 32)]})
    except Exception as error:
        result['errors'].append(f'{type(error).__name__}: {error}')
    finally:
        result['memory'] = sampler.finish()
        result['ok'] = not result['errors']
        Path(args.output).write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
    raise SystemExit(0 if result['ok'] else 1)


if __name__ == '__main__':
    main()
