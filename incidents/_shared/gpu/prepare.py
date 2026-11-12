"""Подготовка неизменных ungated weights перед GPU-прогоном; не использует CUDA."""
import hashlib
import json
from pathlib import Path
from huggingface_hub import snapshot_download

MODELS = {
    'Qwen/Qwen2.5-0.5B-Instruct': '7ae557604adf67be50417f59c2c2f167def9a775',
    'Qwen/Qwen2.5-3B-Instruct': 'aa8e72537993ba99e69dfaafa59ed015b17504d1',
}


def digest(path):
    h = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(4 * 1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


if __name__ == '__main__':
    for model, revision in MODELS.items():
        root = Path('/models') / model.split('/')[-1]
        snapshot_download(model, revision=revision, local_dir=str(root), allow_patterns=['*.safetensors', '*.json', '*.txt', '*.jinja'])
        files = {str(p.relative_to(root)): digest(p) for p in sorted(root.iterdir()) if p.is_file() and p.name != 'homeops-manifest.json'}
        (root / 'homeops-manifest.json').write_text(json.dumps({'model': model, 'revision': revision, 'files': files}, indent=2))
        print(f'{model}@{revision}: {len(files)} files, SHA-256 записаны', flush=True)
