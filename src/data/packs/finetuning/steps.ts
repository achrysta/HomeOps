import type { LabStepCheck } from '../../labSteps'

export const steps: Record<string, string[]> = {
  'J1.1': [
    'В `ai-platform-labs/finetuning/` создайте `data/`, `configs/`, `src/`, `adapters/`, `reports/` и Docker Compose CPU-сервис `train-cpu`. Закрепите версии torch, transformers, peft, trl, datasets и mlflow в lock-файле; зависимости устанавливаются при сборке, не в каждом запуске.',
    'Подготовьте свой небольшой учебный JSONL с `messages`: задача — классификация синтетических DevOps-тикетов в JSON. Не используйте личные данные и golden dataset трека F как train. `docker compose run --rm train-cpu python -m finetuning.validate data/` проверяет роли, пустые ответы, дубли и пересечения split по источникам; сохраните отчёт и SHA-256.',
    'Создайте `configs/cpu-lora.json`: база `Qwen/Qwen2.5-0.5B-Instruct` с закреплённым revision, float32, CPU, обычная LoRA (без NF4/bitsandbytes), r=4, alpha=8, q_proj/v_proj, длина 128, micro-batch 1, 8–16 шагов. Подтвердите список обучаемых параметров и отсутствие градиентов у базовых весов.',
    'В `src/finetuning/train.py` используйте PEFT и SFTTrainer: примените chat template базы, проверьте, какие токены участвуют в loss; не добавляйте special tokens повторно. `docker compose run --rm train-cpu python -m finetuning.train --config configs/cpu-lora.json` выполняет небольшой запуск, пишет параметры/метрики в MLflow из B2 и сохраняет PEFT config + adapter weights.',
    'Отдельным процессом выполните `docker compose run --rm train-cpu python -m finetuning.smoke --adapter adapters/cpu --device cpu`. Загрузите ту же базу и tokenizer, затем адаптер, выполните inference на отложенном запросе. Один удачный ответ не доказывает рост качества; полноценный eval — J3.',
    'Приложите коммит с валидатором/lock-файлом, MLflow run id, хэши train/validation и отчёт загрузки адаптера. CPU-путь подтверждает LoRA и lifecycle, но не QLoRA/CUDA или multi-LoRA vLLM.',
  ],
  J2: [
    'На Windows в WSL создайте в `ai-platform-labs/finetuning/` Compose-сервис `train-gpu` с `gpus: all`, read-only входными данными и отдельной папкой выходных адаптеров. В контейнере выполните `nvidia-smi` и `python -c "import torch; print(torch.cuda.is_available())"`; false останавливает запуск. На Mac эту задачу пометьте зависимой от окружения, CPU-упражнение не выдавайте за QLoRA.',
    'Зафиксируйте версии PEFT/TRL/transformers/bitsandbytes, revision `Qwen2.5-0.5B-Instruct`, dataset/split hash и seed. В `configs/qlora.json`: NF4, double quant, bf16 compute, r=8, alpha=16, q_proj/v_proj, length=256, micro-batch=1, accumulation=4, gradient checkpointing, use_cache=false. Это стартовый training-профиль для своего замера, не измеренный inference-профиль vLLM.',
    'В скрипте примените `prepare_model_for_kbit_training`, подключите LoRA и SFTTrainer. `docker compose run --rm train-gpu python -m finetuning.train --config configs/qlora.json` логирует MLflow run: loss, длительность, peak allocated/reserved, параметры и версии. Убедитесь, что базовые веса заморожены и gradients идут только в адаптер.',
    'Повторите запуск с другим rank или learning rate при неизменных данных и seed. В MLflow сравните два run, train/validation loss, пик VRAM и время. При OOM сначала уменьшайте длину и micro-batch; accumulation меняет effective batch, но не заменяет уменьшение активаций одной последовательности.',
    'Сохраните адаптер вместе с PEFT config и manifest base/tokenizer revision, dataset hash, git sha. Отдельный чистый процесс загружает базу и адаптер и выполняет smoke. Не публикуйте адаптер без проверки лицензии базы и источников данных.',
    'Подтверждение: коммит, два MLflow run id, manifest адаптера, GPU-замеры и smoke-отчёт. Падение validation или успешный train не замалчивайте: решение о выкатке делает J3.',
  ],
  J3: [
    'В `ai-platform-labs/eval/finetuning/` закрепите версию golden dataset из F и проверьте пересечения его текстов/источников с train и validation J1.1/J2. Хэш и правила split внесите в `manifest.json`; test не используется для выбора гиперпараметров.',
    'В `configs/base.json` и `configs/adapter.json` используйте одну base revision, tokenizer, chat template, decoding и ограничения токенов. Windows берёт адаптер J2, Mac — CPU-LoRA J1.1 через PEFT-сервис в Docker. NF4 training не означает, что inference обязательно тоже NF4.',
    'Выполните `docker compose run --rm eval python -m eval.compare_adapters --baseline configs/base.json --candidate configs/adapter.json`. Сохраните для каждого item ответы, evaluator scores, latency, usage и идентичность адаптера; используйте baseline/candidate эксперименты F5.',
    'Проверьте точность целевого JSON-формата, корректные отказы, общие вопросы и held-out темы. Ошибки, таймауты и пустые ответы входят в результат, а не удаляются из знаменателя. Judge проверяйте вручную на выборке, не давайте ему знать имя candidate.',
    'В `reports/decision.md` сравните обе модели по заранее заданным порогам и ошибочным items. Если качество не выросло или ухудшилась общая способность, зафиксируйте reject; задача может быть честно выполнена и с отвергнутым адаптером.',
    'Приложите коммит, независимый split manifest, два experiment id, таблицу по items и decision record. Числа в подтверждении — из своего запуска, не из целевого порога.',
  ],
  J4: [
    'На NVIDIA в `ai-platform-labs/infra/lora/` создайте Compose-сервис vLLM с закреплённым образом, `gpus: all`, `--enforce-eager`, `--max-num-batched-tokens 512`. Для уже измеренной базы Qwen2.5-0.5B используйте GPU util 0.35, 8K, max seqs 4 как исходный inference-профиль; наличие двух адаптеров требует нового замера, прежние цифры VRAM не гарантируют запас.',
    'Скопируйте два своих адаптера той же base revision в read-only `adapters/`; сопоставьте их PEFT config, r, target_modules и tokenizer. В конфигурации включите `--enable-lora`, `--lora-modules tickets-v1=/adapters/v1 tickets-v2=/adapters/v2`, `--max-lora-rank` не меньше сохранённого rank и разумный `--max-loras 2`.',
    '`docker compose up -d vllm` и запрос к `/v1/models` должны показать базу и оба разрешённых adapter names. Из контейнера клиента отправьте chat/completions отдельно для base, v1 и v2; неизвестный адаптер должен дать ошибку, а не тихо уйти на базу.',
    'В `gateway/src/gateway/providers/` добавьте явный allowlist adapter names для tenant. Параллельно отправьте смесь base/v1/v2 запросов; сохраните trace tenant/model/adapter revision и проверьте отсутствие смешивания между клиентами.',
    'Измерьте VRAM, TTFT и очередь при двух активных адаптерах и нагрузке. Сравните rank и max-loras; увеличение лимита не отменяет бюджет памяти. Не разрешайте runtime-загрузку произвольного пути из клиентского запроса.',
    'Приложите коммит Compose/gateway, manifests base/adapter, результаты трёх model names, negative case неизвестного адаптера и свои GPU-замеры. Завершите `docker compose down` этого проекта.',
  ],
  J5: [
    'В `ai-platform-labs/finetuning/pipeline/` создайте manifest с base revision, tokenizer/chat template hash, dataset/split hash, PEFT config, adapter SHA-256, git sha и MLflow run id. Адаптер и его manifest неизменяемы после регистрации.',
    'Соберите этапы train → независимый eval из J3 → gate с заранее заданными порогами. В `.gitlab-ci.yml` или своём pipeline проверка ошибок и неудачный gate дают ненулевой exit code; `allow_failure` для gate запрещён. Прогоните заведомо ухудшенный candidate и сохраните факт блокировки.',
    'После успешного gate зарегистрируйте согласованную пару base/adapter в MLflow Registry B3 как candidate. Переключение champion выполняется после smoke и не должно менять base revision у уже зарегистрированного адаптера.',
    'Windows: запускайте candidate отдельным model name vLLM из J4. Mac: отдельный Docker CPU-сервис PEFT с одной версией адаптера на процесс из J1.1, без CUDA и обещания multi-LoRA. Новая реплика проходит smoke, пока прежняя версия продолжает обслуживать запросы.',
    'В gateway переключите разрешённую версию на candidate, проверяйте ответы, latency и ошибки. Затем воспроизведите rollback на прежний adapter manifest и повторите тот же smoke; восстановление имени без правильного base revision откатом не считается.',
    'Приложите коммит pipeline/gateway, registry version ids, успешный и блокирующий gate, manifests и журнал выкатки/rollback. Собственные endpoints не должны автоматически писать прогресс в HomeOps: зачёт задачи — критерии и приложенное подтверждение.',
  ],
}

const observations: Record<string, [string, string][]> = {
  'J1.1': [
    ['docker compose config', 'Сервис train-cpu не запрашивает GPU; входные данные и выходные адаптеры имеют отдельные mounts.'],
    ['docker compose run --rm train-cpu python -m finetuning.validate data/', 'Валидатор принимает корректные диалоги, отвергает дубли и пересечения split; записывает хэши.'],
    ['docker compose run --rm train-cpu cat configs/cpu-lora.json', 'База/revision закреплены; CPU float32, r=4, length=128, micro-batch=1; NF4 отсутствует.'],
    ['docker compose run --rm train-cpu python -m finetuning.train --config configs/cpu-lora.json', 'Малый run завершается, обучает только LoRA, пишет metrics и artifact в MLflow.'],
    ['docker compose run --rm train-cpu python -m finetuning.smoke --adapter adapters/cpu --device cpu', 'Новый процесс загружает согласованную базу и адаптер и выдаёт ответ на отложенный вход.'],
    ['git diff --stat', 'В коммите есть код/lock/config/отчёт с MLflow run id и хэшами; веса не заменяют подтверждение результата.'],
  ],
  J2: [
    ['docker compose run --rm train-gpu python -c "import torch; print(torch.cuda.is_available())"', 'В GPU-контейнере CUDA доступна; на Mac этот шаг не подтверждается CPU-путём.'],
    ['docker compose run --rm train-gpu cat configs/qlora.json', 'Настроены NF4, double quant, BF16, r=8, length=256, micro-batch=1 и accumulation=4.'],
    ['docker compose run --rm train-gpu python -m finetuning.train --config configs/qlora.json', 'Training завершается; MLflow содержит параметры, loss, VRAM, время, git sha и хэши.'],
    ['docker compose run --rm train-gpu python -m finetuning.train --config configs/qlora-second.json', 'Второй run отличается одним заданным параметром при том же split; результаты сопоставлены в MLflow.'],
    ['docker compose run --rm train-gpu python -m finetuning.smoke --adapter adapters/candidate --device cuda', 'Отдельный процесс принимает PEFT artifact с той же base/tokenizer revision и выполняет inference.'],
    ['git diff --stat', 'В подтверждении есть два run id, manifest, свои замеры и smoke; рост качества не выводится из train loss.'],
  ],
  J3: [
    ['docker compose run --rm eval python -m finetuning.validate_split', 'Golden dataset имеет неизменный хэш и не пересекается с train/validation по данным и источникам.'],
    ['docker compose run --rm eval cat configs/base.json configs/adapter.json', 'Одинаковы base/tokenizer revision, template, decoding и лимиты; различается выбор адаптера.'],
    ['docker compose run --rm eval python -m eval.compare_adapters --baseline configs/base.json --candidate configs/adapter.json', 'Получены два сопоставимых run со scores и исходами всех items, включая ошибки.'],
    ['docker compose run --rm eval cat reports/slices.json', 'Есть целевой формат, отрицательные и general cases; результаты judge проверены вручную.'],
    ['docker compose run --rm eval cat reports/decision.md', 'Decision использует заданные до эксперимента пороги и объясняет regressions/promote/reject.'],
    ['git diff --stat', 'Подтверждение связывает split manifest, experiment ids, per-item сравнение и решение.'],
  ],
  J4: [
    ['docker compose config', 'vLLM получает GPU; базовый eager-профиль известен, добавленные адаптеры не выданы за прежний VRAM-замер.'],
    ['docker compose run --rm client cat adapters/v1/adapter_config.json adapters/v2/adapter_config.json', 'Оба адаптера относятся к той же базе/revision; rank не превышает server limit.'],
    ['docker compose run --rm client curl -fsS http://vllm:8000/v1/models', 'Есть база и два adapter names; отдельно проверены inference и ошибка unknown name.'],
    ['docker compose run --rm client python -m tests.lora_routes', 'Параллельная смесь tenant/model names не смешивает адаптеры; trace сохраняет revision.'],
    ['docker compose run --rm client python -m benchmarks.lora', 'Сохранены собственные VRAM, TTFT и очередь при заданной смеси и двух активных адаптерах.'],
    ['docker compose down', 'Остановлены ресурсы только этого проекта; приложены manifests, negative case и замеры.'],
  ],
  J5: [
    ['docker compose run --rm pipeline cat manifest.json', 'Manifest связывает immutable base/tokenizer, dataset/split, PEFT config, SHA-256 и run/git ids.'],
    ['docker compose run --rm pipeline python -m pipeline.release --candidate rejected', 'Проваленный gate даёт ненулевой exit и не меняет champion/traffic.'],
    ['docker compose run --rm pipeline python -m pipeline.registry --show-candidate', 'Candidate version в Registry имеет согласованные base/adapter metadata.'],
    ['docker compose run --rm pipeline python -m pipeline.smoke --candidate', 'Новая версия выполняет smoke до traffic switch; CPU PEFT и CUDA vLLM различены.'],
    ['docker compose run --rm pipeline python -m pipeline.rollback', 'Возвращена прежняя пара base/adapter и её routing, повторный smoke проходит.'],
    ['git diff --stat', 'Подтверждения содержат успешный/проваленный gate, registry versions, manifests и журнал rollback.'],
  ],
}

export const checks: Record<string, LabStepCheck[]> = Object.fromEntries(
  Object.entries(observations).map(([id, rows]) => [id, rows.map(([command, expected]) => ({
    command, expected,
    scope: `В своём репозитории ai-platform-labs: ${id}. Инструменты выполняются в Compose-контейнерах; git/docker compose — в терминале хоста. Имена сервисов и run ids замените своим проектом.`,
  }))]),
)
