import { packLabStepChecks, packLabSteps } from './packs/steps'
// Пошаговые планы «Что сделать» для практических задач (упражнения, лабораторные, интеграции).
// Ключ — id задачи из curriculum.ts. Все лабораторные живут в одном рабочем репозитории
// ai-platform-labs (создаётся в A0.1), у каждого компонента своя папка.
// Шаги конкретные: файлы, команды, параметры, что проверить и что приложить подтверждением.

export const labSteps: Record<string, string[]> = {
  // ── A Python ───────────────────────────────────────────────────────────────
  'A0.1': [
    'Создайте репозиторий `ai-platform-labs` в GitLab или GitHub — в нём будут жить все лабораторные. Структура: `gateway/`, `worker/`, `ml/`, `rag/`, `eval/`, `infra/` (Docker Compose, конфиги Prometheus и Grafana), `docs/evidence/` (скриншоты).',
    'Установите uv и в папке `gateway/` выполните `uv init --package gateway` — получится src-layout и `pyproject.toml`.',
    'Добавьте зависимости: `uv add fastapi uvicorn httpx pydantic-settings structlog` и dev-группу: `uv add --dev pytest pytest-asyncio ruff mypy`.',
    'В `pyproject.toml` включите настройки ruff (`line-length`, набор правил `E,F,I,B,UP`) и mypy (`strict = true`).',
    'Сделайте `Makefile` или `justfile` с целями `lint` (`uv run ruff check .`), `fmt` (`uv run ruff format .`), `typecheck` (`uv run mypy src`), `test` (`uv run pytest`).',
    'Проверьте, что в чистом клоне `uv sync && make lint typecheck test` проходит. Закоммитьте `uv.lock`.',
    'Подтверждение: ссылка на репозиторий и коммит с этой структурой.',
  ],
  'A0.2': [
    'В `gateway/src/gateway/` создайте `errors.py` с иерархией: `ProviderError` → `ProviderTimeout`, `ProviderUnavailable`, `ProviderBadRequest`. У каждого исключения — поле `provider: str`.',
    'Создайте `models.py`: `@dataclass(frozen=True)` для `ProviderConfig` (имя, base_url, timeout_s, priority) и `Usage` (prompt_tokens, completion_tokens).',
    'Создайте `providers/base.py` с `class Provider(Protocol)` и методом `async def chat(self, request: ChatRequest) -> ChatResponse`.',
    'Напишите контекстный менеджер `timed()` (через `contextlib.contextmanager`), который замеряет длительность блока в миллисекундах — пригодится для логов latency.',
    'Пройдите главы хендбука Яндекса про функции, классы и исключения, если что-то из этого непривычно.',
    'Убедитесь, что `uv run mypy src --strict` проходит без ошибок.',
    'Подтверждение: коммит с этими модулями.',
  ],
  'A0.3': [
    'В `models.py` опишите Pydantic-модели OpenAI-совместимого API: `Message(role: Literal["system","user","assistant"], content: str)`, `ChatRequest(model: str, messages: list[Message], max_tokens: int = 512, temperature: float = 0.2, stream: bool = False)`, `ChatResponse` с полями `id`, `model`, `provider`, `content`, `usage`.',
    'Добавьте ограничения: `max_tokens` в диапазоне 1–4096, `temperature` 0–2, `messages` не пустой (`Field(min_length=1)`).',
    'Создайте `settings.py` с `class Settings(BaseSettings)`: URL провайдеров, таймауты, `api_key: SecretStr`, префикс переменных `GATEWAY_`, чтение из `.env`.',
    'Добавьте `.env.example` в репозиторий, а `.env` — в `.gitignore`.',
    'Проверьте в REPL: невалидный запрос даёт понятную `ValidationError`, а `print(settings)` не показывает значение ключа.',
    'Подтверждение: коммит и вывод валидационной ошибки в заметке.',
  ],
  'A0.4': [
    'Настройте structlog с процессорами: `add_log_level`, `TimeStamper(fmt="iso")`, `contextvars.merge_contextvars`, `JSONRenderer()`.',
    'Сделайте middleware FastAPI (или пока функцию-обёртку): генерировать `request_id` (uuid4), класть его через `structlog.contextvars.bind_contextvars(request_id=...)`, очищать после запроса.',
    'Логируйте событие `request_finished` с полями `path`, `status`, `latency_ms`, `provider`, `model`.',
    'Проверьте, что каждая строка — валидный JSON: `uv run python app.py | jq .`.',
    'Подтверждение: коммит и пример строк лога в заметке.',
  ],
  'A0.5': [
    'Напишите `scripts/async_demo.py`: 50 запросов к `https://httpbin.org/delay/1` (или к локальному mock-серверу) через один `httpx.AsyncClient` и `asyncio.Semaphore(10)`. Замерьте общее время — должно быть около 5 секунд, а не 50.',
    'Оберните весь пакет в `async with asyncio.timeout(8):` и убедитесь, что при превышении приходит `TimeoutError`.',
    'Сравните `asyncio.gather` и `asyncio.TaskGroup`: сделайте один запрос, который падает, и посмотрите, что происходит с остальными.',
    'Реализуйте retry с exponential backoff и jitter вручную (задержка `base * 2**attempt + random.uniform(0, base)`) и через tenacity. Повторяйте только таймауты и 5xx.',
    'Сравните `time.sleep(1)` и `await asyncio.sleep(1)` внутри корутины на 10 параллельных задачах и запишите разницу во времени.',
    'Подтверждение: коммит со скриптом и таблица замеров в заметке.',
  ],
  'A0.6': [
    'Создайте `tests/` и `conftest.py` с фикстурой `settings` (scope="session") и фикстурой `fake_provider`.',
    'Напишите параметризованный тест маппинга ошибок: `@pytest.mark.parametrize("exc,status", [(ProviderTimeout, 504), (ProviderUnavailable, 502), (ProviderBadRequest, 400)])`.',
    'Напишите async-тест (`@pytest.mark.asyncio` или `asyncio_mode = "auto"` в `pyproject.toml`) с `httpx.MockTransport`, который возвращает заданный JSON.',
    'Добавьте тест, где MockTransport выбрасывает `httpx.ReadTimeout`, и проверьте, что ваш код превращает его в `ProviderTimeout`.',
    'Подтверждение: коммит и вывод `uv run pytest -v`.',
  ],
  A1: [
    'Создайте пакет `tools/endpoint-check` с CLI на typer или argparse: `endpoint-check --config endpoints.yaml --timeout 5 --retries 2 --output table` (или `--output json` для машинного вывода).',
    'Формат `endpoints.yaml`: список из `name`, `base_url`, `api_key_env` (имя переменной окружения с ключом).',
    'Для каждого endpoint выполните конкурентно: `GET /health` (если есть), `GET /v1/models`, тестовый `POST /v1/chat/completions` с одним коротким сообщением и `max_tokens=8`.',
    'Измерьте latency каждой проверки и выведите таблицу: endpoint, проверка, статус, latency_ms, ошибка.',
    'Exit code: 0 — всё в порядке, 1 — хотя бы одна проверка не прошла, 2 — ошибка конфигурации. Так CLI можно ставить в CI и cron.',
    'Проверьте на двух целях: любом публичном OpenAI-совместимом endpoint (или mock-сервере на FastAPI) и заведомо несуществующем адресе.',
    'Опишите запуск в README папки. Подтверждение: коммит и вывод CLI в обоих режимах.',
  ],
  A2: [
    'В `gateway/` создайте FastAPI-приложение: `app = FastAPI(lifespan=lifespan)`, где lifespan создаёт общий `httpx.AsyncClient` и закрывает его при остановке.',
    'Реализуйте `MockProvider` (возвращает эхо последнего сообщения с задержкой из настроек) по протоколу `Provider` из A0.2.',
    'Эндпоинт `POST /v1/chat` принимает `ChatRequest`, вызывает провайдер внутри `asyncio.timeout(settings.provider_timeout_s)` и возвращает `ChatResponse`.',
    'Маппинг ошибок через exception handlers: таймаут → 504, недоступен → 502, ошибка запроса → 400, валидация → 422 (FastAPI делает сам). Тело ошибки: `{"error": {"type": ..., "message": ..., "provider": ...}}`.',
    'Добавьте `GET /health` (процесс жив) и `GET /ready` (провайдеры сконфигурированы, клиент создан).',
    'Подключите structlog из A0.4: в каждом запросе логируются request_id, provider, latency_ms, статус.',
    'Напишите `Dockerfile` (на базе `python:3.12-slim` и uv по инструкции «Using uv in Docker»), соберите образ и запустите `docker run -p 8080:8080`.',
    'Проверьте curl-ом успешный запрос, невалидный запрос и таймаут (поставьте задержку mock больше таймаута). Подтверждение: коммит, вывод curl и строки логов.',
  ],
  A3: [
    'В `tests/test_api.py` создайте клиент: `httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test")`.',
    'Подменяйте провайдер через `app.dependency_overrides` или фикстуру, которая собирает приложение с fake-провайдером.',
    'Покройте сценарии: успешный ответ, 422 на пустые messages, 504 при задержке fake больше таймаута, 502 при `ProviderUnavailable`, `/health` и `/ready`.',
    'Добавьте unit-тесты чистой логики (маппинг ошибок, подсчёт latency, сборка ответа) без HTTP.',
    'Включите `pytest-cov`: `uv run pytest --cov=gateway --cov-report=term-missing` и доведите покрытие критичного пути до 80%+.',
    'Убедитесь, что `uv run mypy src --strict` и `uv run ruff check .` проходят.',
    'Подтверждение: коммит и вывод pytest с покрытием.',
  ],
  A4: [
    'Поднимите в `infra/docker-compose.yml` Kafka (KRaft, один брокер) и PostgreSQL. Создайте топики `llm.jobs`, `llm.jobs.dlq`.',
    'В PostgreSQL создайте таблицу `jobs(id uuid primary key, status text, payload jsonb, result text, attempts int, updated_at timestamptz)`.',
    'Сделайте `worker/` на aiokafka: `AIOKafkaConsumer("llm.jobs", group_id="llm-worker", enable_auto_commit=False)`.',
    'Обработка сообщения: если задача уже `done` — пропустить (идемпотентность по `id`); иначе статус `processing` → вызвать gateway `/v1/chat` → записать `done` и результат.',
    'При ошибке: увеличить `attempts`, повторить с backoff до 3 раз; после этого отправить сообщение в `llm.jobs.dlq` с заголовками `error.type` и `error.message`, статус `failed`.',
    'Коммитьте offset (`await consumer.commit()`) только после записи итогового статуса.',
    'Graceful shutdown: по SIGTERM перестать брать новые сообщения, дождаться текущей обработки, закрыть consumer.',
    'Проверки: отправьте 20 задач скриптом-producer; убейте worker (`kill -9`) посреди обработки и запустите снова — задачи доделываются без дублей; сломайте gateway — задачи уходят в DLQ.',
    'Подтверждение: коммит, вывод проверки и состояние таблицы `jobs` до и после.',
  ],

  // ── B ML Lifecycle ─────────────────────────────────────────────────────────
  B1: [
    'В `ml/` создайте проект (uv) с зависимостями `scikit-learn pandas joblib`.',
    'Возьмите датасет: свои тикеты или логи с метками, либо открытый (например, `sklearn.datasets.fetch_20newsgroups` — несколько категорий).',
    'Скрипт `train.py`: загрузка → `train_test_split(test_size=0.2, random_state=42, stratify=y)` → `TfidfVectorizer + LogisticRegression` в `Pipeline` → обучение.',
    'Посчитайте `classification_report` и сохраните метрики в `metrics.json`.',
    'Посчитайте SHA-256 файла датасета и сохраните вместе с моделью: `joblib.dump(model, "artifacts/model.joblib")` и `artifacts/meta.json` с хэшем данных, seed и версиями библиотек.',
    'Запустите `uv run train.py` дважды и убедитесь, что метрики совпадают до знака.',
    'Подтверждение: коммит и `metrics.json` двух запусков.',
  ],
  B2: [
    'В `infra/` поднимите MinIO (бакет `mlflow`) и PostgreSQL для MLflow.',
    'Запустите MLflow server: `mlflow server --backend-store-uri postgresql://mlflow:***@db/mlflow --artifacts-destination s3://mlflow --host 0.0.0.0` с переменными `MLFLOW_S3_ENDPOINT_URL`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`.',
    'В `train.py`: `mlflow.set_tracking_uri(...)`, `mlflow.set_experiment("ticket-clf")`, внутри `with mlflow.start_run():` — `log_params` (C, max_features, seed), `log_metrics` (f1, precision, recall), `log_artifact("metrics.json")`, теги `git_sha` и `dataset_sha256`.',
    'Сохраните модель через `mlflow.sklearn.log_model(...)`.',
    'Сделайте 3+ запуска с разными гиперпараметрами и сравните их в UI (Compare runs).',
    'Перезапустите контейнеры и убедитесь, что история запусков сохранилась.',
    'Подтверждение: скриншот сравнения запусков и коммит.',
  ],
  B3: [
    'Зарегистрируйте модель: `mlflow.sklearn.log_model(..., registered_model_name="ticket-clf")` для двух запусков — получатся версии 1 и 2.',
    'Через `MlflowClient()` назначьте aliases: `set_registered_model_alias("ticket-clf", "champion", 1)` и `"candidate"` на версию 2.',
    'Добавьте теги версиям (`set_model_version_tag`): `dataset_sha256`, `git_sha`, `f1`.',
    'Напишите `promote.py`: загружает метрики champion и candidate, сравнивает по f1 с порогом (например, candidate лучше минимум на 1 п.п. и не хуже по recall), печатает решение и при флаге `--apply` переносит alias champion.',
    'Запишите в заметке своими словами, чем версия модели отличается от версии приложения.',
    'Подтверждение: скриншот registry с aliases и вывод `promote.py`.',
  ],
  B4: [
    'Создайте `ml/serving/` — FastAPI-сервис: при старте `mlflow.pyfunc.load_model("models:/ticket-clf@champion")`, эндпоинт `POST /predict`.',
    'Сохраняйте в памяти номер загруженной версии; отдавайте его в `/health` и пишите в каждую строку лога.',
    'Добавьте `POST /admin/reload` (или фоновую проверку раз в минуту), который перечитывает alias и меняет модель без перезапуска.',
    'Сценарий: `promote.py --apply` переносит champion на v2 → reload → `/health` показывает v2.',
    'Rollback: вернуть alias на v1 → reload → `/health` показывает v1. Замерьте время отката.',
    'Подтверждение: коммит и лог с переключением версий.',
  ],
  B5: [
    'Возьмите обучающую выборку из B1 как reference. Сымитируйте «продовые» данные со сдвигом: например, другая пропорция классов или тексты другой тематики.',
    'Напишите `drift.py`: PSI для числовых признаков (длина текста, число слов) по 10 бинам reference: `sum((cur - ref) * ln(cur / ref))` с защитой от нулей.',
    'Сделайте отчёт Evidently с пресетом Data Drift для тех же данных и сравните выводы.',
    'Экспортируйте PSI как gauge-метрику (`prometheus_client`, `push_to_gateway` или эндпоинт `/metrics`) и добавьте правило алерта на PSI > 0.25.',
    'Опишите в заметке разницу между data drift и concept drift на примере вашего датасета.',
    'Подтверждение: HTML-отчёт Evidently (путь или скриншот) и коммит.',
  ],

  // ── C LLM Serving ──────────────────────────────────────────────────────────
  'C0.1': [
    'Откройте закреплённый config.json Qwen2.5-3B-Instruct (revision aa8e72537993ba99e69dfaafa59ed015b17504d1): выпишите num_hidden_layers, num_key_value_heads, hidden_size, num_attention_heads. На обеих машинах расчёт выполняется в контейнере Python; serving-профиль — из отчёта Windows 10 октября.',
    'Посчитайте head_dim = hidden_size / num_attention_heads и память KV cache на токен: 2 × layers × kv_heads × head_dim × 2 байта (BF16). Для 3B при 36 layers, 2 KV heads и head_dim 128 получится 36864 байта, без служебных структур.',
    'Посчитайте память весов: число параметров × 2 байта.',
    'Оцените KV-бюджет при GPU util 0.85: используйте CUDA free и фактическую память weights/runtime, а не просто 8 ГиБ из nvidia-smi. Измеренный WSL: CUDA free около 6.93 ГиБ; vLLM отказывает при 0.90 до weights. 3B/0.85/8K/2 проверен, 32K не помещается.',
    'После C1 сверьте с логом vLLM при старте (строка про размер KV cache / число блоков).',
    'Посчитайте то же для 7B-модели и запишите, почему она не помещается в BF16.',
    'Подтверждение: расчёт в заметке и строка лога vLLM.',
  ],
  C1: [
    'Эта задача подтверждает NVIDIA/CUDA и выполняется на Windows. Обновите Windows NVIDIA driver и WSL; Linux display driver внутри WSL не ставьте. На Mac отметьте C1 как заблокированную окружением, а для C2/C4/E/F используйте DMR: `docker model pull ai/qwen2.5:3B-Q4_K_M` (3B и 7B Q4_K_M измерены на Apple Silicon). Metal-путь не является зачётом CUDA.',
    'Из GPU-контейнера WSL выполните `nvidia-smi`, затем отдельную CUDA tensor-операцию `python -c "import torch; x=torch.ones(2,device=\'cuda\'); print(x.sum().item(), torch.cuda.get_device_name(0), torch.cuda.mem_get_info())"`. NVML visibility сама по себе не доказывает compute.',
    'В `infra/compose.yaml` задайте image vllm/vllm-openai:v0.31.0, gpus: all, shm_size: 2gb; модельные cache монтируйте папкой. Не ставьте vLLM на Windows-хост и не запускайте CUDA-image на Mac. Запишите image digest и model revision.',
    'Команда сервиса для лёгкого старта: `vllm serve Qwen/Qwen2.5-0.5B-Instruct --revision 7ae557604adf67be50417f59c2c2f167def9a775 --dtype bfloat16 --gpu-memory-utilization 0.35 --max-model-len 8192 --max-num-seqs 4 --max-num-batched-tokens 512 --enforce-eager`. Используйте одну GPU-модель за раз; измеренный peak 2974 МиБ — ориентир для этого профиля, не резерв для training.',
    'Второй проверенный Windows-профиль: Qwen/Qwen2.5-3B-Instruct @ aa8e72537993ba99e69dfaafa59ed015b17504d1, BF16, util 0.85, 8192, max-num-seqs 2, eager и batch tokens 512; peak 7058 МиБ. Не использовать 0.90 или непроверенную 1.5B-конфигурацию как гарантированный старт. Если free изменился, сохраните симптом и измерьте отдельно.',
    'Из контейнера-клиента проверьте `/v1/models`, короткий streaming chat и длинный запрос внутри выбранного 8K-контракта. На Mac для следующих задач используйте DMR endpoint из C2; Docker-контейнеры Mac работают на CPU, Metal доступен через DMR.',
    'В `docs/serving-environment.md` сохраните Windows/WSL, GPU/VRAM, driver/CUDA, vLLM/image digest, model/tokenizer revision, все startup args, CUDA free и собственный NVML peak. Отказ не скрывайте переходом на CPU.',
    'Подтверждение: вывод `/v1/models` и `nvidia-smi` (скриншот или текст).',
  ],
  C2: [
    'Windows/WSL: измеренный vLLM 0.31.0, один GPU workload, --enforce-eager --max-num-batched-tokens 512; Qwen2.5-0.5B BF16 / util 0.35 / 8192 / max-num-seqs 4 либо Qwen2.5-3B BF16 / util 0.85 / 8192 / 2. На Mac: ai/qwen2.5:3B-Q4_K_M через Docker Model Runner (Metal), endpoint из контейнера http://model-runner.docker.internal/engines/v1/chat/completions. DMR измерен только на коротком prompt; длинный вход проверяйте отдельно. Запишите base_url/model в `infra/model-profiles.json` и отправьте chat-запрос из контейнера-клиента через Python/httpx, разберите `usage`. Не заменяйте число токенов длиной строки.',
    'Напишите `scripts/stream_ttft.py` на httpx: запрос со `"stream": true`, чтение SSE построчно, засечка времени до первого непустого `delta.content` — это клиентский TTFT.',
    'Сравните TTFT короткого и длинного prompt, длину считайте родным tokenizer с chat template, резервируйте output. Windows: проверенный 8K-профиль; Mac DMR: начинайте с измеренного короткого prompt и проверяйте длинный отдельно. В таблице укажите фактические input/output tokens, backend и число запросов.',
    'Попробуйте `temperature` 0 и 1 на одном prompt по 3 раза и опишите разницу.',
    'Подтверждение: коммит скрипта и таблица TTFT.',
  ],
  C3: [
    'Windows/WSL: измеренный vLLM 0.31.0, один GPU workload, --enforce-eager --max-num-batched-tokens 512; Qwen2.5-0.5B BF16 / util 0.35 / 8192 / max-num-seqs 4 либо Qwen2.5-3B BF16 / util 0.85 / 8192 / 2. На Mac: ai/qwen2.5:3B-Q4_K_M через Docker Model Runner (Metal), endpoint из контейнера http://model-runner.docker.internal/engines/v1/chat/completions. DMR измерен только на коротком prompt; длинный вход проверяйте отдельно. Для этой NVIDIA-задачи используйте `vllm bench serve --backend openai-chat --endpoint /v1/chat/completions --dataset-name random --random-input-len 1024 --random-output-len 128 --num-prompts 200` с model/tokenizer выбранного профиля. На Mac анализ latency DMR можно подготовить отдельным клиентом, но это не проверка GPU capacity vLLM.',
    'Серия клиентской concurrency: 1, 4, 16, 32. max-num-seqs сервера оставьте 4 у 0.5B или 2 у 3B: это лимит активных sequences, остальные запросы стоят в очереди. Не смешивайте очередь клиента с ростом memory limit runtime.',
    'Серия по длине входа: `--random-input-len` 256, 1024, 3000 при фиксированной конкурентности.',
    'Серия по нагрузке: `--request-rate` 1, 4, 8, inf.',
    'Для каждого прогона запишите TTFT p50/p95, TPOT, output tokens/s и долю ошибок в таблицу (CSV в репозитории).',
    'Найдите точку, где TTFT p95 резко растёт, и объясните по метрикам vLLM (waiting, kv_cache_usage_perc).',
    'Повторите один прогон с длинным одинаковым префиксом с prefix caching и без него.',
    'Подтверждение: CSV с результатами, график (можно в ноутбуке) и выводы в заметке.',
  ],
  C4: [
    'Добавьте в gateway `OpenAICompatibleProvider(base_url, api_key, timeout)`: Windows — измеренный vLLM-профиль C2; Mac — DMR endpoint из C2 с ai/qwen2.5:3B-Q4_K_M. Внешний провайдер подключается тем же интерфейсом. Не зашивайте model name одного backend в общий клиент.',
    'Конфиг маршрутов в YAML: алиас модели → упорядоченный список провайдеров, например `fast: [local-vllm, external]`.',
    'Логика: пробовать провайдеры по порядку; на таймаут или 5xx — следующий; на 4xx — сразу вернуть ошибку клиенту.',
    'Возвращайте фактического провайдера в заголовке `X-Provider` и в логах; считайте `fallback_total` по паре from → to.',
    'Опционально: circuit breaker — после 5 ошибок подряд провайдер исключается на 30 секунд.',
    'Тесты: fallback при таймауте первого, ошибка 502 при отказе всех, отсутствие fallback на 400.',
    'Ручная проверка: остановите vLLM — запросы уходят во внешний или mock-провайдер.',
    'Подтверждение: коммит, тесты и лог с fallback.',
  ],
  C5: [
    'Таблица `usage_events(tenant, model, provider, prompt_tokens, completion_tokens, cost_usd, created_at)` в PostgreSQL.',
    'Тенант определяется по API-ключу из заголовка `Authorization`; ключи и тенанты — в конфиге.',
    'После каждого ответа записывайте usage; стоимость — по таблице цен в конфиге ($ за 1M входных и выходных токенов; для локальной модели — амортизация GPU-часа на ваш throughput из C3).',
    'Квота: дневной лимит токенов на тенанта, проверка перед вызовом провайдера (атомарный счётчик в БД или Redis), при превышении — 429 с `Retry-After` до полуночи.',
    'Эндпоинт `GET /v1/usage?from=&to=` — сводка по тенанту и моделям.',
    'Проверка: исчерпайте маленькую квоту скриптом и получите 429.',
    'Подтверждение: коммит и вывод `/v1/usage`.',
  ],
  C6: [
    'Добавьте в gateway PriorityQueue и пул workers с Semaphore(N) к backend C2: Windows vLLM, Mac DMR. N и client load сохраните отдельно от max-num-seqs движка; измеряйте очередь, а не считайте число workers доступной GPU capacity.',
    'Класс трафика — заголовок `X-Priority: interactive|batch` (или по тенанту); interactive получает приоритет 0, batch — 10.',
    'Batch-задачи из Kafka worker (A4) отправляйте с `batch`.',
    'Метрика `queue_wait_seconds` (histogram) с лейблом класса.',
    'Нагрузочный тест: 200 batch-запросов параллельно и раз в секунду interactive-запрос; сравните queue wait interactive с приоритетами и без.',
    'Подтверждение: коммит и таблица замеров.',
  ],
  C7: [
    'Таблица `semantic_cache(tenant, embedding vector(384), prompt_hash, response, created_at)` с HNSW-индексом.',
    'Перед вызовом провайдера: эмбеддинг последнего пользовательского сообщения → поиск ближайшего в кэше того же тенанта → если косинусная близость выше порога и запись моложе TTL — вернуть ответ из кэша.',
    'Подберите порог на 30 парах «похожие по смыслу» и «похожие по словам, но разные».',
    'Метрики `cache_hit_total`, `cache_miss_total` и latency с кэшем и без.',
    'Подтверждение: коммит, таблица подбора порога и описание рисков в заметке.',
  ],
  C9: [
    'Эндпоинт в gateway или отдельный сервис `POST /v1/transcriptions/jobs`: принимает аудиофайл, кладёт его в MinIO, создаёт задачу в таблице и сообщение в топик `stt.jobs`, возвращает `job_id`.',
    'STT-worker (aiokafka, как в A4): скачивает файл, режет на фрагменты по паузам (VAD), распознаёт faster-whisper: `WhisperModel("small", device="cuda", compute_type="float16")` или `device="cpu", compute_type="int8"`, `model.transcribe(path, vad_filter=True)`.',
    'Склеивает транскрипт с таймкодами, сохраняет в БД. Ошибка одного фрагмента — повтор только его, а не всей записи.',
    'Саммари через ваш LLM Gateway: map-шаг по частям транскрипта («ключевые решения, задачи, ответственные»), затем reduce-шаг в итоговый протокол. Токены учитываются на тенанта (C5).',
    'Статусы задачи: `queued` → `transcribing` → `summarizing` → `done` / `failed`; `GET /v1/transcriptions/jobs/{id}` отдаёт статус, транскрипт и саммари.',
    'Метрики: длительность аудио, время обработки, real-time factor, ошибки по этапам.',
    'Проверка: запишите 10–15 минут разговора (или возьмите открытую запись), прогоните пайплайн, оцените качество саммари вручную.',
    'На Mac STT-worker оставьте на CPU/int8, саммари — через измеренный DMR 3B; на Windows используйте CPU/int8 рядом с проверенным vLLM-профилем C2. Одновременный Whisper CUDA + vLLM на 8 ГБ не измерен — сначала нужен отдельный memory benchmark, а не перенос peak одной модели на две.',
    'Подтверждение: коммит, пример транскрипта и саммари, значение RTF.',
  ],
  C10: [
    'Экспорт в `ai-platform-labs/serving/triton/`: в контейнере `python:3.12-slim` установите `pip install optimum[onnx]` и выполните `optimum-cli export onnx --model intfloat/multilingual-e5-small --task feature-extraction onnx/e5`. Посмотрите входы и выходы модели (`python -c "import onnx; m = onnx.load(\'onnx/e5/model.onnx\'); print([i.name for i in m.graph.input], [o.name for o in m.graph.output])"`): у BERT-подобных моделей это `input_ids`, `attention_mask`, `token_type_ids` и `last_hidden_state`.',
    'Model repository: `model_repository/e5/1/model.onnx` и `model_repository/e5/config.pbtxt` — `backend: "onnxruntime"`, `max_batch_size: 32`, входы TYPE_INT64 с `dims: [-1]`, выход `last_hidden_state` TYPE_FP32 с `dims: [-1, 384]`, `instance_group [{ kind: KIND_CPU }]` (на RTX 4060 — `KIND_GPU`). Dynamic batching пока не включайте.',
    'Запуск: `compose.yaml` с сервисом `triton` — образ `nvcr.io/nvidia/tritonserver:26.09-py3` (amd64 и arm64, около 15 ГБ), команда `tritonserver --model-repository=/models`, порты `127.0.0.1:8000-8002`. Проверка из контейнера-клиента: `GET /v2/health/ready` и `GET /v2/models/e5/config`. На Mac сервер работает на CPU; если без GPU он не стартует — делайте на Windows-ноутбуке.',
    'Замер без батчинга: контейнер `nvcr.io/nvidia/tritonserver:26.09-py3-sdk`, `perf_analyzer -u triton:8000 -m e5 --shape input_ids:64 --shape attention_mask:64 --shape token_type_ids:64 --concurrency-range 1:16:4 --percentile=95`. Запишите throughput (infer/sec) и p95 для каждой конкурентности.',
    'Включите `dynamic_batching { max_queue_delay_microseconds: 2000 }` в config.pbtxt, перезапустите Triton и повторите замер. Сравните: при конкурентности 1 разницы почти нет, при 8–16 растёт throughput, а p95 платит за ожидание в очереди.',
    'Клиент `client.py` на `tritonclient[http]`: токенизация, запрос к `e5`, mean pooling по `attention_mask` → вектор 384. Сравните косинусную близость с эмбеддингом той же модели из sentence-transformers — должна быть около 1.',
    'Подтверждение: `serving/triton/README.md` — config.pbtxt, таблица throughput и p95 без dynamic batching и с ним, вывод «Triton или vLLM» для эмбеддингов, классификатора и LLM.',
  ],

  // ── D Observability ────────────────────────────────────────────────────────
  D0: [
    'Создайте `docs/slo.md` для gateway.',
    'Таблица SLI: TTFT p95, e2e latency p95/p99 для нестримингового режима, TPOT, доля ошибок 5xx и таймаутов, доступность (успешные / все), queue time p95.',
    'Для каждого SLI — цель и окно: например, «TTFT p95 < 1.5 с за 28 дней», «доступность 99.5%».',
    'Посчитайте error budget в минутах и запросах для выбранной доступности.',
    'Опишите, какие метрики vLLM и gateway дают каждый SLI (имена метрик) и что не считается ошибкой (4xx клиента).',
    'Подтверждение: коммит `slo.md`.',
  ],
  D1: [
    'Добавьте в gateway `prometheus_client`: `gateway_requests_total{provider,model,status}`, `gateway_request_duration_seconds` (histogram), `gateway_tokens_total{type="prompt|completion",tenant}`, `gateway_fallback_total{from,to}`; эндпоинт `/metrics`.',
    'В `infra/prometheus/prometheus.yml` добавьте job для vLLM (`<host>:8000/metrics`) и для gateway.',
    'Поднимите Prometheus в Docker Compose и проверьте Targets — оба `UP`.',
    'Сохраните PromQL-запросы в `infra/prometheus/queries.md`: p95 TTFT (`histogram_quantile(0.95, sum by (le) (rate(vllm:time_to_first_token_seconds_bucket[5m])))`), доля 5xx по провайдерам, tokens/s, `vllm:num_requests_waiting`, `vllm:kv_cache_usage_perc`.',
    'Дайте нагрузку скриптом из C3 и убедитесь, что метрики меняются.',
    'Подтверждение: скриншот Targets и коммит.',
  ],
  'D1.1': [
    'Попробуйте dcgm-exporter в контейнере с GPU; в WSL он часто не видит DCGM — это нормально, зафиксируйте результат.',
    'Запасной вариант: скрипт раз в 15 секунд вызывает `nvidia-smi --query-gpu=utilization.gpu,memory.used,memory.total,temperature.gpu,power.draw --format=csv,noheader,nounits` и пишет метрики в формате Prometheus в файл для textfile collector node-exporter (или отдаёт `/metrics` сам).',
    'Подключите к Prometheus и сопоставьте GPU utilization с нагрузкой из C3.',
    'Подтверждение: скриншот графика и описание выбранного способа.',
  ],
  D2: [
    'Поднимите Grafana в Docker Compose с provisioning: `infra/grafana/provisioning/datasources/prometheus.yaml` и `dashboards/dashboards.yaml`, JSON дашборда в `infra/grafana/dashboards/llm-serving.json`.',
    'Ряд 1 (RED): RPS, доля ошибок по провайдерам, e2e p50/p95/p99.',
    'Ряд 2 (LLM): TTFT p50/p95, TPOT, prompt и generation tokens/s, доля fallback.',
    'Ряд 3 (насыщение): running и waiting запросы vLLM, kv_cache_usage_perc, queue wait по классам, GPU utilization и VRAM.',
    'Ряд 4 (деньги): токены и стоимость по тенантам за сутки.',
    'Дайте нагрузку из C3 и сделайте скриншот момента насыщения.',
    'Подтверждение: JSON дашборда в репозитории и скриншот.',
  ],
  D3: [
    'Файл `infra/prometheus/rules/llm.yml` с правилами: высокий queue time (p95 > 2 с, `for: 5m`), деградация TTFT p95 относительно SLO, доля 5xx > 2% (`for: 5m`), падение generation tokens/s при waiting > 0, kv_cache_usage_perc > 0.9.',
    'У каждого правила — `labels.severity` и `annotations.summary/description` с текущим значением.',
    'Напишите `rules/llm_test.yml` для `promtool test rules` с синтетическими рядами: алерт срабатывает и не срабатывает.',
    'Поднимите Alertmanager (можно с webhook-приёмником или в Telegram) и воспроизведите алерт нагрузкой.',
    'Подтверждение: вывод `promtool test rules`, скриншот сработавшего алерта, коммит.',
  ],
  D4: [
    'Установите `opentelemetry-sdk opentelemetry-exporter-otlp opentelemetry-instrumentation-fastapi opentelemetry-instrumentation-httpx`.',
    'При старте gateway: `FastAPIInstrumentor.instrument_app(app)`, `HTTPXClientInstrumentor().instrument()`, экспорт OTLP на адрес из `OTEL_EXPORTER_OTLP_ENDPOINT`.',
    'Ручные spans: `route` (атрибуты model_alias, выбранный провайдер), `provider.call` (provider, model, prompt_tokens, completion_tokens), `fallback` (from, to, причина).',
    'Поднимите OpenTelemetry Collector и Jaeger в Docker Compose; конфиг collector в `infra/otel/collector.yaml`.',
    'Добавьте `trace_id` в structlog (процессор, читающий текущий span).',
    'Проверьте трейс запроса с fallback в Jaeger.',
    'Подтверждение: скриншот трейса и коммит.',
  ],
  D5: [
    'Поднимите Loki и Grafana Alloy (или Promtail), собирающий логи контейнеров gateway и worker.',
    'Разбор JSON-полей в LogQL: `{service="gateway"} | json | status >= 500`.',
    'Сохраните 3 запроса: ошибки по провайдеру за час, медленные запросы (latency_ms > 5000), все логи одного request_id.',
    'Настройте derived field в Grafana: trace_id из лога открывает трейс в Jaeger.',
    'Подтверждение: скриншот перехода от лога к трейсу.',
  ],

  // ── E RAG ──────────────────────────────────────────────────────────────────
  E1: [
    'В Docker Compose добавьте `pgvector/pgvector:pg17` (отдельно от БД gateway).',
    'Миграция: `CREATE EXTENSION vector;` и таблица `chunks(id bigserial, doc_id text, chunk_idx int, content text, content_hash text, metadata jsonb, embedding vector(384))`.',
    'Индекс: `CREATE INDEX ON chunks USING hnsw (embedding vector_cosine_ops);`.',
    'Сгенерируйте 10 000 случайных векторов, выполните запрос `ORDER BY embedding <=> $1 LIMIT 5` и посмотрите `EXPLAIN ANALYZE` — используется ли индекс.',
    'Сравните результаты точного поиска (`SET enable_indexscan = off`) и HNSW для 50 запросов: какая доля top-5 совпадает; попробуйте `SET hnsw.ef_search = 100`.',
    'Подтверждение: миграция в репозитории и вывод EXPLAIN.',
  ],
  E2: [
    'Соберите 30–100 технических документов в Markdown: свои runbook-и, выдержки из документации Patroni, Kafka, Vault.',
    'Скрипт `rag/ingest.py`: чтение файлов → нарезка по заголовкам Markdown, длинные разделы дополнительно на куски ~500–800 токенов с перекрытием ~15%.',
    'Эмбеддинги: `SentenceTransformer("intfloat/multilingual-e5-small")`, тексты с префиксом `"passage: "`, `normalize_embeddings=True`.',
    'Идемпотентность: для документа считается хэш содержимого; если он изменился — удалить старые чанки документа и вставить новые, если нет — пропустить.',
    'Метаданные чанка: путь к файлу, заголовок раздела, дата изменения.',
    'Запустите ingest дважды — число строк не меняется.',
    'Подтверждение: коммит и `docs/chunking.md` с обоснованием стратегии.',
  ],
  E3: [
    'В gateway (или отдельном `rag/` сервисе) `POST /v1/search` с телом `{query, top_k=5, filters: {source?}}`.',
    'Эмбеддинг запроса с префиксом `"query: "`, SQL: `SELECT ..., 1 - (embedding <=> $1) AS score FROM chunks WHERE ... ORDER BY embedding <=> $1 LIMIT $2`.',
    'Ответ: список `{chunk_id, doc_id, section, content, score}`.',
    'Метрика latency поиска (histogram) и span в трейсе.',
    'API-тесты: результат по известному запросу, фильтр по источнику, пустая база.',
    'Подтверждение: коммит и пример ответа.',
  ],
  E4: [
    '`POST /v1/rag/answer`: top-k → prompt `prompts/rag_v1.txt` с нумерованными фрагментами → `/v1/chat` → chunk_id. Windows/WSL: измеренный vLLM 0.31.0, один GPU workload, --enforce-eager --max-num-batched-tokens 512; Qwen2.5-0.5B BF16 / util 0.35 / 8192 / max-num-seqs 4 либо Qwen2.5-3B BF16 / util 0.85 / 8192 / 2. На Mac: ai/qwen2.5:3B-Q4_K_M через Docker Model Runner (Metal), endpoint из контейнера http://model-runner.docker.internal/engines/v1/chat/completions. DMR измерен только на коротком prompt; длинный вход проверяйте отдельно. Эмбеддинги остаются на CPU; итоговый prompt + output укладывается в реально проверенный контекст.',
    'В шаблоне: отвечать только по фрагментам, ссылаться на номера, при отсутствии ответа писать «В базе нет информации».',
    'Версия шаблона (`prompt_version=rag_v1`) — в логах, метриках и трейсах.',
    'Проверьте 5 вопросов из базы и 3 вопроса вне базы.',
    'Подтверждение: коммит и примеры ответов в заметке.',
  ],
  E5: [
    'Составьте `eval/retrieval.jsonl`: 30+ вопросов, для каждого — список релевантных `chunk_id` (разметьте вручную, просматривая чанки).',
    'Скрипт `eval/retrieval_eval.py`: для каждого вопроса — поиск top-10, расчёт recall@1/3/5/10 и MRR, итог по датасету.',
    'Сравните минимум две конфигурации: размер чанка (например, 400 и 800 токенов) или HNSW против точного поиска.',
    'Сохраните результаты в CSV и короткий отчёт: какая конфигурация лучше и почему.',
    'Подтверждение: датасет, скрипт и отчёт в репозитории.',
  ],
  E6: [
    'Подключите cross-encoder из sentence-transformers (многоязычный reranker).',
    'Поиск top-20 → переранжирование → top-5.',
    'Посчитайте recall@5 и MRR с reranking и без, а также добавку к latency.',
    'Подтверждение: таблица сравнения.',
  ],

  // ── F LLM Evaluation ───────────────────────────────────────────────────────
  F1: [
    'Склонируйте репозиторий Langfuse и поднимите по инструкции «Docker Compose deployment» (`docker compose up`), UI на порту 3000.',
    'Разберитесь с составом: web, worker, PostgreSQL, ClickHouse, Redis/Valkey, MinIO — запишите роль каждого.',
    'Создайте организацию, проект и API-ключи.',
    'Проверьте health-эндпоинты из документации.',
    'Запишите план бэкапа: PostgreSQL (pgBackRest или pg_dump), ClickHouse, бакет MinIO, — что и как часто.',
    'Подтверждение: скриншот проекта и заметка с ролями компонентов и планом бэкапа.',
  ],
  F2: [
    'Установите `langfuse` в gateway, передайте ключи и адрес проекта через переменные окружения (`LANGFUSE_*`).',
    'Оберните обработчик `/v1/rag/answer` в trace (`@observe()`), шаги — в вложенные observations: retrieval (запрос, найденные chunk_id), generation (модель, параметры, usage).',
    'Метаданные trace: tenant, prompt_version, git_sha, model/tokenizer revision, backend/image digest и startup profile C2; user_id/session_id при наличии. Mac DMR и Windows vLLM различаются и сравниваются только при явно записанных условиях.',
    'Настройте цены моделей в Langfuse, чтобы считалась стоимость.',
    'Сделайте 20 запросов и посмотрите трейсы: дерево, токены, стоимость.',
    'Подтверждение: скриншот трейса с retrieval и generation.',
  ],
  F3: [
    'Создайте `eval/golden/v1.jsonl`: 40–60 записей вида `{id, input, expected_facts: [...], expected_sources: [chunk_id], must_refuse: bool, tags: [категория, сложность]}`.',
    'Минимум 15% — негативные кейсы: ответа в базе нет, ожидается отказ.',
    'Опишите правила разметки в `eval/golden/README.md` — что считается правильным ответом.',
    'Скрипт загрузки в Langfuse Dataset (имя `rag-golden`, версия в метаданных) через SDK.',
    'Подтверждение: файл датасета в git и скриншот Dataset в Langfuse.',
  ],
  F4: [
    '`eval/run_experiment.py` вызывает `/v1/rag/answer` для каждого item и сохраняет run. Backend: Mac DMR 3B/7B Q4_K_M или измеренный Windows 0.5B/3B BF16/7B AWQ; 7B AWQ revision b25037543e9394b818fdfca67ab2a00ecc7dd641, half/awq_marlin, util 0.85, 8192, 2, eager/batch tokens 512, peak 7448 МиБ. Не держите baseline и candidate одновременно на RTX 4060.',
    'Детерминированные оценки на каждый item: есть ссылки на источники; корректный отказ для `must_refuse`; доля `expected_facts`, найденных в ответе; latency; стоимость.',
    'Имя запуска: `baseline-<git_sha>-<prompt_version>`.',
    'Посмотрите в Langfuse агрегаты и отдельные items.',
    'Подтверждение: скриншот запуска с оценками и коммит скрипта.',
  ],
  F5: [
    'Измените rag_v2, top_k или chunk size; модель и backend оставьте как в baseline C2. Для отдельного сравнения моделей берите уже измеренные Qwen/DMR-профили и неизменный dataset/evaluator. Вторая семья, guard и TinyLlama GGUF/AWQ/FP16 пока кандидаты для следующего Windows-замера, их профили ещё не подтверждены.',
    'Запустите тот же скрипт на той же версии датасета с именем `candidate-<git_sha>-<prompt_version>`.',
    'Запишите, что изменили и какую гипотезу проверяете.',
    'Подтверждение: скриншот второго запуска.',
  ],
  F6: [
    'Напишите judge-промпт с рубрикой для groundedness (каждое утверждение ответа подтверждено фрагментами: 1 / частично 0.5 / нет 0) и relevance (ответ по вопросу).',
    'Подключите judge в evaluator через gateway C2 (локальный Mac DMR или Windows vLLM) либо внешний/managed evaluator; temperature 0, identity/decoding фиксированы. Если judge локальный на Windows, выгружайте генератор перед judge-run и сохраните его ответы. Guard-модель отдельно проверяет safety, а не заменяет judge groundedness; её аппаратный профиль пока не измерен.',
    'Разметьте вручную 20 items по той же рубрике и посчитайте согласие с judge (доля совпадений, Cohen\'s kappa).',
    'Опишите ограничения: искажения, стоимость прогона, разброс при повторах.',
    'Подтверждение: таблица согласия и коммит judge-промпта.',
  ],
  F7: [
    'Сравните baseline и candidate в Langfuse (Compare): агрегаты по всем оценкам и таблица по items.',
    'Найдите items, где candidate стал хуже (groundedness, отказ, факты), и разберите 3–5 из них по трейсам: что именно сломалось.',
    'Если регрессии нет — создайте её осознанно (например, top_k=1 или шаблон без требования ссылок) и покажите, как метрики её ловят.',
    'Напишите `docs/decisions/0001-candidate-rejected.md`: что сравнивали, цифры, разобранные примеры, решение и почему.',
    'Подтверждение: decision record и скриншот сравнения.',
  ],
  F8: [
    'Сделайте фоновую задачу, которая раз в N минут берёт случайные 5% новых продакшен-трейсов RAG из Langfuse.',
    'Для каждого — judge-оценки без эталона: groundedness, relevance, корректность отказа; запишите их scores в Langfuse.',
    'Экспортируйте скользящее среднее оценок в Prometheus и поставьте алерт на падение ниже порога (например, groundedness < 0.75 за 1 час).',
    'Трейсы с низкой оценкой автоматически добавляйте в annotation queue для ручного разбора.',
    'Сымитируйте деградацию (сломайте шаблон или поиск) и покажите срабатывание алерта.',
    'Разберите 5 плохих трейсов и добавьте их в golden dataset (новая версия).',
    'Подтверждение: скриншот алерта, коммит и запись в журнале о найденной проблеме.',
  ],

  // ── G CI/CD ────────────────────────────────────────────────────────────────
  G1: [
    'Создайте `.gitlab-ci.yml` со стадиями: `lint`, `test`, `build`, `integration`, `eval`.',
    '`lint` и `test`: ruff, mypy, pytest с JUnit-отчётом (`--junitxml=report.xml`, `artifacts: reports: junit`).',
    '`build`: образ gateway с тегом `$CI_COMMIT_SHORT_SHA`, push в registry проекта.',
    '`integration`: job с `services:` — `pgvector/pgvector:pg17` (alias `db`) и mock-LLM (ваш MockProvider как отдельный образ), запуск собранного gateway, ingest тестовых документов, smoke-тест API.',
    '`eval`: запуск `eval/run_experiment.py` на golden dataset (детерминированные проверки обязательно, judge — опционально), результат — JUnit-отчёт по items и `eval/report.json` как artifact.',
    'Ограничьте `eval` через `rules: changes` (prompts/, rag/, eval/, gateway/) и плюс запуск по расписанию.',
    'Можно на gitlab.com или с локальным GitLab Runner в Docker.',
    'Подтверждение: ссылка на зелёный pipeline.',
  ],
  G2: [
    'Создайте `eval/thresholds.yaml`: абсолютные пороги (groundedness ≥ 0.8, refusal_accuracy ≥ 0.9, recall@5 ≥ 0.85) и допуск регрессии относительно baseline (не более 3 п.п.).',
    'Сохраните утверждённый baseline в `eval/baseline.json` (метрики последнего принятого main).',
    'Скрипт `eval/gate.py`: сравнивает `report.json` с порогами и baseline, печатает таблицу и завершается с кодом 1 при нарушении.',
    'Сделайте MR с ухудшающим изменением промпта — pipeline должен упасть на `eval`.',
    'Сделайте MR с улучшающим изменением — pipeline зелёный; обновление baseline — отдельным осознанным коммитом.',
    'Подтверждение: ссылки на красный и зелёный pipeline.',
  ],
  G3: [
    'Вариант попроще: weighted routing в gateway — заголовок или процент трафика на `prompt_version=rag_v2`; метрики и трейсы с лейблом версии.',
    'Вариант ближе к проду: kind или k3d, Argo Rollouts, `Rollout` со стратегией canary (`setWeight: 20`, `pause`, `setWeight: 50`, ...) и `AnalysisTemplate` с Prometheus-запросами на долю ошибок и p95.',
    'Правило: abort при доле ошибок > 2% или росте p95 > 20% относительно stable.',
    'Выкатите заведомо плохую версию (например, с задержкой или ошибками) и покажите автоматический abort.',
    'Подтверждение: скриншот или лог abort и манифесты в репозитории.',
  ],
  G4: [
    'Определите, что составляет версию системы: образ gateway (sha), alias модели, prompt_version, версия индекса.',
    'Пишите все четыре значения в атрибуты трейса, лейблы метрик и логи.',
    'Подготовьте откат одной командой (`make rollback` или job в GitLab): возврат предыдущего образа (GitLab environment или revert в GitOps-репозитории), alias модели и prompt_version.',
    'Проведите учения: выкатите новую версию, затем откатите; замерьте время и проверьте по трейсу, что запросы обслуживает старая версия.',
    'Напишите `docs/runbooks/rollback.md`.',
    'Подтверждение: runbook, замер времени и скриншот трейса.',
  ],
  G5: [
    'Перечислите stateful-компоненты: pgvector-БД, БД gateway (usage, jobs), MLflow (PostgreSQL + MinIO), Langfuse (PostgreSQL + ClickHouse + MinIO).',
    'Для каждого — способ бэкапа (pgBackRest или pg_dump, бэкап ClickHouse по документации, `mc mirror` для MinIO) и частоту.',
    'Сделайте скрипт бэкапа и восстановления.',
    'Restore drill: поднимите чистое окружение, восстановите всё, проверьте: поиск работает, трейсы Langfuse открываются, модель грузится из MLflow.',
    'Замерьте RTO и оцените RPO.',
    'Подтверждение: `docs/runbooks/restore.md` с замерами.',
  ],
  G6: [
    'В `ai-platform-labs/infra/terraform/` — `compose.yaml`: сервис `tfstate` (`postgres:16-alpine`, база и пользователь `terraform`, порт `127.0.0.1:5433`) и сервис `terraform` (`hashicorp/terraform:1.13`, папка `infra/terraform` смонтирована в `/work`, `working_dir: /work`, сокет Docker — для провайдера). Команды: `docker compose run --rm terraform -chdir=envs/dev init`.',
    'Модуль `modules/service`: `docker_image` и `docker_container` провайдера `kreuzwerker/docker` (образ, порты, env, том, healthcheck, лимит памяти), переменные с типами и `validation`, outputs — имя и порт. Версия модуля — git-тег `service-v0.1.0`; окружения подключают его через `source = "git::…//infra/terraform/modules/service?ref=service-v0.1.0"`, чтобы обновляться осознанно.',
    'Окружения `envs/dev` и `envs/stage`: один модуль, разные параметры (порты Qdrant 6333 и 6343, лимит памяти, тег образа). Backend в каждом — `backend "pg" { schema_name = "dev" }` (у stage — `"stage"`), строка подключения — в переменной окружения `PG_CONN_STR` (`postgres://terraform:…@tfstate/terraform?sslmode=disable`), не в коде.',
    'Блокировка: запустите `apply` в dev в двух терминалах одновременно — второй ждёт (`-lock-timeout=60s`) или падает с «Error acquiring the state lock». Посмотрите блокировку в PostgreSQL: `SELECT * FROM pg_locks WHERE locktype = \'advisory\';`.',
    'CI в `.gitlab-ci.yml` из G1: job `tf-plan` — `terraform plan -out=tfplan`, план сохраняется артефактом, а `terraform show -no-color tfplan` выводится в лог MR; job `tf-apply` — `when: manual` только в `main`, применяет сохранённый `tfplan`. Раннер — локальный из G1 с сокетом Docker; state для него — `host.docker.internal:5433`.',
    'Дрейф: удалите контейнер stage руками (`docker rm -f …`) и выполните `terraform plan -detailed-exitcode` — код 2 означает изменения. Добавьте job `tf-drift` по расписанию (`rules: - if: $CI_PIPELINE_SOURCE == "schedule"`), который падает при коде 2.',
    'Рефакторинг без пересоздания: переименуйте `module "qdrant"` в `module "vector_db"` и добавьте блок `moved` с `from = module.qdrant` и `to = module.vector_db` — plan должен показать перемещение, а не destroy и create.',
    'Подтверждение: `infra/terraform/README.md` — схема state по окружениям, вывод второго apply с ожиданием блокировки, ссылка на MR с планом и на упавший job дрейфа.',
  ],

  // ── H GPU ──────────────────────────────────────────────────────────────────
  H1: [
    'Установите NVIDIA Container Toolkit в WSL по официальной инструкции (или включите GPU-поддержку в Docker Desktop с бэкендом WSL2).',
    'Проверьте: `docker run --rm --gpus all nvidia/cuda:<версия>-base-ubuntu24.04 nvidia-smi` — версию CUDA в теге выберите не новее той, что показывает `nvidia-smi` на хосте.',
    'Запустите vLLM из образа: `docker run --gpus all -p 8000:8000 -v ~/.cache/huggingface:/root/.cache/huggingface vllm/vllm-openai --model Qwen/Qwen2.5-1.5B-Instruct --max-model-len 4096 --gpu-memory-utilization 0.85`.',
    'Проверьте `/v1/models`.',
    'Подтверждение: вывод `nvidia-smi` из контейнера и ответ vLLM.',
  ],
  H3: [
    'Поднимите minikube с GPU: `minikube start --driver docker --container-runtime docker --gpus all` (или k3s внутри WSL).',
    'Установите NVIDIA device plugin через Helm: репозиторий `https://nvidia.github.io/k8s-device-plugin`, chart `nvidia-device-plugin`.',
    'Проверьте `kubectl describe node` — в Allocatable должен появиться `nvidia.com/gpu: 1`.',
    'Запустите pod с `resources.limits: {nvidia.com/gpu: 1}` и командой `nvidia-smi`.',
    'Если в WSL не взлетает — отметьте «Заблокировано» с описанием ошибки или повторите на облачной GPU-VM.',
    'Подтверждение: вывод describe node и лог pod.',
  ],
  H4: [
    'Установите GPU Operator: Helm-репозиторий `https://helm.ngc.nvidia.com/nvidia`, chart `nvidia/gpu-operator`, `--set driver.enabled=false` (драйвер уже на хосте).',
    'Дождитесь, пока все pods в namespace `gpu-operator` станут Ready, и посмотрите логи validator.',
    'Найдите на ноде labels от GPU Feature Discovery (`nvidia.com/gpu.product` и др.).',
    'Запишите назначение каждого компонента оператора.',
    'Если окружение не позволяет — «Заблокировано» или облачная GPU-VM на пару часов.',
    'Подтверждение: `kubectl get pods -n gpu-operator` и labels ноды.',
  ],
  H5: [
    'Убедитесь, что dcgm-exporter (из GPU Operator или отдельно) отдаёт метрики.',
    'Подключите к Prometheus через ServiceMonitor или статический scrape.',
    'Добавьте в дашборд D2 панели: `DCGM_FI_DEV_GPU_UTIL`, `DCGM_FI_DEV_FB_USED`, `DCGM_FI_DEV_POWER_USAGE`, температура, XID errors — рядом с метриками vLLM.',
    'Алерты: XID errors > 0, температура выше порога.',
    'Подтверждение: скриншот дашборда.',
  ],
  H7: [
    'Исходные данные: результаты benchmark из C3 (сколько параллельных запросов держит одна реплика в рамках SLO TTFT) и расчёт памяти из C0.1.',
    'Задайте сценарий нагрузки: пиковые параллельные запросы, средняя длина prompt и ответа, SLO на TTFT.',
    'Посчитайте число реплик (с округлением вверх и запасом N+1) и тип GPU.',
    'Посчитайте стоимость: GPU-часы × цена, стоимость 1M токенов при вашей утилизации; сравните с ценой внешнего провайдера.',
    'Опишите допущения и риски (пики, длинные контексты, рост трафика).',
    'Подтверждение: `docs/capacity.md`.',
  ],
  // пакеты контента (src/data/packs)
  ...packLabSteps,
}

// Проверки — подсказки для самопроверки, не автозачёт критериев задачи.
export interface LabStepCheck { command: string; expected: string; scope: string }
export const labStepChecks: Record<string, LabStepCheck[]> = {
  "A0.1": [
    {
      "command": "git ls-files",
      "expected": "В репозитории есть gateway/, worker/, ml/, rag/, eval/, infra/ и docs/evidence/; пустые каталоги Git не сохраняет.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "uv tree --directory gateway",
      "expected": "uv читает pyproject.toml пакета gateway без ошибки; src-layout виден в дереве файлов.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "uv tree --directory gateway --all-groups",
      "expected": "В дереве есть пять runtime-зависимостей и pytest, pytest-asyncio, ruff, mypy из dev-группы.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "python -c \"import tomllib; print(tomllib.load(open('gateway/pyproject.toml','rb'))['tool'])\"",
      "expected": "В ruff заданы line-length и E,F,I,B,UP, в mypy — strict=true.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "make -C gateway -n lint fmt typecheck test",
      "expected": "Четыре цели вызывают нужные инструменты через uv, команда fmt использует ruff format.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "uv sync --directory gateway --locked",
      "expected": "Lock-файл согласован с pyproject.toml. Затем в чистом клоне выполните цели lint, typecheck и test — все завершаются кодом 0.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "git show --stat --oneline HEAD",
      "expected": "В коммите и приложенном отчёте доступны ссылка на репозиторий и коммит с этой структурой. Проверьте доступность каждого файла или ссылки.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    }
  ],
  "A0.2": [
    {
      "command": "uv run --directory gateway pytest -v",
      "expected": "Тест ловит каждое специализированное исключение как ProviderError; у экземпляра сохранён provider.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "uv run --directory gateway pytest -v",
      "expected": "ProviderConfig и Usage имеют заданные поля; попытка изменить frozen dataclass запрещена.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "uv run --directory gateway mypy src --strict",
      "expected": "Реализация Provider проходит проверку Protocol с async chat и указанными типами.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "uv run --directory gateway pytest -v",
      "expected": "timed() выдаёт неотрицательную длительность и корректно завершает блок при исключении.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "git show --stat --oneline HEAD",
      "expected": "В заметке сформулированы собственные примеры функций, классов и исключений; одной отметки о чтении недостаточно.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "uv run --directory gateway mypy src --strict",
      "expected": "Код проходит strict-проверку без ошибок и без отключения проверки проблемного модуля.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "git show --stat --oneline HEAD",
      "expected": "В коммите и приложенном отчёте доступны коммит с этими модулями. Проверьте доступность каждого файла или ссылки.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    }
  ],
  "A0.3": [
    {
      "command": "uv run --directory gateway pytest -v",
      "expected": "Тесты создают Message, ChatRequest и ChatResponse с ожидаемыми типами и обязательными полями.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "uv run --directory gateway pytest -v",
      "expected": "Пустые messages, max_tokens вне 1–4096 и temperature вне 0–2 дают ValidationError; границы допустимы.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "uv run --directory gateway pytest -v",
      "expected": "Настройки читаются из GATEWAY_*; api_key хранится как SecretStr. Тест использует выдуманный ключ.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "git ls-files gateway/.env gateway/.env.example gateway/.gitignore",
      "expected": "В Git есть .env.example и правило исключения .env; настоящий .env не отслеживается.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "uv run --directory gateway pytest -v",
      "expected": "Невалидный запрос выдаёт понятную ValidationError; строковое представление Settings скрывает тестовый ключ.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "git show --stat --oneline HEAD",
      "expected": "В коммите и приложенном отчёте доступны коммит и вывод валидационной ошибки в заметке. Проверьте доступность каждого файла или ссылки.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    }
  ],
  "A0.4": [
    {
      "command": "uv run --directory gateway pytest -v",
      "expected": "Лог содержит уровень, timestamp в ISO-формате и поля contextvars; JSONRenderer не выдаёт Python repr.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "uv run --directory gateway pytest -v",
      "expected": "Два запроса имеют разные request_id; контекст первого не протекает во второй.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "uv run --directory gateway pytest -v",
      "expected": "request_finished содержит path, status, latency_ms, provider и model.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "uv run --directory gateway python app.py",
      "expected": "Каждая строка прикладного лога разбирается как JSON; диагностические сообщения сервера не смешиваются с ней. Для pipe в jq нужен контейнер с обоими инструментами.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "git show --stat --oneline HEAD",
      "expected": "В коммите и приложенном отчёте доступны коммит и пример строк лога в заметке. Проверьте доступность каждого файла или ссылки.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    }
  ],
  "A0.5": [
    {
      "command": "uv run --directory gateway python scripts/async_demo.py",
      "expected": "50 запросов с Semaphore(10) выполняются примерно пятью партиями; сравнение идёт на одном локальном mock с задержкой 1 с.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "uv run --directory gateway pytest -v",
      "expected": "Задержка за пределами 8 с приводит к TimeoutError; оставшиеся операции отменяются и клиент закрывается.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "uv run --directory gateway pytest -v",
      "expected": "На одной падающей операции зафиксировано отличие gather от TaskGroup в отмене соседних задач.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "uv run --directory gateway pytest -v",
      "expected": "Timeout и 5xx повторяются с ограничением попыток и jitter; 4xx не повторяются.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "uv run --directory gateway python scripts/async_demo.py",
      "expected": "Таблица показывает последовательное ожидание при time.sleep и конкурентное при asyncio.sleep на тех же десяти задачах.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "git show --stat --oneline HEAD",
      "expected": "В коммите и приложенном отчёте доступны коммит со скриптом и таблица замеров в заметке. Проверьте доступность каждого файла или ссылки.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    }
  ],
  "A0.6": [
    {
      "command": "uv run --directory gateway pytest --fixtures",
      "expected": "В списке есть settings и fake_provider; settings имеет scope=session.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "uv run --directory gateway pytest -v",
      "expected": "Все три пары исключение → HTTP-статус проходят как отдельные параметризованные случаи.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "uv run --directory gateway pytest -v",
      "expected": "Async-тест с MockTransport разбирает заданный JSON; внешний API не требуется.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "uv run --directory gateway pytest -v",
      "expected": "httpx.ReadTimeout становится ProviderTimeout с сохранённым контекстом провайдера.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "git show --stat --oneline HEAD",
      "expected": "В коммите и приложенном отчёте доступны коммит и вывод `uv run pytest -v`. Проверьте доступность каждого файла или ссылки.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    }
  ],
  "A1": [
    {
      "command": "endpoint-check --help",
      "expected": "В help есть config, timeout, retries и output; неверный параметр даёт ошибку CLI.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "python -c \"from pathlib import Path; print(Path('tools/endpoint-check/endpoints.yaml').read_text())\"",
      "expected": "У каждого endpoint есть name, base_url и имя переменной api_key_env; настоящий ключ не записан в файл.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "endpoint-check --config tools/endpoint-check/endpoints.yaml --timeout 5 --retries 2 --output json",
      "expected": "Вывод содержит результаты health (если поддерживается), models и короткого chat; общий клиент не создаётся на каждый запрос.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "endpoint-check --config tools/endpoint-check/endpoints.yaml --output table",
      "expected": "У каждой строки есть endpoint, проверка, статус, latency_ms и описание ошибки.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "endpoint-check --config tools/endpoint-check/endpoints.yaml --output json",
      "expected": "Сравните код выхода на доступной цели (0), недоступной (1) и невалидном конфиге (2); вывод не должен маскировать частичный сбой.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "endpoint-check --config tools/endpoint-check/endpoints.yaml --timeout 5 --retries 2 --output table",
      "expected": "Рабочая цель успешна, несуществующая не зависает и выдаёт понятный симптом.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "git show --stat --oneline HEAD",
      "expected": "В коммите и приложенном отчёте доступны Опишите запуск в README папки. Подтверждение: коммит и вывод CLI в обоих режимах. Проверьте доступность каждого файла или ссылки.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    }
  ],
  "A2": [
    {
      "command": "uv run --directory gateway pytest -v",
      "expected": "Lifespan создаёт один AsyncClient и закрывает его при остановке приложения.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "uv run --directory gateway pytest -v",
      "expected": "MockProvider возвращает последнее сообщение и использует настраиваемую задержку.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "uv run --directory gateway pytest -v",
      "expected": "POST /v1/chat принимает ChatRequest и ограничивает ожидание провайдера.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "uv run --directory gateway pytest -v",
      "expected": "Timeout → 504, недоступность → 502, плохой запрос → 400, невалидная модель запроса → 422; тело содержит тип и провайдера.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "curl --fail http://gateway:8080/ready",
      "expected": "Ready отвечает 200 только после настройки провайдеров и создания клиента; health отражает жизнь процесса.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "docker compose logs --tail 20 gateway",
      "expected": "В каждой строке завершённого запроса есть request_id, provider, latency_ms и status; API-ключи отсутствуют.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "docker compose ps gateway",
      "expected": "Образ собран, процесс остаётся запущенным, нужный порт слушается внутри контейнера.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "git show --stat --oneline HEAD",
      "expected": "В коммите и приложенном отчёте доступны Проверьте curl-ом успешный запрос, невалидный запрос и таймаут (поставьте задержку mock больше таймаута). Подтверждение: коммит, вывод curl и строки логов. Проверьте доступность каждого файла или ссылки.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    }
  ],
  "A3": [
    {
      "command": "uv run --directory gateway pytest -v",
      "expected": "Тестовый AsyncClient использует ASGITransport и тестовый base_url; реальный сервер не обязателен.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "uv run --directory gateway pytest -v",
      "expected": "Fake-провайдер подменяет внешний вызов; после теста override удалён.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "uv run --directory gateway pytest -v",
      "expected": "Есть успешный ответ, 422, 504, 502 и проверки двух health-эндпоинтов; все случаи выполняются.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "uv run --directory gateway pytest -v",
      "expected": "Чистые функции проверяются без HTTP и без доступа в интернет.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "uv run --directory gateway pytest --cov=gateway --cov-report=term-missing",
      "expected": "Критичный путь покрыт на 80% или больше; проверьте непокрытые строки, а не только общую цифру.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "uv run --directory gateway mypy src --strict",
      "expected": "mypy проходит; отдельно ruff check . в gateway завершается кодом 0.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "git show --stat --oneline HEAD",
      "expected": "В коммите и приложенном отчёте доступны коммит и вывод pytest с покрытием. Проверьте доступность каждого файла или ссылки.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    }
  ],
  "A4": [
    {
      "command": "docker compose ps",
      "expected": "Kafka и PostgreSQL доступны; в брокере существуют llm.jobs и llm.jobs.dlq.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "psql -h postgres -U USER -d DATABASE -c \"\\d jobs\"",
      "expected": "Таблица jobs содержит id primary key, status, payload, result, attempts и updated_at; USER/DATABASE замените своими значениями.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "docker compose logs --tail 30 worker",
      "expected": "Consumer входит в llm-worker; автокоммит отключён в конфигурации и это видно в тесте.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "uv run --directory gateway pytest -v",
      "expected": "Повторное сообщение с уже done id не вызывает провайдера второй раз; результат записывается до подтверждения сообщения.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "uv run --directory gateway pytest -v",
      "expected": "После трёх неудачных попыток сообщение оказывается в DLQ с типом/сообщением ошибки, jobs.status=failed.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "uv run --directory gateway pytest -v",
      "expected": "Падающая запись результата не приводит к commit offset.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "docker compose logs --tail 50 worker",
      "expected": "При SIGTERM новый приём прекращается, текущая обработка завершается, consumer закрывается.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "psql -h postgres -U USER -d DATABASE -c \"SELECT id,status,attempts FROM jobs ORDER BY updated_at DESC LIMIT 20\"",
      "expected": "После учений все 20 jobs завершены без дублей; при недоступном gateway видны failed и сообщения DLQ.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "git show --stat --oneline HEAD",
      "expected": "В коммите и приложенном отчёте доступны коммит, вывод проверки и состояние таблицы `jobs` до и после. Проверьте доступность каждого файла или ссылки.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    }
  ],
  "B1": [
    {
      "command": "uv tree --directory ml",
      "expected": "В зависимостях есть scikit-learn, pandas и joblib.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "git ls-files ml",
      "expected": "Датасет или воспроизводимый источник зафиксирован; известны метки классов и объём выборки.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "uv run --directory ml python train.py",
      "expected": "Обучение использует stratified split с seed=42 и единый Pipeline TF-IDF + LogisticRegression.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "python -m json.tool ml/metrics.json",
      "expected": "В метриках есть precision, recall, f1 и support по классам, а не только accuracy.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "python -m json.tool ml/artifacts/meta.json",
      "expected": "Артефакт модели существует; meta содержит SHA-256 данных, seed и версии зависимостей.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "uv run --directory ml python train.py",
      "expected": "Два прогона на одной выборке дают одинаковые метрики; сравните сохранённые результаты, не перезаписывая baseline.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "git show --stat --oneline HEAD",
      "expected": "В коммите и приложенном отчёте доступны коммит и `metrics.json` двух запусков. Проверьте доступность каждого файла или ссылки.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    }
  ],
  "B2": [
    {
      "command": "docker compose ps",
      "expected": "MinIO и PostgreSQL доступны, бакет mlflow создан.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "curl --fail http://mlflow:5000/health",
      "expected": "MLflow отвечает, backend хранится в PostgreSQL, артефакты доступны через MinIO.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "python -c \"from mlflow import MlflowClient; print(MlflowClient().search_experiments())\"",
      "expected": "Эксперимент ticket-clf содержит runs с параметрами, метриками, git_sha, dataset_sha256 и metrics.json.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "python -c \"from mlflow import MlflowClient; print(MlflowClient().get_run('RUN_ID').info.artifact_uri)\"",
      "expected": "Подставьте RUN_ID своего запуска: модель сохранена в его артефактах и загружается с конфигурацией зависимостей.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "python -c \"from mlflow import MlflowClient; print(MlflowClient().search_experiments())\"",
      "expected": "В Compare runs есть минимум три запуска с разными параметрами; сравнение использует одну выборку.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "curl --fail http://mlflow:5000/health",
      "expected": "После пересоздания сервисов прежние runs и артефакты доступны, включая загрузку модели.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "git show --stat --oneline HEAD",
      "expected": "В коммите и приложенном отчёте доступны скриншот сравнения запусков и коммит. Проверьте доступность каждого файла или ссылки.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    }
  ],
  "B3": [
    {
      "command": "python -c \"from mlflow import MlflowClient; print(MlflowClient().search_model_versions('name=\"ticket-clf\"'))\"",
      "expected": "В registry есть две разные версии ticket-clf, связанные со своими runs.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "python -c \"from mlflow import MlflowClient; print(MlflowClient().get_registered_model('ticket-clf').aliases)\"",
      "expected": "Champion ссылается на v1, candidate — на v2; aliases не заменяют историю версий.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "python -c \"from mlflow import MlflowClient; print(MlflowClient().get_model_version('ticket-clf','2').tags)\"",
      "expected": "У версии присутствуют dataset_sha256, git_sha и f1.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "uv run --directory ml python promote.py",
      "expected": "Dry-run печатает сравнение f1/recall и решение, не переносит alias; перенос проверяется отдельно с --apply.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "git show --stat --oneline HEAD",
      "expected": "В заметке есть различие версии артефакта модели и версии приложения с примером независимого изменения.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "git show --stat --oneline HEAD",
      "expected": "В коммите и приложенном отчёте доступны скриншот registry с aliases и вывод `promote.py`. Проверьте доступность каждого файла или ссылки.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    }
  ],
  "B4": [
    {
      "command": "curl --fail http://model-api:8000/health",
      "expected": "Сервис загрузил models:/ticket-clf@champion; predict работает с моделью из registry.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "docker compose logs --tail 20 model-api",
      "expected": "Health и строки запросов показывают реальную загруженную версию, а не текущий alias без reload.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "curl --fail http://model-api:8000/health",
      "expected": "После admin reload загруженная версия меняется без рестарта процесса.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "curl --fail http://model-api:8000/health",
      "expected": "После promote и reload health показывает v2; ответы обслуживает новая модель.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "curl --fail http://model-api:8000/health",
      "expected": "После отката alias и reload health показывает v1; в отчёте измерено время восстановления.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "git show --stat --oneline HEAD",
      "expected": "В коммите и приложенном отчёте доступны коммит и лог с переключением версий. Проверьте доступность каждого файла или ссылки.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    }
  ],
  "B5": [
    {
      "command": "git ls-files ml",
      "expected": "Сохранены reference и сдвинутая выборки; различие распределения воспроизводится.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "uv run --directory ml python drift.py",
      "expected": "PSI рассчитан по бинам reference; пустые бины не дают бесконечность или NaN.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "git ls-files ml",
      "expected": "HTML-отчёт Evidently открывается; вывод сопоставлен с PSI на тех же данных.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "curl --fail http://model-api:8000/metrics",
      "expected": "PSI экспортируется gauge; при контролируемом сдвиге правило >0.25 ловит симптом.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "git show --stat --oneline HEAD",
      "expected": "Заметка различает изменение входного распределения и изменение связи вход → целевая переменная.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "git show --stat --oneline HEAD",
      "expected": "В коммите и приложенном отчёте доступны HTML-отчёт Evidently (путь или скриншот) и коммит. Проверьте доступность каждого файла или ссылки.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    }
  ],
  "C0.1": [
    {
      "command": "python -c \"import json; print(json.load(open('models/Qwen2.5-3B-Instruct/config.json')))\"",
      "expected": "Для 3B проверьте 36 layers, 2 KV heads и head_dim 128 по закреплённому config.",
      "scope": "Команды Python/curl — в контейнере клиента своего ai-platform-labs; Docker CLI — из терминала Docker Desktop/WSL. Профиль backend выбран по C2, на Mac C1/C3 не подтверждают CUDA."
},
    {
      "command": "python -c \"print(2*36*2*128*2)\"",
      "expected": "36864 байта на token KV, без overhead.",
      "scope": "Команды Python/curl — в контейнере клиента своего ai-platform-labs; Docker CLI — из терминала Docker Desktop/WSL. Профиль backend выбран по C2, на Mac C1/C3 не подтверждают CUDA."
},
    {
      "command": "python -c \"print(1.5e9*2/2**30)\"",
      "expected": "Оценка весов около 2.8 GiB; точное число параметров и служебную память считайте отдельно.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "docker compose logs --tail 100 vllm",
      "expected": "В расчёте разделены CUDA free, память весов, KV и runtime; оценка не выдана за гарантированный лимит.",
      "scope": "Команды Python/curl — в контейнере клиента своего ai-platform-labs; Docker CLI — из терминала Docker Desktop/WSL. Профиль backend выбран по C2, на Mac C1/C3 не подтверждают CUDA."
},
    {
      "command": "docker compose logs --tail 100 vllm",
      "expected": "В логе есть фактический размер KV cache; отличие от оценки объяснено служебной памятью и реализацией.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "python -c \"print(7e9*2/2**30)\"",
      "expected": "Одни веса 7B BF16 превышают 8 GiB; KV cache и runtime делают требование ещё больше.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "git show --stat --oneline HEAD",
      "expected": "В коммите и приложенном отчёте доступны расчёт в заметке и строка лога vLLM. Проверьте доступность каждого файла или ссылки.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    }
  ],
  "C1": [
    {
      "command": "docker model list",
      "expected": "На Mac DMR имеет выбранную модель; C1 остаётся заблокированной до NVIDIA-практики. На Windows установлен совместимый host driver.",
      "scope": "Команды Python/curl — в контейнере клиента своего ai-platform-labs; Docker CLI — из терминала Docker Desktop/WSL. Профиль backend выбран по C2, на Mac C1/C3 не подтверждают CUDA."
},
    {
      "command": "python -c \"import torch; print(torch.ones(2,device='cuda').sum().item(), torch.cuda.get_device_name(0))\"",
      "expected": "Сумма равна 2.0 и указан RTX 4060; проверка выполнена в том же GPU-контейнере.",
      "scope": "Команды Python/curl — в контейнере клиента своего ai-platform-labs; Docker CLI — из терминала Docker Desktop/WSL. Профиль backend выбран по C2, на Mac C1/C3 не подтверждают CUDA."
},
    {
      "command": "docker compose config",
      "expected": "GPU request и папка cache заданы; image/revision сохранены.",
      "scope": "Команды Python/curl — в контейнере клиента своего ai-platform-labs; Docker CLI — из терминала Docker Desktop/WSL. Профиль backend выбран по C2, на Mac C1/C3 не подтверждают CUDA."
},
    {
      "command": "curl --fail http://vllm:8000/v1/models",
      "expected": "Ready endpoint возвращает зарегистрированную 0.5B; короткий chat запрос успешен.",
      "scope": "Команды Python/curl — в контейнере клиента своего ai-platform-labs; Docker CLI — из терминала Docker Desktop/WSL. Профиль backend выбран по C2, на Mac C1/C3 не подтверждают CUDA."
},
    {
      "command": "docker compose logs --tail 100 vllm",
      "expected": "Параметры совпадают с выбранным профилем; CUDA memory budget и KV capacity записаны отдельно.",
      "scope": "Команды Python/curl — в контейнере клиента своего ai-platform-labs; Docker CLI — из терминала Docker Desktop/WSL. Профиль backend выбран по C2, на Mac C1/C3 не подтверждают CUDA."
},
    {
      "command": "curl --fail http://vllm:8000/v1/models",
      "expected": "На Windows inference на выбранной модели успешен; длина учитывает prompt + output.",
      "scope": "Команды Python/curl — в контейнере клиента своего ai-platform-labs; Docker CLI — из терминала Docker Desktop/WSL. Профиль backend выбран по C2, на Mac C1/C3 не подтверждают CUDA."
},
    {
      "command": "git diff HEAD -- docs/serving-environment.md",
      "expected": "Отчёт содержит реальные версии и замеры именно своего запуска.",
      "scope": "Команды Python/curl — в контейнере клиента своего ai-platform-labs; Docker CLI — из терминала Docker Desktop/WSL. Профиль backend выбран по C2, на Mac C1/C3 не подтверждают CUDA."
},
    {
      "command": "git show --stat --oneline HEAD",
      "expected": "В коммите и приложенном отчёте доступны вывод `/v1/models` и `nvidia-smi` (скриншот или текст). Проверьте доступность каждого файла или ссылки.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    }
  ],
  "C2": [
    {
      "command": "python scripts/chat_probe.py",
      "expected": "Chat успешен; профиль backend и usage сохранены.",
      "scope": "Команды Python/curl — в контейнере клиента своего ai-platform-labs; Docker CLI — из терминала Docker Desktop/WSL. Профиль backend выбран по C2, на Mac C1/C3 не подтверждают CUDA."
},
    {
      "command": "python scripts/stream_ttft.py",
      "expected": "Скрипт считает время до первого непустого delta.content, не до заголовков ответа или finish-события.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "python scripts/stream_ttft.py",
      "expected": "Оба входа посчитаны tokenizer; измерение длинного DMR-входа не объявлено заранее пройденным.",
      "scope": "Команды Python/curl — в контейнере клиента своего ai-platform-labs; Docker CLI — из терминала Docker Desktop/WSL. Профиль backend выбран по C2, на Mac C1/C3 не подтверждают CUDA."
},
    {
      "command": "python scripts/stream_ttft.py",
      "expected": "Для temperature 0 и 1 сохранены по три ответа на один prompt; условия кроме temperature одинаковы.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "git show --stat --oneline HEAD",
      "expected": "В коммите и приложенном отчёте доступны коммит скрипта и таблица TTFT. Проверьте доступность каждого файла или ссылки.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    }
  ],
  "C3": [
    {
      "command": "vllm bench serve --help",
      "expected": "Backend/endpoint и модель совпадают; NVIDIA-задача на Mac не получает зачёт по DMR.",
      "scope": "Команды Python/curl — в контейнере клиента своего ai-platform-labs; Docker CLI — из терминала Docker Desktop/WSL. Профиль backend выбран по C2, на Mac C1/C3 не подтверждают CUDA."
},
    {
      "command": "python scripts/stream_ttft.py",
      "expected": "Таблица разделяет client concurrency и engine max-num-seqs.",
      "scope": "Команды Python/curl — в контейнере клиента своего ai-platform-labs; Docker CLI — из терминала Docker Desktop/WSL. Профиль backend выбран по C2, на Mac C1/C3 не подтверждают CUDA."
},
    {
      "command": "python -c \"import csv; print(list(csv.DictReader(open('docs/evidence/C3.csv')))[:20])\"",
      "expected": "Для входов 256,1024,3000 фиксированы concurrency и output length.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "python -c \"import csv; print(list(csv.DictReader(open('docs/evidence/C3.csv')))[:20])\"",
      "expected": "Серия request-rate=1,4,8,inf отделена от серии max-concurrency.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "python -c \"import csv; print(next(csv.DictReader(open('docs/evidence/C3.csv'))))\"",
      "expected": "У каждой строки есть TTFT p50/p95, TPOT, tokens/s, доля ошибок и параметры запуска с единицами.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "curl --fail http://vllm:8000/metrics",
      "expected": "В точке роста TTFT сохранены waiting и KV cache; вывод объясняет очередь и насыщение, а не только большую цифру.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "python -c \"import csv; print(list(csv.DictReader(open('docs/evidence/C3.csv')))[-2:])\"",
      "expected": "Два сравниваемых запуска различаются только prefix caching; префикс одинаков, холодный и тёплый режимы отмечены.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "git show --stat --oneline HEAD",
      "expected": "В коммите и приложенном отчёте доступны CSV с результатами, график (можно в ноутбуке) и выводы в заметке. Проверьте доступность каждого файла или ссылки.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    }
  ],
  "C4": [
    {
      "command": "git diff HEAD -- gateway/",
      "expected": "Оба локальных backend выбираются конфигом; base_url/model согласованы с API.",
      "scope": "Команды Python/curl — в контейнере клиента своего ai-platform-labs; Docker CLI — из терминала Docker Desktop/WSL. Профиль backend выбран по C2, на Mac C1/C3 не подтверждают CUDA."
},
    {
      "command": "docker compose logs --tail 50 gateway",
      "expected": "Сверьте показанный артефакт или вывод с результатом шага: Конфиг маршрутов в YAML: алиас модели → упорядоченный список провайдеров, например fast: [local-vllm, external].",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "docker compose logs --tail 50 gateway",
      "expected": "Сверьте показанный артефакт или вывод с результатом шага: Логика: пробовать провайдеры по порядку; на таймаут или 5xx — следующий; на 4xx — сразу вернуть ошибку клиенту.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "docker compose logs --tail 50 gateway",
      "expected": "Сверьте показанный артефакт или вывод с результатом шага: Возвращайте фактического провайдера в заголовке X-Provider и в логах; считайте fallback_total по паре from → to.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "docker compose logs --tail 50 gateway",
      "expected": "Сверьте показанный артефакт или вывод с результатом шага: Опционально: circuit breaker — после 5 ошибок подряд провайдер исключается на 30 секунд.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "docker compose logs --tail 50 gateway",
      "expected": "Сверьте показанный артефакт или вывод с результатом шага: Тесты: fallback при таймауте первого, ошибка 502 при отказе всех, отсутствие fallback на 400.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "docker compose logs --tail 50 gateway",
      "expected": "Сверьте показанный артефакт или вывод с результатом шага: Ручная проверка: остановите vLLM — запросы уходят во внешний или mock-провайдер.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "git show --stat --oneline HEAD",
      "expected": "В коммите и приложенном отчёте доступны коммит, тесты и лог с fallback. Проверьте доступность каждого файла или ссылки.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    }
  ],
  "C5": [
    {
      "command": "docker compose logs --tail 50 gateway",
      "expected": "Сверьте показанный артефакт или вывод с результатом шага: Таблица usage_events(tenant, model, provider, prompt_tokens, completion_tokens, cost_usd, created_at) в PostgreSQL.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "docker compose logs --tail 50 gateway",
      "expected": "Сверьте показанный артефакт или вывод с результатом шага: Тенант определяется по API-ключу из заголовка Authorization; ключи и тенанты — в конфиге.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "docker compose logs --tail 50 gateway",
      "expected": "Сверьте показанный артефакт или вывод с результатом шага: После каждого ответа записывайте usage; стоимость — по таблице цен в конфиге ($ за 1M входных и выходных токенов; для локальной модели — амортизация GPU-часа на ваш throughput из C3).",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "docker compose logs --tail 50 gateway",
      "expected": "Сверьте показанный артефакт или вывод с результатом шага: Квота: дневной лимит токенов на тенанта, проверка перед вызовом провайдера (атомарный счётчик в БД или Redis), при превышении — 429 с Retry-After до полуночи.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "docker compose logs --tail 50 gateway",
      "expected": "Сверьте показанный артефакт или вывод с результатом шага: Эндпоинт GET /v1/usage?from=&to= — сводка по тенанту и моделям.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "docker compose logs --tail 50 gateway",
      "expected": "Сверьте показанный артефакт или вывод с результатом шага: Проверка: исчерпайте маленькую квоту скриптом и получите 429.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "git show --stat --oneline HEAD",
      "expected": "В коммите и приложенном отчёте доступны коммит и вывод `/v1/usage`. Проверьте доступность каждого файла или ссылки.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    }
  ],
  "C6": [
    {
      "command": "git diff HEAD -- gateway/",
      "expected": "Очередь и лимит конкурентности работают с выбранным backend C2.",
      "scope": "Команды Python/curl — в контейнере клиента своего ai-platform-labs; Docker CLI — из терминала Docker Desktop/WSL. Профиль backend выбран по C2, на Mac C1/C3 не подтверждают CUDA."
},
    {
      "command": "docker compose logs --tail 50 gateway",
      "expected": "Сверьте показанный артефакт или вывод с результатом шага: Класс трафика — заголовок X-Priority: interactive|batch (или по тенанту); interactive получает приоритет 0, batch — 10.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "docker compose logs --tail 50 gateway",
      "expected": "Сверьте показанный артефакт или вывод с результатом шага: Batch-задачи из Kafka worker (A4) отправляйте с batch.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "docker compose logs --tail 50 gateway",
      "expected": "Сверьте показанный артефакт или вывод с результатом шага: Метрика queue_wait_seconds (histogram) с лейблом класса.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "docker compose logs --tail 50 gateway",
      "expected": "Сверьте показанный артефакт или вывод с результатом шага: Нагрузочный тест: 200 batch-запросов параллельно и раз в секунду interactive-запрос; сравните queue wait interactive с приоритетами и без.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "git show --stat --oneline HEAD",
      "expected": "В коммите и приложенном отчёте доступны коммит и таблица замеров. Проверьте доступность каждого файла или ссылки.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    }
  ],
  "C7": [
    {
      "command": "docker compose logs --tail 50 gateway",
      "expected": "Сверьте показанный артефакт или вывод с результатом шага: Таблица semantic_cache(tenant, embedding vector(384), prompt_hash, response, created_at) с HNSW-индексом.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "docker compose logs --tail 50 gateway",
      "expected": "Сверьте показанный артефакт или вывод с результатом шага: Перед вызовом провайдера: эмбеддинг последнего пользовательского сообщения → поиск ближайшего в кэше того же тенанта → если косинусная близость выше порога и запись моложе TTL — вернуть ответ из кэша.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "docker compose logs --tail 50 gateway",
      "expected": "Сверьте показанный артефакт или вывод с результатом шага: Подберите порог на 30 парах «похожие по смыслу» и «похожие по словам, но разные».",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "docker compose logs --tail 50 gateway",
      "expected": "Сверьте показанный артефакт или вывод с результатом шага: Метрики cache_hit_total, cache_miss_total и latency с кэшем и без.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "git show --stat --oneline HEAD",
      "expected": "В коммите и приложенном отчёте доступны коммит, таблица подбора порога и описание рисков в заметке. Проверьте доступность каждого файла или ссылки.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    }
  ],
  "C9": [
    {
      "command": "docker compose logs --tail 50 stt-worker",
      "expected": "Сверьте показанный артефакт или вывод с результатом шага: Эндпоинт в gateway или отдельный сервис POST /v1/transcriptions/jobs: принимает аудиофайл, кладёт его в MinIO, создаёт задачу в таблице и сообщение в топик stt.jobs, возвращает job_id.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "docker compose logs --tail 50 stt-worker",
      "expected": "Сверьте показанный артефакт или вывод с результатом шага: STT-worker (aiokafka, как в A4): скачивает файл, режет на фрагменты по паузам (VAD), распознаёт faster-whisper: WhisperModel(\"small\", device=\"cuda\", compute_type=\"float16\") или device=\"cpu\", compute_type=\"int8\", model.transcribe(path, vad_filter=True).",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "docker compose logs --tail 50 stt-worker",
      "expected": "Сверьте показанный артефакт или вывод с результатом шага: Склеивает транскрипт с таймкодами, сохраняет в БД. Ошибка одного фрагмента — повтор только его, а не всей записи.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "docker compose logs --tail 50 stt-worker",
      "expected": "Сверьте показанный артефакт или вывод с результатом шага: Саммари через ваш LLM Gateway: map-шаг по частям транскрипта («ключевые решения, задачи, ответственные»), затем reduce-шаг в итоговый протокол. Токены учитываются на тенанта (C5).",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "docker compose logs --tail 50 stt-worker",
      "expected": "Сверьте показанный артефакт или вывод с результатом шага: Статусы задачи: queued → transcribing → summarizing → done / failed; GET /v1/transcriptions/jobs/{id} отдаёт статус, транскрипт и саммари.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "docker compose logs --tail 50 stt-worker",
      "expected": "Сверьте показанный артефакт или вывод с результатом шага: Метрики: длительность аудио, время обработки, real-time factor, ошибки по этапам.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "docker compose logs --tail 50 stt-worker",
      "expected": "Сверьте показанный артефакт или вывод с результатом шага: Проверка: запишите 10–15 минут разговора (или возьмите открытую запись), прогоните пайплайн, оцените качество саммари вручную.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "git diff HEAD -- worker/ infra/",
      "expected": "STT использует CPU/int8; LLM backend выбран по C2. Совместная CUDA-нагрузка не объявлена измеренной.",
      "scope": "Команды Python/curl — в контейнере клиента своего ai-platform-labs; Docker CLI — из терминала Docker Desktop/WSL. Профиль backend выбран по C2, на Mac C1/C3 не подтверждают CUDA."
},
    {
      "command": "git show --stat --oneline HEAD",
      "expected": "В коммите и приложенном отчёте доступны коммит, пример транскрипта и саммари, значение RTF. Проверьте доступность каждого файла или ссылки.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    }
  ],
  "C10": [
    {
      "command": "curl --fail http://triton:8000/v2/models/e5/config",
      "expected": "Сверьте показанный артефакт или вывод с результатом шага: Экспорт в ai-platform-labs/serving/triton/: в контейнере python:3.12-slim установите pip install optimum[onnx] и выполните optimum-cli export onnx --model intfloat/multilingual-e5-small --task feature-extraction onnx/e5. Посмотрите входы и выходы модели (команда из инструкции): у BERT-подобных моделей это input_ids, attention_mask, token_type_ids и last_hidden_state.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "python -c \"from pathlib import Path; p=Path('model_repository/e5/config.pbtxt'); print(p.read_text())\"",
      "expected": "Сверьте показанный артефакт или вывод с результатом шага: Model repository: model_repository/e5/1/model.onnx и model_repository/e5/config.pbtxt — backend: \"onnxruntime\", max_batch_size: 32, входы TYPE_INT64 с dims: [-1], выход last_hidden_state TYPE_FP32 с dims: [-1, 384], instance_group [{ kind: KIND_CPU }] (на RTX 4060 — KIND_GPU). Dynamic batching пока не включайте.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "python -c \"from pathlib import Path; p=Path('compose.yaml'); print(p.read_text())\"",
      "expected": "Сверьте показанный артефакт или вывод с результатом шага: Запуск: compose.yaml с сервисом triton — образ nvcr.io/nvidia/tritonserver:26.09-py3 (amd64 и arm64, около 15 ГБ), команда tritonserver --model-repository=/models, порты 127.0.0.1:8000-8002. Проверка из контейнера-клиента: GET /v2/health/ready и GET /v2/models/e5/config. На Mac сервер работает на CPU; если без GPU он не стартует — делайте на Windows-ноутбуке.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "curl --fail http://triton:8000/v2/models/e5/config",
      "expected": "Сверьте показанный артефакт или вывод с результатом шага: Замер без батчинга: контейнер nvcr.io/nvidia/tritonserver:26.09-py3-sdk, perf_analyzer -u triton:8000 -m e5 --shape input_ids:64 --shape attention_mask:64 --shape token_type_ids:64 --concurrency-range 1:16:4 --percentile=95. Запишите throughput (infer/sec) и p95 для каждой конкурентности.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "curl --fail http://triton:8000/v2/models/e5/config",
      "expected": "Сверьте показанный артефакт или вывод с результатом шага: Включите dynamic_batching { max_queue_delay_microseconds: 2000 } в config.pbtxt, перезапустите Triton и повторите замер. Сравните: при конкурентности 1 разницы почти нет, при 8–16 растёт throughput, а p95 платит за ожидание в очереди.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "python -c \"from pathlib import Path; p=Path('client.py'); print(p.read_text())\"",
      "expected": "Сверьте показанный артефакт или вывод с результатом шага: Клиент client.py на tritonclient[http]: токенизация, запрос к e5, mean pooling по attention_mask → вектор 384. Сравните косинусную близость с эмбеддингом той же модели из sentence-transformers — должна быть около 1.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "git show --stat --oneline HEAD",
      "expected": "В коммите и приложенном отчёте доступны `serving/triton/README.md` — config.pbtxt, таблица throughput и p95 без dynamic batching и с ним, вывод «Triton или vLLM» для эмбеддингов, классификатора и LLM. Проверьте доступность каждого файла или ссылки.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    }
  ],
  "D0": [
    {
      "command": "python -c \"from pathlib import Path; p=Path('docs/slo.md'); print(p.read_text())\"",
      "expected": "Сверьте показанный артефакт или вывод с результатом шага: Создайте docs/slo.md для gateway.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "git diff HEAD -- docs/slo.md",
      "expected": "Сверьте показанный артефакт или вывод с результатом шага: Таблица SLI: TTFT p95, e2e latency p95/p99 для нестримингового режима, TPOT, доля ошибок 5xx и таймаутов, доступность (успешные / все), queue time p95.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "git diff HEAD -- docs/slo.md",
      "expected": "Сверьте показанный артефакт или вывод с результатом шага: Для каждого SLI — цель и окно: например, «TTFT p95 < 1.5 с за 28 дней», «доступность 99.5%».",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "git diff HEAD -- docs/slo.md",
      "expected": "Сверьте показанный артефакт или вывод с результатом шага: Посчитайте error budget в минутах и запросах для выбранной доступности.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "git diff HEAD -- docs/slo.md",
      "expected": "Сверьте показанный артефакт или вывод с результатом шага: Опишите, какие метрики vLLM и gateway дают каждый SLI (имена метрик) и что не считается ошибкой (4xx клиента).",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "git show --stat --oneline HEAD",
      "expected": "В коммите и приложенном отчёте доступны коммит `slo.md`. Проверьте доступность каждого файла или ссылки.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    }
  ],
  "D1": [
    {
      "command": "git diff HEAD -- infra/prometheus/",
      "expected": "Сверьте показанный артефакт или вывод с результатом шага: Добавьте в gateway prometheus_client: gateway_requests_total{provider,model,status}, gateway_request_duration_seconds (histogram), gateway_tokens_total{type=\"prompt|completion\",tenant}, gateway_fallback_total{from,to}; эндпоинт /metrics.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "python -c \"from pathlib import Path; p=Path('infra/prometheus/prometheus.yml'); print(p.read_text())\"",
      "expected": "Сверьте показанный артефакт или вывод с результатом шага: В infra/prometheus/prometheus.yml добавьте job для vLLM (<host>:8000/metrics) и для gateway.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "git diff HEAD -- infra/prometheus/",
      "expected": "Сверьте показанный артефакт или вывод с результатом шага: Поднимите Prometheus в Docker Compose и проверьте Targets — оба UP.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "python -c \"from pathlib import Path; p=Path('infra/prometheus/queries.md'); print(p.read_text())\"",
      "expected": "Сверьте показанный артефакт или вывод с результатом шага: Сохраните PromQL-запросы в infra/prometheus/queries.md: p95 TTFT (histogram_quantile(0.95, sum by (le) (rate(vllm:time_to_first_token_seconds_bucket[5m])))), доля 5xx по провайдерам, tokens/s, vllm:num_requests_waiting, vllm:kv_cache_usage_perc.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "git diff HEAD -- infra/prometheus/",
      "expected": "Сверьте показанный артефакт или вывод с результатом шага: Дайте нагрузку скриптом из C3 и убедитесь, что метрики меняются.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "git show --stat --oneline HEAD",
      "expected": "В коммите и приложенном отчёте доступны скриншот Targets и коммит. Проверьте доступность каждого файла или ссылки.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    }
  ],
  "D1.1": [
    {
      "command": "nvidia-smi",
      "expected": "Сверьте показанный артефакт или вывод с результатом шага: Попробуйте dcgm-exporter в контейнере с GPU; в WSL он часто не видит DCGM — это нормально, зафиксируйте результат.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "nvidia-smi",
      "expected": "Сверьте показанный артефакт или вывод с результатом шага: Запасной вариант: скрипт раз в 15 секунд вызывает nvidia-smi --query-gpu=utilization.gpu,memory.used,memory.total,temperature.gpu,power.draw --format=csv,noheader,nounits и пишет метрики в формате Prometheus в файл для textfile collector node-exporter (или отдаёт /metrics сам).",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "nvidia-smi",
      "expected": "Сверьте показанный артефакт или вывод с результатом шага: Подключите к Prometheus и сопоставьте GPU utilization с нагрузкой из C3.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "git show --stat --oneline HEAD",
      "expected": "В коммите и приложенном отчёте доступны скриншот графика и описание выбранного способа. Проверьте доступность каждого файла или ссылки.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    }
  ],
  "D2": [
    {
      "command": "python -c \"from pathlib import Path; p=Path('infra/grafana/provisioning/datasources/prometheus.yaml'); print(p.read_text())\"",
      "expected": "Сверьте показанный артефакт или вывод с результатом шага: Поднимите Grafana в Docker Compose с provisioning: infra/grafana/provisioning/datasources/prometheus.yaml и dashboards/dashboards.yaml, JSON дашборда в infra/grafana/dashboards/llm-serving.json.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "git diff HEAD -- infra/grafana/",
      "expected": "Сверьте показанный артефакт или вывод с результатом шага: Ряд 1 (RED): RPS, доля ошибок по провайдерам, e2e p50/p95/p99.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "git diff HEAD -- infra/grafana/",
      "expected": "Сверьте показанный артефакт или вывод с результатом шага: Ряд 2 (LLM): TTFT p50/p95, TPOT, prompt и generation tokens/s, доля fallback.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "git diff HEAD -- infra/grafana/",
      "expected": "Сверьте показанный артефакт или вывод с результатом шага: Ряд 3 (насыщение): running и waiting запросы vLLM, kv_cache_usage_perc, queue wait по классам, GPU utilization и VRAM.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "git diff HEAD -- infra/grafana/",
      "expected": "Сверьте показанный артефакт или вывод с результатом шага: Ряд 4 (деньги): токены и стоимость по тенантам за сутки.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "git diff HEAD -- infra/grafana/",
      "expected": "Сверьте показанный артефакт или вывод с результатом шага: Дайте нагрузку из C3 и сделайте скриншот момента насыщения.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "git show --stat --oneline HEAD",
      "expected": "В коммите и приложенном отчёте доступны JSON дашборда в репозитории и скриншот. Проверьте доступность каждого файла или ссылки.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    }
  ],
  "D3": [
    {
      "command": "python -c \"from pathlib import Path; p=Path('infra/prometheus/rules/llm.yml'); print(p.read_text())\"",
      "expected": "Сверьте показанный артефакт или вывод с результатом шага: Файл infra/prometheus/rules/llm.yml с правилами: высокий queue time (p95 > 2 с, for: 5m), деградация TTFT p95 относительно SLO, доля 5xx > 2% (for: 5m), падение generation tokens/s при waiting > 0, kv_cache_usage_perc > 0.9.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "git diff HEAD -- infra/prometheus/rules/",
      "expected": "Сверьте показанный артефакт или вывод с результатом шага: У каждого правила — labels.severity и annotations.summary/description с текущим значением.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "python -c \"from pathlib import Path; p=Path('rules/llm_test.yml'); print(p.read_text())\"",
      "expected": "Сверьте показанный артефакт или вывод с результатом шага: Напишите rules/llm_test.yml для команда из инструкции с синтетическими рядами: алерт срабатывает и не срабатывает.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "git diff HEAD -- infra/prometheus/rules/",
      "expected": "Сверьте показанный артефакт или вывод с результатом шага: Поднимите Alertmanager (можно с webhook-приёмником или в Telegram) и воспроизведите алерт нагрузкой.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "git show --stat --oneline HEAD",
      "expected": "В коммите и приложенном отчёте доступны вывод `promtool test rules`, скриншот сработавшего алерта, коммит. Проверьте доступность каждого файла или ссылки.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    }
  ],
  "D4": [
    {
      "command": "git diff HEAD -- infra/otel/",
      "expected": "Сверьте показанный артефакт или вывод с результатом шага: Установите opentelemetry-sdk opentelemetry-exporter-otlp opentelemetry-instrumentation-fastapi opentelemetry-instrumentation-httpx.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "git diff HEAD -- infra/otel/",
      "expected": "Сверьте показанный артефакт или вывод с результатом шага: При старте gateway: FastAPIInstrumentor.instrument_app(app), HTTPXClientInstrumentor().instrument(), экспорт OTLP на адрес из OTEL_EXPORTER_OTLP_ENDPOINT.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "git diff HEAD -- infra/otel/",
      "expected": "Сверьте показанный артефакт или вывод с результатом шага: Ручные spans: route (атрибуты model_alias, выбранный провайдер), provider.call (provider, model, prompt_tokens, completion_tokens), fallback (from, to, причина).",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "python -c \"from pathlib import Path; p=Path('infra/otel/collector.yaml'); print(p.read_text())\"",
      "expected": "Сверьте показанный артефакт или вывод с результатом шага: Поднимите OpenTelemetry Collector и Jaeger в Docker Compose; конфиг collector в infra/otel/collector.yaml.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "git diff HEAD -- infra/otel/",
      "expected": "Сверьте показанный артефакт или вывод с результатом шага: Добавьте trace_id в structlog (процессор, читающий текущий span).",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "git diff HEAD -- infra/otel/",
      "expected": "Сверьте показанный артефакт или вывод с результатом шага: Проверьте трейс запроса с fallback в Jaeger.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "git show --stat --oneline HEAD",
      "expected": "В коммите и приложенном отчёте доступны скриншот трейса и коммит. Проверьте доступность каждого файла или ссылки.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    }
  ],
  "D5": [
    {
      "command": "git diff HEAD -- infra/",
      "expected": "Сверьте показанный артефакт или вывод с результатом шага: Поднимите Loki и Grafana Alloy (или Promtail), собирающий логи контейнеров gateway и worker.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "git diff HEAD -- infra/",
      "expected": "Сверьте показанный артефакт или вывод с результатом шага: Разбор JSON-полей в LogQL: {service=\"gateway\"} | json | status >= 500.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "git diff HEAD -- infra/",
      "expected": "Сверьте показанный артефакт или вывод с результатом шага: Сохраните 3 запроса: ошибки по провайдеру за час, медленные запросы (latency_ms > 5000), все логи одного request_id.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "git diff HEAD -- infra/",
      "expected": "Сверьте показанный артефакт или вывод с результатом шага: Настройте derived field в Grafana: trace_id из лога открывает трейс в Jaeger.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "git show --stat --oneline HEAD",
      "expected": "В коммите и приложенном отчёте доступны скриншот перехода от лога к трейсу. Проверьте доступность каждого файла или ссылки.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    }
  ],
  "E1": [
    {
      "command": "psql -h postgres -U USER -d DATABASE -c \"\\d+ chunks\"",
      "expected": "Сверьте показанный артефакт или вывод с результатом шага: В Docker Compose добавьте pgvector/pgvector:pg17 (отдельно от БД gateway).",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "psql -h postgres -U USER -d DATABASE -c \"\\d+ chunks\"",
      "expected": "Сверьте показанный артефакт или вывод с результатом шага: Миграция: CREATE EXTENSION vector; и таблица chunks(id bigserial, doc_id text, chunk_idx int, content text, content_hash text, metadata jsonb, embedding vector(384)).",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "psql -h postgres -U USER -d DATABASE -c \"\\d+ chunks\"",
      "expected": "Сверьте показанный артефакт или вывод с результатом шага: Индекс: CREATE INDEX ON chunks USING hnsw (embedding vector_cosine_ops);.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "psql -h postgres -U USER -d DATABASE -c \"\\d+ chunks\"",
      "expected": "Сверьте показанный артефакт или вывод с результатом шага: Сгенерируйте 10 000 случайных векторов, выполните запрос ORDER BY embedding <=> $1 LIMIT 5 и посмотрите EXPLAIN ANALYZE — используется ли индекс.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "psql -h postgres -U USER -d DATABASE -c \"\\d+ chunks\"",
      "expected": "Сверьте показанный артефакт или вывод с результатом шага: Сравните результаты точного поиска (SET enable_indexscan = off) и HNSW для 50 запросов: какая доля top-5 совпадает; попробуйте SET hnsw.ef_search = 100.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "git show --stat --oneline HEAD",
      "expected": "В коммите и приложенном отчёте доступны миграция в репозитории и вывод EXPLAIN. Проверьте доступность каждого файла или ссылки.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    }
  ],
  "E2": [
    {
      "command": "git diff HEAD -- rag/",
      "expected": "Сверьте показанный артефакт или вывод с результатом шага: Соберите 30–100 технических документов в Markdown: свои runbook-и, выдержки из документации Patroni, Kafka, Vault.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "python -c \"from pathlib import Path; p=Path('rag/ingest.py'); print(p.read_text())\"",
      "expected": "Сверьте показанный артефакт или вывод с результатом шага: Скрипт rag/ingest.py: чтение файлов → нарезка по заголовкам Markdown, длинные разделы дополнительно на куски ~500–800 токенов с перекрытием ~15%.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "git diff HEAD -- rag/",
      "expected": "Сверьте показанный артефакт или вывод с результатом шага: Эмбеддинги: SentenceTransformer(\"intfloat/multilingual-e5-small\"), тексты с префиксом \"passage: \", normalize_embeddings=True.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "git diff HEAD -- rag/",
      "expected": "Сверьте показанный артефакт или вывод с результатом шага: Идемпотентность: для документа считается хэш содержимого; если он изменился — удалить старые чанки документа и вставить новые, если нет — пропустить.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "git diff HEAD -- rag/",
      "expected": "Сверьте показанный артефакт или вывод с результатом шага: Метаданные чанка: путь к файлу, заголовок раздела, дата изменения.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "git diff HEAD -- rag/",
      "expected": "Сверьте показанный артефакт или вывод с результатом шага: Запустите ingest дважды — число строк не меняется.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "git show --stat --oneline HEAD",
      "expected": "В коммите и приложенном отчёте доступны коммит и `docs/chunking.md` с обоснованием стратегии. Проверьте доступность каждого файла или ссылки.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    }
  ],
  "E3": [
    {
      "command": "git diff HEAD -- rag/",
      "expected": "Сверьте показанный артефакт или вывод с результатом шага: В gateway (или отдельном rag/ сервисе) POST /v1/search с телом {query, top_k=5, filters: {source?}}.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "git diff HEAD -- rag/",
      "expected": "Сверьте показанный артефакт или вывод с результатом шага: Эмбеддинг запроса с префиксом \"query: \", SQL: SELECT ..., 1 - (embedding <=> $1) AS score FROM chunks WHERE ... ORDER BY embedding <=> $1 LIMIT $2.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "git diff HEAD -- rag/",
      "expected": "Сверьте показанный артефакт или вывод с результатом шага: Ответ: список {chunk_id, doc_id, section, content, score}.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "git diff HEAD -- rag/",
      "expected": "Сверьте показанный артефакт или вывод с результатом шага: Метрика latency поиска (histogram) и span в трейсе.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "git diff HEAD -- rag/",
      "expected": "Сверьте показанный артефакт или вывод с результатом шага: API-тесты: результат по известному запросу, фильтр по источнику, пустая база.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "git show --stat --oneline HEAD",
      "expected": "В коммите и приложенном отчёте доступны коммит и пример ответа. Проверьте доступность каждого файла или ссылки.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    }
  ],
  "E4": [
    {
      "command": "python scripts/chat_probe.py",
      "expected": "RAG отвечает через выбранный backend; сохранены model/revision и фактический token budget.",
      "scope": "Команды Python/curl — в контейнере клиента своего ai-platform-labs; Docker CLI — из терминала Docker Desktop/WSL. Профиль backend выбран по C2, на Mac C1/C3 не подтверждают CUDA."
},
    {
      "command": "git diff HEAD -- rag/",
      "expected": "Сверьте показанный артефакт или вывод с результатом шага: В шаблоне: отвечать только по фрагментам, ссылаться на номера, при отсутствии ответа писать «В базе нет информации».",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "git diff HEAD -- rag/",
      "expected": "Сверьте показанный артефакт или вывод с результатом шага: Версия шаблона (prompt_version=rag_v1) — в логах, метриках и трейсах.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "git diff HEAD -- rag/",
      "expected": "Сверьте показанный артефакт или вывод с результатом шага: Проверьте 5 вопросов из базы и 3 вопроса вне базы.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "git show --stat --oneline HEAD",
      "expected": "В коммите и приложенном отчёте доступны коммит и примеры ответов в заметке. Проверьте доступность каждого файла или ссылки.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    }
  ],
  "E5": [
    {
      "command": "python -c \"import json; a=[json.loads(x) for x in open('eval/retrieval.jsonl') if x.strip()]; print(len(a),a[0])\"",
      "expected": "Есть 30+ запросов с вручную размеченными релевантными chunk_id.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "python eval/retrieval_eval.py",
      "expected": "Вывод содержит recall@1/3/5/10 и MRR на фиксированном наборе; попадание одного chunk не заменяет полноту.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "python eval/retrieval_eval.py",
      "expected": "Сравниваются две конфигурации на одной разметке; изменения чанкинга не делают старые id недействительными без новой разметки.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "git diff -- eval",
      "expected": "CSV и короткий отчёт называют выигрыш/потери конкретной конфигурации и условия; результаты не подменены целевыми порогами.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "git show --stat --oneline HEAD",
      "expected": "В коммите и приложенном отчёте доступны датасет, скрипт и отчёт в репозитории. Проверьте доступность каждого файла или ссылки.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    }
  ],
  "E6": [
    {
      "command": "git diff HEAD -- rag/",
      "expected": "Сверьте показанный артефакт или вывод с результатом шага: Подключите cross-encoder из sentence-transformers (многоязычный reranker).",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "git diff HEAD -- rag/",
      "expected": "Сверьте показанный артефакт или вывод с результатом шага: Поиск top-20 → переранжирование → top-5.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "git diff HEAD -- rag/",
      "expected": "Сверьте показанный артефакт или вывод с результатом шага: Посчитайте recall@5 и MRR с reranking и без, а также добавку к latency.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "git show --stat --oneline HEAD",
      "expected": "В коммите и приложенном отчёте доступны таблица сравнения. Проверьте доступность каждого файла или ссылки.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    }
  ],
  "F1": [
    {
      "command": "git diff HEAD -- docs/",
      "expected": "Сверьте показанный артефакт или вывод с результатом шага: Склонируйте репозиторий Langfuse и поднимите по инструкции «Docker Compose deployment» (команда из инструкции), UI на порту 3000.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "git diff HEAD -- docs/",
      "expected": "Сверьте показанный артефакт или вывод с результатом шага: Разберитесь с составом: web, worker, PostgreSQL, ClickHouse, Redis/Valkey, MinIO — запишите роль каждого.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "git diff HEAD -- docs/",
      "expected": "Сверьте показанный артефакт или вывод с результатом шага: Создайте организацию, проект и API-ключи.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "git diff HEAD -- docs/",
      "expected": "Сверьте показанный артефакт или вывод с результатом шага: Проверьте health-эндпоинты из документации.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "git diff HEAD -- docs/",
      "expected": "Сверьте показанный артефакт или вывод с результатом шага: Запишите план бэкапа: PostgreSQL (pgBackRest или pg_dump), ClickHouse, бакет MinIO, — что и как часто.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "git show --stat --oneline HEAD",
      "expected": "В коммите и приложенном отчёте доступны скриншот проекта и заметка с ролями компонентов и планом бэкапа. Проверьте доступность каждого файла или ссылки.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    }
  ],
  "F2": [
    {
      "command": "docker compose logs --tail 50 gateway",
      "expected": "Сверьте показанный артефакт или вывод с результатом шага: Установите langfuse в gateway, передайте ключи и адрес проекта через переменные окружения (LANGFUSE_*).",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "docker compose logs --tail 50 gateway",
      "expected": "Сверьте показанный артефакт или вывод с результатом шага: Оберните обработчик /v1/rag/answer в trace (@observe()), шаги — в вложенные observations: retrieval (запрос, найденные chunk_id), generation (модель, параметры, usage).",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "git diff HEAD -- gateway/",
      "expected": "Trace позволяет восстановить prompt, backend и идентичность модели.",
      "scope": "Команды Python/curl — в контейнере клиента своего ai-platform-labs; Docker CLI — из терминала Docker Desktop/WSL. Профиль backend выбран по C2, на Mac C1/C3 не подтверждают CUDA."
},
    {
      "command": "docker compose logs --tail 50 gateway",
      "expected": "Сверьте показанный артефакт или вывод с результатом шага: Настройте цены моделей в Langfuse, чтобы считалась стоимость.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "docker compose logs --tail 50 gateway",
      "expected": "Сверьте показанный артефакт или вывод с результатом шага: Сделайте 20 запросов и посмотрите трейсы: дерево, токены, стоимость.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "git show --stat --oneline HEAD",
      "expected": "В коммите и приложенном отчёте доступны скриншот трейса с retrieval и generation. Проверьте доступность каждого файла или ссылки.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    }
  ],
  "F3": [
    {
      "command": "python -c \"from pathlib import Path; p=Path('eval/golden/v1.jsonl'); print(p.read_text())\"",
      "expected": "Сверьте показанный артефакт или вывод с результатом шага: Создайте eval/golden/v1.jsonl: 40–60 записей вида {id, input, expected_facts: [...], expected_sources: [chunk_id], must_refuse: bool, tags: [категория, сложность]}.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "git diff HEAD -- eval/golden/",
      "expected": "Сверьте показанный артефакт или вывод с результатом шага: Минимум 15% — негативные кейсы: ответа в базе нет, ожидается отказ.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "python -c \"from pathlib import Path; p=Path('eval/golden/README.md'); print(p.read_text())\"",
      "expected": "Сверьте показанный артефакт или вывод с результатом шага: Опишите правила разметки в eval/golden/README.md — что считается правильным ответом.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "git diff HEAD -- eval/golden/",
      "expected": "Сверьте показанный артефакт или вывод с результатом шага: Скрипт загрузки в Langfuse Dataset (имя rag-golden, версия в метаданных) через SDK.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "git show --stat --oneline HEAD",
      "expected": "В коммите и приложенном отчёте доступны файл датасета в git и скриншот Dataset в Langfuse. Проверьте доступность каждого файла или ссылки.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    }
  ],
  "F4": [
    {
      "command": "python eval/run_experiment.py",
      "expected": "Run содержит backend/revision/params; модели на 8 ГБ запускаются последовательно.",
      "scope": "Команды Python/curl — в контейнере клиента своего ai-platform-labs; Docker CLI — из терминала Docker Desktop/WSL. Профиль backend выбран по C2, на Mac C1/C3 не подтверждают CUDA."
},
    {
      "command": "git diff HEAD -- eval/",
      "expected": "Сверьте показанный артефакт или вывод с результатом шага: Детерминированные оценки на каждый item: есть ссылки на источники; корректный отказ для must_refuse; доля expected_facts, найденных в ответе; latency; стоимость.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "git diff HEAD -- eval/",
      "expected": "Сверьте показанный артефакт или вывод с результатом шага: Имя запуска: baseline-<git_sha>-<prompt_version>.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "git diff HEAD -- eval/",
      "expected": "Сверьте показанный артефакт или вывод с результатом шага: Посмотрите в Langfuse агрегаты и отдельные items.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "git show --stat --oneline HEAD",
      "expected": "В коммите и приложенном отчёте доступны скриншот запуска с оценками и коммит скрипта. Проверьте доступность каждого файла или ссылки.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    }
  ],
  "F5": [
    {
      "command": "git diff HEAD -- prompts/ eval/",
      "expected": "Одно изменение изолировано; unmeasured candidates не объявлены проверенными.",
      "scope": "Команды Python/curl — в контейнере клиента своего ai-platform-labs; Docker CLI — из терминала Docker Desktop/WSL. Профиль backend выбран по C2, на Mac C1/C3 не подтверждают CUDA."
},
    {
      "command": "git diff HEAD -- eval/",
      "expected": "Сверьте показанный артефакт или вывод с результатом шага: Запустите тот же скрипт на той же версии датасета с именем candidate-<git_sha>-<prompt_version>.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "git diff HEAD -- eval/",
      "expected": "Сверьте показанный артефакт или вывод с результатом шага: Запишите, что изменили и какую гипотезу проверяете.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "git show --stat --oneline HEAD",
      "expected": "В коммите и приложенном отчёте доступны скриншот второго запуска. Проверьте доступность каждого файла или ссылки.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    }
  ],
  "F6": [
    {
      "command": "git diff HEAD -- eval/",
      "expected": "Сверьте показанный артефакт или вывод с результатом шага: Напишите judge-промпт с рубрикой для groundedness (каждое утверждение ответа подтверждено фрагментами: 1 / частично 0.5 / нет 0) и relevance (ответ по вопросу).",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "python eval/run_experiment.py",
      "expected": "Генератор и judge на RTX запускаются последовательно; их версии и decoding сохранены.",
      "scope": "Команды Python/curl — в контейнере клиента своего ai-platform-labs; Docker CLI — из терминала Docker Desktop/WSL. Профиль backend выбран по C2, на Mac C1/C3 не подтверждают CUDA."
},
    {
      "command": "git diff HEAD -- eval/",
      "expected": "Сверьте показанный артефакт или вывод с результатом шага: Разметьте вручную 20 items по той же рубрике и посчитайте согласие с judge (доля совпадений, Cohen's kappa).",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "git diff HEAD -- eval/",
      "expected": "Сверьте показанный артефакт или вывод с результатом шага: Опишите ограничения: искажения, стоимость прогона, разброс при повторах.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "git show --stat --oneline HEAD",
      "expected": "В коммите и приложенном отчёте доступны таблица согласия и коммит judge-промпта. Проверьте доступность каждого файла или ссылки.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    }
  ],
  "F7": [
    {
      "command": "git diff HEAD -- docs/decisions/",
      "expected": "Сверьте показанный артефакт или вывод с результатом шага: Сравните baseline и candidate в Langfuse (Compare): агрегаты по всем оценкам и таблица по items.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "git diff HEAD -- docs/decisions/",
      "expected": "Сверьте показанный артефакт или вывод с результатом шага: Найдите items, где candidate стал хуже (groundedness, отказ, факты), и разберите 3–5 из них по трейсам: что именно сломалось.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "git diff HEAD -- docs/decisions/",
      "expected": "Сверьте показанный артефакт или вывод с результатом шага: Если регрессии нет — создайте её осознанно (например, top_k=1 или шаблон без требования ссылок) и покажите, как метрики её ловят.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "python -c \"from pathlib import Path; p=Path('docs/decisions/0001-candidate-rejected.md'); print(p.read_text())\"",
      "expected": "Сверьте показанный артефакт или вывод с результатом шага: Напишите docs/decisions/0001-candidate-rejected.md: что сравнивали, цифры, разобранные примеры, решение и почему.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "git show --stat --oneline HEAD",
      "expected": "В коммите и приложенном отчёте доступны decision record и скриншот сравнения. Проверьте доступность каждого файла или ссылки.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    }
  ],
  "F8": [
    {
      "command": "git diff HEAD -- eval/",
      "expected": "Сверьте показанный артефакт или вывод с результатом шага: Сделайте фоновую задачу, которая раз в N минут берёт случайные 5% новых продакшен-трейсов RAG из Langfuse.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "git diff HEAD -- eval/",
      "expected": "Сверьте показанный артефакт или вывод с результатом шага: Для каждого — judge-оценки без эталона: groundedness, relevance, корректность отказа; запишите их scores в Langfuse.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "git diff HEAD -- eval/",
      "expected": "Сверьте показанный артефакт или вывод с результатом шага: Экспортируйте скользящее среднее оценок в Prometheus и поставьте алерт на падение ниже порога (например, groundedness < 0.75 за 1 час).",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "git diff HEAD -- eval/",
      "expected": "Сверьте показанный артефакт или вывод с результатом шага: Трейсы с низкой оценкой автоматически добавляйте в annotation queue для ручного разбора.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "git diff HEAD -- eval/",
      "expected": "Сверьте показанный артефакт или вывод с результатом шага: Сымитируйте деградацию (сломайте шаблон или поиск) и покажите срабатывание алерта.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "git diff HEAD -- eval/",
      "expected": "Сверьте показанный артефакт или вывод с результатом шага: Разберите 5 плохих трейсов и добавьте их в golden dataset (новая версия).",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "git show --stat --oneline HEAD",
      "expected": "В коммите и приложенном отчёте доступны скриншот алерта, коммит и запись в журнале о найденной проблеме. Проверьте доступность каждого файла или ссылки.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    }
  ],
  "G1": [
    {
      "command": "python -c \"from pathlib import Path; p=Path('.gitlab-ci.yml'); print(p.read_text())\"",
      "expected": "Сверьте показанный артефакт или вывод с результатом шага: Создайте .gitlab-ci.yml со стадиями: lint, test, build, integration, eval.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "git diff HEAD -- .gitlab-ci.yml",
      "expected": "Сверьте показанный артефакт или вывод с результатом шага: lint и test: ruff, mypy, pytest с JUnit-отчётом (команда из инструкции, artifacts: reports: junit).",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "git diff HEAD -- .gitlab-ci.yml",
      "expected": "Сверьте показанный артефакт или вывод с результатом шага: build: образ gateway с тегом $CI_COMMIT_SHORT_SHA, push в registry проекта.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "git diff HEAD -- .gitlab-ci.yml",
      "expected": "Сверьте показанный артефакт или вывод с результатом шага: integration: job с services: — pgvector/pgvector:pg17 (alias db) и mock-LLM (ваш MockProvider как отдельный образ), запуск собранного gateway, ingest тестовых документов, smoke-тест API.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "python -c \"from pathlib import Path; p=Path('eval/run_experiment.py'); print(p.read_text())\"",
      "expected": "Сверьте показанный артефакт или вывод с результатом шага: eval: запуск eval/run_experiment.py на golden dataset (детерминированные проверки обязательно, judge — опционально), результат — JUnit-отчёт по items и eval/report.json как artifact.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "git diff HEAD -- .gitlab-ci.yml",
      "expected": "Сверьте показанный артефакт или вывод с результатом шага: Ограничьте eval через rules: changes (prompts/, rag/, eval/, gateway/) и плюс запуск по расписанию.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "git diff HEAD -- .gitlab-ci.yml",
      "expected": "Сверьте показанный артефакт или вывод с результатом шага: Можно на gitlab.com или с локальным GitLab Runner в Docker.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "git show --stat --oneline HEAD",
      "expected": "В коммите и приложенном отчёте доступны ссылка на зелёный pipeline. Проверьте доступность каждого файла или ссылки.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    }
  ],
  "G2": [
    {
      "command": "python -c \"from pathlib import Path; p=Path('eval/thresholds.yaml'); print(p.read_text())\"",
      "expected": "Сверьте показанный артефакт или вывод с результатом шага: Создайте eval/thresholds.yaml: абсолютные пороги (groundedness ≥ 0.8, refusal_accuracy ≥ 0.9, recall@5 ≥ 0.85) и допуск регрессии относительно baseline (не более 3 п.п.).",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "python -c \"from pathlib import Path; p=Path('eval/baseline.json'); print(p.read_text())\"",
      "expected": "Сверьте показанный артефакт или вывод с результатом шага: Сохраните утверждённый baseline в eval/baseline.json (метрики последнего принятого main).",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "python -c \"from pathlib import Path; p=Path('eval/gate.py'); print(p.read_text())\"",
      "expected": "Сверьте показанный артефакт или вывод с результатом шага: Скрипт eval/gate.py: сравнивает report.json с порогами и baseline, печатает таблицу и завершается с кодом 1 при нарушении.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "git diff HEAD -- eval/",
      "expected": "Сверьте показанный артефакт или вывод с результатом шага: Сделайте MR с ухудшающим изменением промпта — pipeline должен упасть на eval.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "git diff HEAD -- eval/",
      "expected": "Сверьте показанный артефакт или вывод с результатом шага: Сделайте MR с улучшающим изменением — pipeline зелёный; обновление baseline — отдельным осознанным коммитом.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "git show --stat --oneline HEAD",
      "expected": "В коммите и приложенном отчёте доступны ссылки на красный и зелёный pipeline. Проверьте доступность каждого файла или ссылки.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    }
  ],
  "G3": [
    {
      "command": "git diff HEAD -- infra/",
      "expected": "Сверьте показанный артефакт или вывод с результатом шага: Вариант попроще: weighted routing в gateway — заголовок или процент трафика на prompt_version=rag_v2; метрики и трейсы с лейблом версии.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "git diff HEAD -- infra/",
      "expected": "Сверьте показанный артефакт или вывод с результатом шага: Вариант ближе к проду: kind или k3d, Argo Rollouts, Rollout со стратегией canary (setWeight: 20, pause, setWeight: 50, ...) и AnalysisTemplate с Prometheus-запросами на долю ошибок и p95.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "git diff HEAD -- infra/",
      "expected": "Сверьте показанный артефакт или вывод с результатом шага: Правило: abort при доле ошибок > 2% или росте p95 > 20% относительно stable.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "git diff HEAD -- infra/",
      "expected": "Сверьте показанный артефакт или вывод с результатом шага: Выкатите заведомо плохую версию (например, с задержкой или ошибками) и покажите автоматический abort.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "git show --stat --oneline HEAD",
      "expected": "В коммите и приложенном отчёте доступны скриншот или лог abort и манифесты в репозитории. Проверьте доступность каждого файла или ссылки.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    }
  ],
  "G4": [
    {
      "command": "git diff HEAD -- docs/runbooks/rollback.md",
      "expected": "Сверьте показанный артефакт или вывод с результатом шага: Определите, что составляет версию системы: образ gateway (sha), alias модели, prompt_version, версия индекса.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "git diff HEAD -- docs/runbooks/rollback.md",
      "expected": "Сверьте показанный артефакт или вывод с результатом шага: Пишите все четыре значения в атрибуты трейса, лейблы метрик и логи.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "git diff HEAD -- docs/runbooks/rollback.md",
      "expected": "Сверьте показанный артефакт или вывод с результатом шага: Подготовьте откат одной командой (make rollback или job в GitLab): возврат предыдущего образа (GitLab environment или revert в GitOps-репозитории), alias модели и prompt_version.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "git diff HEAD -- docs/runbooks/rollback.md",
      "expected": "Сверьте показанный артефакт или вывод с результатом шага: Проведите учения: выкатите новую версию, затем откатите; замерьте время и проверьте по трейсу, что запросы обслуживает старая версия.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "python -c \"from pathlib import Path; p=Path('docs/runbooks/rollback.md'); print(p.read_text())\"",
      "expected": "Сверьте показанный артефакт или вывод с результатом шага: Напишите docs/runbooks/rollback.md.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "git show --stat --oneline HEAD",
      "expected": "В коммите и приложенном отчёте доступны runbook, замер времени и скриншот трейса. Проверьте доступность каждого файла или ссылки.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    }
  ],
  "G5": [
    {
      "command": "git diff HEAD -- docs/runbooks/restore.md",
      "expected": "Сверьте показанный артефакт или вывод с результатом шага: Перечислите stateful-компоненты: pgvector-БД, БД gateway (usage, jobs), MLflow (PostgreSQL + MinIO), Langfuse (PostgreSQL + ClickHouse + MinIO).",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "git diff HEAD -- docs/runbooks/restore.md",
      "expected": "Сверьте показанный артефакт или вывод с результатом шага: Для каждого — способ бэкапа (pgBackRest или pg_dump, бэкап ClickHouse по документации, mc mirror для MinIO) и частоту.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "git diff HEAD -- docs/runbooks/restore.md",
      "expected": "Сверьте показанный артефакт или вывод с результатом шага: Сделайте скрипт бэкапа и восстановления.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "git diff HEAD -- docs/runbooks/restore.md",
      "expected": "Сверьте показанный артефакт или вывод с результатом шага: Restore drill: поднимите чистое окружение, восстановите всё, проверьте: поиск работает, трейсы Langfuse открываются, модель грузится из MLflow.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "git diff HEAD -- docs/runbooks/restore.md",
      "expected": "Сверьте показанный артефакт или вывод с результатом шага: Замерьте RTO и оцените RPO.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "git show --stat --oneline HEAD",
      "expected": "В коммите и приложенном отчёте доступны `docs/runbooks/restore.md` с замерами. Проверьте доступность каждого файла или ссылки.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    }
  ],
  "G6": [
    {
      "command": "python -c \"from pathlib import Path; p=Path('compose.yaml'); print(p.read_text())\"",
      "expected": "Сверьте показанный артефакт или вывод с результатом шага: В ai-platform-labs/infra/terraform/ — compose.yaml: сервис tfstate (postgres:16-alpine, база и пользователь terraform, порт 127.0.0.1:5433) и сервис terraform (hashicorp/terraform:1.13, папка infra/terraform смонтирована в /work, working_dir: /work, сокет Docker — для провайдера). Команды: команда из инструкции.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "git diff HEAD -- infra/terraform/",
      "expected": "Сверьте показанный артефакт или вывод с результатом шага: Модуль modules/service: docker_image и docker_container провайдера kreuzwerker/docker (образ, порты, env, том, healthcheck, лимит памяти), переменные с типами и validation, outputs — имя и порт. Версия модуля — git-тег service-v0.1.0; окружения подключают его через source = \"git::…//infra/terraform/modules/service?ref=service-v0.1.0\", чтобы обновляться осознанно.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "git diff HEAD -- infra/terraform/",
      "expected": "Сверьте показанный артефакт или вывод с результатом шага: Окружения envs/dev и envs/stage: один модуль, разные параметры (порты Qdrant 6333 и 6343, лимит памяти, тег образа). Backend в каждом — backend \"pg\" { schema_name = \"dev\" } (у stage — \"stage\"), строка подключения — в переменной окружения PG_CONN_STR (postgres://terraform:…@tfstate/terraform?sslmode=disable), не в коде.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "git diff HEAD -- infra/terraform/",
      "expected": "Сверьте показанный артефакт или вывод с результатом шага: Блокировка: запустите apply в dev в двух терминалах одновременно — второй ждёт (-lock-timeout=60s) или падает с «Error acquiring the state lock». Посмотрите блокировку в PostgreSQL: SELECT * FROM pg_locks WHERE locktype = 'advisory';.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "python -c \"from pathlib import Path; p=Path('.gitlab-ci.yml'); print(p.read_text())\"",
      "expected": "Сверьте показанный артефакт или вывод с результатом шага: CI в .gitlab-ci.yml из G1: job tf-plan — terraform plan -out=tfplan, план сохраняется артефактом, а terraform show -no-color tfplan выводится в лог MR; job tf-apply — when: manual только в main, применяет сохранённый tfplan. Раннер — локальный из G1 с сокетом Docker; state для него — host.docker.internal:5433.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "git diff HEAD -- infra/terraform/",
      "expected": "Сверьте показанный артефакт или вывод с результатом шага: Дрейф: удалите контейнер stage руками (команда из инструкции) и выполните terraform plan -detailed-exitcode — код 2 означает изменения. Добавьте job tf-drift по расписанию (rules: - if: $CI_PIPELINE_SOURCE == \"schedule\"), который падает при коде 2.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "git diff HEAD -- infra/terraform/",
      "expected": "Сверьте показанный артефакт или вывод с результатом шага: Рефакторинг без пересоздания: переименуйте module \"qdrant\" в module \"vector_db\" и добавьте блок moved с from = module.qdrant и to = module.vector_db — plan должен показать перемещение, а не destroy и create.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "git show --stat --oneline HEAD",
      "expected": "В коммите и приложенном отчёте доступны `infra/terraform/README.md` — схема state по окружениям, вывод второго apply с ожиданием блокировки, ссылка на MR с планом и на упавший job дрейфа. Проверьте доступность каждого файла или ссылки.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    }
  ],
  "H1": [
    {
      "command": "nvidia-smi",
      "expected": "Сверьте показанный артефакт или вывод с результатом шага: Установите NVIDIA Container Toolkit в WSL по официальной инструкции (или включите GPU-поддержку в Docker Desktop с бэкендом WSL2).",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "nvidia-smi",
      "expected": "Сверьте показанный артефакт или вывод с результатом шага: Проверьте: команда из инструкции — версию CUDA в теге выберите не новее той, что показывает nvidia-smi на хосте.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "nvidia-smi",
      "expected": "Сверьте показанный артефакт или вывод с результатом шага: Запустите vLLM из образа: команда из инструкции.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "nvidia-smi",
      "expected": "Сверьте показанный артефакт или вывод с результатом шага: Проверьте /v1/models.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "git show --stat --oneline HEAD",
      "expected": "В коммите и приложенном отчёте доступны вывод `nvidia-smi` из контейнера и ответ vLLM. Проверьте доступность каждого файла или ссылки.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    }
  ],
  "H3": [
    {
      "command": "kubectl get pods -A -o wide",
      "expected": "Сверьте показанный артефакт или вывод с результатом шага: Поднимите minikube с GPU: minikube start --driver docker --container-runtime docker --gpus all (или k3s внутри WSL).",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "kubectl get pods -A -o wide",
      "expected": "Сверьте показанный артефакт или вывод с результатом шага: Установите NVIDIA device plugin через Helm: репозиторий https://nvidia.github.io/k8s-device-plugin, chart nvidia-device-plugin.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "kubectl get pods -A -o wide",
      "expected": "Сверьте показанный артефакт или вывод с результатом шага: Проверьте команда из инструкции — в Allocatable должен появиться nvidia.com/gpu: 1.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "kubectl get pods -A -o wide",
      "expected": "Сверьте показанный артефакт или вывод с результатом шага: Запустите pod с resources.limits: {nvidia.com/gpu: 1} и командой nvidia-smi.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "kubectl get pods -A -o wide",
      "expected": "Сверьте показанный артефакт или вывод с результатом шага: Если в WSL не взлетает — отметьте «Заблокировано» с описанием ошибки или повторите на облачной GPU-VM.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "git show --stat --oneline HEAD",
      "expected": "В коммите и приложенном отчёте доступны вывод describe node и лог pod. Проверьте доступность каждого файла или ссылки.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    }
  ],
  "H4": [
    {
      "command": "kubectl get pods -A -o wide",
      "expected": "Сверьте показанный артефакт или вывод с результатом шага: Установите GPU Operator: Helm-репозиторий https://helm.ngc.nvidia.com/nvidia, chart nvidia/gpu-operator, команда из инструкции (драйвер уже на хосте).",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "kubectl get pods -A -o wide",
      "expected": "Сверьте показанный артефакт или вывод с результатом шага: Дождитесь, пока все pods в namespace gpu-operator станут Ready, и посмотрите логи validator.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "kubectl get pods -A -o wide",
      "expected": "Сверьте показанный артефакт или вывод с результатом шага: Найдите на ноде labels от GPU Feature Discovery (nvidia.com/gpu.product и др.).",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "kubectl get pods -A -o wide",
      "expected": "Сверьте показанный артефакт или вывод с результатом шага: Запишите назначение каждого компонента оператора.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "kubectl get pods -A -o wide",
      "expected": "Сверьте показанный артефакт или вывод с результатом шага: Если окружение не позволяет — «Заблокировано» или облачная GPU-VM на пару часов.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "git show --stat --oneline HEAD",
      "expected": "В коммите и приложенном отчёте доступны `kubectl get pods -n gpu-operator` и labels ноды. Проверьте доступность каждого файла или ссылки.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    }
  ],
  "H5": [
    {
      "command": "nvidia-smi",
      "expected": "Сверьте показанный артефакт или вывод с результатом шага: Убедитесь, что dcgm-exporter (из GPU Operator или отдельно) отдаёт метрики.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "nvidia-smi",
      "expected": "Сверьте показанный артефакт или вывод с результатом шага: Подключите к Prometheus через ServiceMonitor или статический scrape.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "nvidia-smi",
      "expected": "Сверьте показанный артефакт или вывод с результатом шага: Добавьте в дашборд D2 панели: DCGM_FI_DEV_GPU_UTIL, DCGM_FI_DEV_FB_USED, DCGM_FI_DEV_POWER_USAGE, температура, XID errors — рядом с метриками vLLM.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "nvidia-smi",
      "expected": "Сверьте показанный артефакт или вывод с результатом шага: Алерты: XID errors > 0, температура выше порога.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "git show --stat --oneline HEAD",
      "expected": "В коммите и приложенном отчёте доступны скриншот дашборда. Проверьте доступность каждого файла или ссылки.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    }
  ],
  "H7": [
    {
      "command": "git diff HEAD -- docs/capacity.md",
      "expected": "Сверьте показанный артефакт или вывод с результатом шага: Исходные данные: результаты benchmark из C3 (сколько параллельных запросов держит одна реплика в рамках SLO TTFT) и расчёт памяти из C0.1.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "git diff HEAD -- docs/capacity.md",
      "expected": "Сверьте показанный артефакт или вывод с результатом шага: Задайте сценарий нагрузки: пиковые параллельные запросы, средняя длина prompt и ответа, SLO на TTFT.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "git diff HEAD -- docs/capacity.md",
      "expected": "Сверьте показанный артефакт или вывод с результатом шага: Посчитайте число реплик (с округлением вверх и запасом N+1) и тип GPU.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "git diff HEAD -- docs/capacity.md",
      "expected": "Сверьте показанный артефакт или вывод с результатом шага: Посчитайте стоимость: GPU-часы × цена, стоимость 1M токенов при вашей утилизации; сравните с ценой внешнего провайдера.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "git diff HEAD -- docs/capacity.md",
      "expected": "Сверьте показанный артефакт или вывод с результатом шага: Опишите допущения и риски (пики, длинные контексты, рост трафика).",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    },
    {
      "command": "git show --stat --oneline HEAD",
      "expected": "В коммите и приложенном отчёте доступны `docs/capacity.md`. Проверьте доступность каждого файла или ссылки.",
      "scope": "В контейнере нужного инструмента своего проекта. Пути — из корня ai-platform-labs; имена сервисов, USER и DATABASE замените своей конфигурацией."
    }
  ],
  // пакеты контента (src/data/packs)
  ...packLabStepChecks,
}

export const guidedLabTasks = ['A0.1', 'A0.2', 'B1', 'B2', 'C0.1', 'C1', 'D0', 'D1', 'E1', 'E2', 'F1', 'F2', 'G1', 'G2', 'H1', 'H3']

export type LabQuestion = { kind: 'output'; prompt: string; field: 'ttft' | 'recall'; unit: string } | { kind: 'quiz'; prompt: string; options: string[]; correct: number; explanation: string }
export const labQuestions: Record<string, LabQuestion[]> = {
  C3: [{ kind: 'output', prompt: 'Какое значение TTFT p95 в миллисекундах показал ваш запуск? Вставьте JSON с p95_ttft_ms или строку P95 TTFT (ms) из результата vllm bench serve.', field: 'ttft', unit: 'мс' }],
  E5: [{ kind: 'output', prompt: 'Какой recall@5 получен на вашем размеченном dataset? Вставьте JSON с recall_at_5 или строку recall@5: значение из собственного отчёта.', field: 'recall', unit: 'доля' }],
  'A0.5': [{kind:'quiz',prompt:'Внутри корутины есть time.sleep(1). Что изменится после замены на await asyncio.sleep(1)?',options:['Ожидание перестанет блокировать event loop','Любой CPU-код корутины станет параллельным','Все остальные запросы будут отменены'],correct:0,explanation:'await освобождает event loop на время ожидания; CPU-вычисления сами по себе не становятся параллельными.'}],
}
