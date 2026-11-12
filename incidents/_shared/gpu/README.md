# CUDA-стенды: NVIDIA 8 ГБ и WSL2

Это реальные vLLM/CUDA workloads. Mac без NVIDIA не запускает их; HomeOps показывает причину, автопрогон пишет `skipped`/`hardware`. 25 стадий broken/partial/fixed/bypass подтверждены на Windows/WSL2 с RTX 4060; условия и результаты — в [WINDOWS.md](../../../WINDOWS.md).

Базы/revisions и working inference profiles взяты из [справочника моделей](../../../scripts/models/README.md): 3B BF16 / 0.85 / 8K / 2 и 0.5B BF16 / 0.35 / 8K. Synthetic LoRA rank 32 на 0.5B / 0.35 / 8K / 2 проверен физически (2952 МиБ, короткий TTFT 108 мс); synthetic adapters проверяют loader, не являются обученными артефактами.

## Подготовка на Windows

В терминале WSL, из корня проекта:

```sh
git pull --ff-only origin main
mkdir -p incidents/_shared/gpu/models
docker pull nvidia/cuda:12.8.1-base-ubuntu24.04
docker run --rm --gpus all nvidia/cuda:12.8.1-base-ubuntu24.04 nvidia-smi
DASHBOARD_URL=off docker compose -f incidents/gpu-vllm-budget/compose.yaml build model verify
DASHBOARD_URL=off docker compose -f incidents/gpu-vllm-budget/compose.yaml run --rm prepare
```

`prepare` получает два ungated Qwen по закреплённым revisions, сохраняет SHA-256 и manifest в cache. Serving работает с локальными файлами и offline env. Cache не входит в Git. Предусмотрите диск для vLLM image (~32 ГБ), weights (~7 ГБ) и тестовой копии cache; cold downloads выполняются до пяти минутного лимита автопрогона. Bind-каталог создаётся пользователем, а не Docker от root.

На одной видеокарте запускайте один GPU-стенд за раз. Посторонние GPU-нагрузки меняют CUDA free и могут воспроизвести другой отказ. Не жмите «Проверить» HomeOps при QA — он всегда пересылает результат в настоящее хранилище.

## Прогоны

Из папки выбранного стенда: `DASHBOARD_URL=off docker compose up -d`, затем `docker compose run --rm -e DASHBOARD_URL=off verify`. Все id/ожидания этапов находятся в `scripts/gpuCases.ts`. Обычные шаги правят `config/runtime.json` / `config/gateway.json`; контроллер применяет runtime.json перезапуском процесса. Изменения GPU passthrough/environment требуют `docker compose up -d --force-recreate model gateway`.

Проверки используют tensor-операцию CUDA, реальный process/health/inference и ограничения исходной базы. Диагностический `/runtime` не принимает команд. Живой `check` через сервис стендов запускает только фиксированный `verify --live` с `DASHBOARD_URL=off`: читает runtime/health и ограничения, без ожидания и генерации; запросы base/adapter остаются в полном автопрогоне. `gpu-container` отдельно различает NVML visibility и CUDA compute; `gpu-lora` проверяет rank, base revision и запрос adapter model без fallback.

Автоматически, из корня проекта:

```sh
docker compose --profile tools run --rm --build incident-regression gpu-vllm-budget gpu-kv-cache gpu-container gpu-lora
```

Прогон использует только копии и проект `homeops-regression`, `DASHBOARD_URL=off`. На Mac четыре случая будут skipped; это не подтверждение физических стадий.

После ручного теста: `docker compose run --rm -e DASHBOARD_URL=off reset` и `docker compose down -v --remove-orphans`. `config/` восстанавливается точно через `.original/.exact`; для gpu-container passthrough/environment возвращаются к исходному compose. Cache и исходные образы сохраняются; контейнеры, adapters/scratch volumes и сети стенда удаляются.
