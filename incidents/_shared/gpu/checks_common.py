"""Проверки реального runtime и HTTP inference. Только стандартные helpers incident_kit."""
import json
from pathlib import Path
import incident_kit as kit
from incident_kit import RequestError, fail, get, post, wait_for


def runtime():
    # Файл уже мог измениться, пока контроллер завершает предыдущий процесс.
    # Старое зелёное состояние не подтверждает новую конфигурацию.
    desired = json.loads(Path('/scenario/config/runtime.json').read_text())
    def probe():
        try:
            response = get('http://model:8001/runtime', timeout=5)
            if response.status != 200:
                return None
            data = response.json()
            return data if data.get('config') == desired else None
        except RequestError:
            return None
    data = wait_for(probe, timeout=45, interval=1)
    if not data:
        fail('Runtime не подтвердил текущую конфигурацию; прежнее состояние не учитывается.')
    return data


def visible():
    def probe():
        data = runtime()
        return data if 'nvml' in data or data.get('exit_code') is not None else None
    data = wait_for(probe, timeout=45, interval=1) or {}
    if not data.get('nvml'):
        fail('NVML не видит NVIDIA-устройство в контейнере модели.')
    return 'NVIDIA-устройство доступно внутри контейнера через NVML.'


def rank():
    data = runtime()
    required = data.get('adapter', {}).get('rank', 32)
    limit = data.get('config', {}).get('max_lora_rank', 0)
    if limit < required:
        fail(f'Rank адаптера {required} превышает поддерживаемый runtime предел {limit}.')
    return f'Runtime поддерживает rank {required}.'


def gpu():
    def probe():
        try:
            data = runtime()
            return data if data.get('compute_ok') or data.get('exit_code') is not None else None
        except RequestError:
            return None
    data = wait_for(probe, timeout=45, interval=1) or {}
    if not data.get('cuda') or not data.get('compute_ok'):
        fail('В контейнере модели нет подтверждённого CUDA compute; CPU fallback не выполняет условие.')
    return f'CUDA-операция выполнена на {data.get("device", "NVIDIA GPU")}.'


def ready():
    def probe():
        state = runtime()
        if state.get('exit_code') is not None:
            return state
        try:
            response = get('http://model:8000/health', timeout=3)
            return state if response.status == 200 else None
        except RequestError:
            return None
    state = wait_for(probe, timeout=180, interval=3)
    # wait_for повторяет CheckFailed: код завершения проверяем после выхода из опроса.
    if state and state.get('exit_code') is not None:
        fail(f'Процесс inference завершился: code={state["exit_code"]}; модель не готова.')
    if not state:
        if kit.LIVE:
            fail('Модель пока не ready; HTTP health не подтвердил готовность.')
        fail('Модель не стала ready за три минуты. Холодный кэш сначала подготовьте отдельно.')
    return 'Модель ready; HTTP health возвращает 200.'


def inference():
    response = post('http://gateway:8080/v1/chat/completions', {
        'messages': [{'role': 'user', 'content': 'Reply with a short hello.'}],
        'max_tokens': 16, 'temperature': 0, 'stream': False,
    }, timeout=60)
    if response.status != 200:
        fail(f'Запрос через gateway не обслуживается: HTTP {response.status}.')
    result = response.json()
    choices = result.get('choices', [])
    if not choices or not choices[0].get('message', {}).get('content', '').strip():
        fail('Inference ответ не содержит сгенерированного текста.')
    return 'Gateway вернул реальный сгенерированный ответ.'


def adapter():
    data = runtime()
    manifest = data.get('adapter', {})
    config = data.get('config', {})
    if manifest.get('base') != config.get('model') or manifest.get('revision') != config.get('revision'):
        fail('Адаптер и загруженная база имеют разные идентичности.')
    response = post('http://model:8000/v1/chat/completions', {
        'model': 'tickets-adapter', 'messages': [{'role': 'user', 'content': 'Reply with a short hello.'}],
        'max_tokens': 16, 'temperature': 0, 'stream': False,
    }, timeout=60)
    if response.status != 200:
        fail(f'Запрос к adapter model не обслуживается: HTTP {response.status}.')
    result = response.json()
    choices = result.get('choices') or []
    if result.get('model') != 'tickets-adapter' or not choices or not choices[0].get('message', {}).get('content', '').strip():
        fail('Ожидается inference именно зарегистрированного адаптера, без молчаливого ухода на базу.')
    return 'Адаптер совместим с базой и реально обслужил запрос.'


def constraints():
    data = runtime()
    policy = json.loads(Path('/scenario/.original/policy.json').read_text())
    config = data.get('config', {})
    if config.get('model') != policy['model'] or config.get('revision') != policy['revision']:
        fail('Идентичность базовой модели изменена: условие требует исходные веса/revision.')
    if config.get('max_model_len') != 8192 or config.get('max_num_seqs') != 2:
        fail('Не соблюдён контракт: контекст 8192 и лимит двух активных последовательностей.')
    if not 0 < config.get('gpu_memory_utilization', 0) <= policy['max_gpu_util']:
        fail('GPU-бюджет превышает разрешённый потолок сценария.')
    if policy.get('adapter_required') and (not config.get('enable_lora') or config.get('adapter') == 'none'):
        fail('Адаптер отключён; обслуживание только базы не выполняет условие.')
    return 'База, CUDA-serving и ограничения нагрузки сохранены.'
