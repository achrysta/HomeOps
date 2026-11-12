"""Контроллер реального vLLM/CUDA. Конфиг фиксируется при запуске, shell не используется.

Диагностический HTTP-порт ничего не запускает и не принимает команд. Synthetic LoRA
fixtures проверяют loader/serving, а не изображают обучение или улучшение качества.
"""
import json
import hashlib
import os
import re
import signal
import subprocess
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

CONFIG = Path('/scenario/config/runtime.json')
STATE = {'cuda': False, 'compute_ok': False, 'process_running': False, 'exit_code': None}
ALLOWED_MODELS = {'Qwen/Qwen2.5-3B-Instruct', 'Qwen/Qwen2.5-0.5B-Instruct'}


def local_model(model_id, revision):
    root = Path('/models') / model_id.split('/')[-1]
    manifest = json.loads((root / 'homeops-manifest.json').read_text())
    if manifest.get('model') != model_id or manifest.get('revision') != revision:
        raise ValueError('Cache manifest не соответствует base model/revision')
    if not manifest.get('files') or not any(name.endswith('.safetensors') for name in manifest['files']):
        raise ValueError('В проверенном cache нет model weights')
    for name, expected in manifest['files'].items():
        target = (root / name).resolve()
        if not target.is_relative_to(root.resolve()):
            raise ValueError('Путь cache manifest вне model root')
        h = hashlib.sha256()
        with target.open('rb') as stream:
            for block in iter(lambda: stream.read(4 * 1024 * 1024), b''):
                h.update(block)
        if h.hexdigest() != expected:
            raise ValueError(f'Checksum изменился: {name}')
    return root


def make_adapter(root, model_id, revision, rank):
    import torch
    from safetensors.torch import save_file
    from transformers import AutoConfig
    config = AutoConfig.from_pretrained(str(local_model(model_id, revision)), local_files_only=True)
    tensors = {}
    generator = torch.Generator().manual_seed(1042)
    head_dim = getattr(config, 'head_dim', None) or config.hidden_size // config.num_attention_heads
    for layer in range(config.num_hidden_layers):
        for name, out_size in [('q_proj', config.hidden_size), ('v_proj', config.num_key_value_heads * head_dim)]:
            prefix = f'base_model.model.model.layers.{layer}.self_attn.{name}'
            tensors[f'{prefix}.lora_A.weight'] = torch.randn(rank, config.hidden_size, generator=generator, dtype=torch.float32).mul_(0.01).half()
            tensors[f'{prefix}.lora_B.weight'] = torch.randn(out_size, rank, generator=generator, dtype=torch.float32).mul_(0.001).half()
    root.mkdir(parents=True, exist_ok=True)
    save_file(tensors, str(root / 'adapter_model.safetensors'))
    (root / 'adapter_config.json').write_text(json.dumps({
        'base_model_name_or_path': model_id, 'revision': revision, 'peft_type': 'LORA',
        'task_type': 'CAUSAL_LM', 'r': rank, 'lora_alpha': rank * 2, 'lora_dropout': 0,
        'target_modules': ['q_proj', 'v_proj'], 'bias': 'none', 'inference_mode': True,
    }))


def launch():
    try:
        config = json.loads(CONFIG.read_text())
        if config.get('model') not in ALLOWED_MODELS:
            raise ValueError('Model не входит в фиксированный список стенда')
        if not re.fullmatch(r'[0-9a-f]{40}', str(config.get('revision', ''))):
            raise ValueError('Нужен закреплённый revision базовой модели')
        if config.get('adapter', 'none') not in ('none', 'wrong', 'correct'):
            raise ValueError('Неизвестный synthetic adapter fixture')
        if not isinstance(config.get('enable_lora'), bool):
            raise ValueError('enable_lora должен быть boolean')
        for key in ('max_model_len', 'max_num_seqs', 'max_lora_rank'):
            if not isinstance(config.get(key), int) or isinstance(config[key], bool) or config[key] <= 0:
                raise ValueError(f'Некорректный положительный integer: {key}')
        util = config.get('gpu_memory_utilization')
        if not isinstance(util, (int, float)) or isinstance(util, bool) or not 0 < util <= 1:
            raise ValueError('Некорректный GPU memory budget')
        STATE['config'] = config
        # Отдельный процесс освобождает CUDA context до стартовой проверки памяти vLLM.
        # Контроллер не держит собственные CUDA tensors рядом с inference engine.
        info = subprocess.run(['nvidia-smi', '--query-gpu=name', '--format=csv,noheader'], capture_output=True, text=True, timeout=10)
        STATE['nvml'] = info.returncode == 0 and bool(info.stdout.strip())
        probe = subprocess.run([sys.executable, '-c',
            'import json,torch; ok=torch.cuda.is_available(); '
            'x=torch.ones(2,device="cuda").sum().item() if ok else None; '
            'm=torch.cuda.mem_get_info() if ok else (0,0); '
            'print(json.dumps({"cuda":ok,"compute_ok":x==2,"device":torch.cuda.get_device_name(0) if ok else "", "cuda_free_bytes":m[0],"cuda_total_bytes":m[1]}))'],
            capture_output=True, text=True, timeout=20)
        if probe.returncode != 0:
            raise RuntimeError('CUDA-проба не выполнила tensor-операцию')
        STATE.update(json.loads(probe.stdout.strip().splitlines()[-1]))
        if not STATE['cuda']:
            raise RuntimeError('CUDA compute недоступен в этом контейнере; CPU fallback запрещён')
        model_root = local_model(config['model'], config['revision'])
        adapter = config.get('adapter', 'none')
        if adapter != 'none':
            # Неверная база имеет другие tensor shapes. Metadata одного имени недостаточно.
            correct = adapter == 'correct'
            model_id = 'Qwen/Qwen2.5-0.5B-Instruct' if correct else 'Qwen/Qwen2.5-3B-Instruct'
            revision = '7ae557604adf67be50417f59c2c2f167def9a775' if correct else 'aa8e72537993ba99e69dfaafa59ed015b17504d1'
            root = Path('/adapters') / adapter
            make_adapter(root, model_id, revision, 32)
            STATE['adapter'] = {'name': 'tickets-adapter', 'base': model_id, 'revision': revision, 'rank': 32, 'fixture': True}
        args = [
            sys.executable, '-m', 'vllm.entrypoints.openai.api_server',
            '--host', '0.0.0.0', '--port', '8000', '--model', str(model_root),
            '--revision', config['revision'], '--served-model-name', 'tickets-base',
            '--download-dir', '/cache/hf', '--dtype', 'bfloat16', '--enforce-eager',
            '--max-num-batched-tokens', '512',
            '--gpu-memory-utilization', str(util), '--max-model-len', str(config['max_model_len']),
            '--max-num-seqs', str(config['max_num_seqs']),
        ]
        if config.get('enable_lora'):
            args += ['--enable-lora', '--max-loras', '2', '--max-lora-rank', str(config['max_lora_rank'])]
            if adapter != 'none': args += ['--lora-modules', f'tickets-adapter=/adapters/{adapter}']
        STATE['args'] = args
        child = subprocess.Popen(args, start_new_session=True)
        STATE['process_running'] = True
        return child
    except Exception as error:
        STATE['error'] = str(error)
        STATE['exit_code'] = 1
        print(f'GPU stand: {error}', flush=True)
        return None


def supervise():
    child = None
    previous = None
    while True:
        try:
            current = CONFIG.read_bytes()
            if current != previous:
                if child and child.poll() is None:
                    os.killpg(child.pid, signal.SIGTERM)
                    try:
                        child.wait(timeout=20)
                    except subprocess.TimeoutExpired:
                        os.killpg(child.pid, signal.SIGKILL)
                        child.wait()
                previous = current
                STATE.clear()
                STATE.update({'cuda': False, 'compute_ok': False, 'process_running': False, 'exit_code': None})
                child = launch()
            if child and child.poll() is not None:
                STATE['exit_code'] = child.returncode
                STATE['process_running'] = False
        except OSError as error:
            STATE['error'] = str(error)
        time.sleep(2)


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path != '/runtime':
            self.send_error(404)
            return
        payload = json.dumps(STATE.copy()).encode()
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)


if __name__ == '__main__':
    threading.Thread(target=supervise, daemon=True).start()
    ThreadingHTTPServer(('0.0.0.0', 8001), Handler).serve_forever()
