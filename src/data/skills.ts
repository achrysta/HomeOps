import type { Skill, Vacancy } from '../types'
import { packRequirements, packRoleRequirements, packSkills } from './packs'

// Каталог навыков (requirement catalog). Не привязан к конкретной роли:
// профили ролей ссылаются на skillId и задают свою важность и целевой уровень.
// baselineLevel — стартовый уровень программы (0): свой опыт пользователь указывает самооценкой с обоснованием.

export const skills: Skill[] = [
  // Required
  { id: 'python', title: 'Python для автоматизации, pipelines и API', description: 'Typed Python, async/await, pytest, FastAPI, HTTP-клиенты, packaging', baselineLevel: 0 },
  { id: 'docker', title: 'Docker', description: 'Образы, multi-stage build, compose', baselineLevel: 0 },
  { id: 'kubernetes', title: 'Kubernetes', description: 'Деплой и эксплуатация workloads в Kubernetes', baselineLevel: 0 },
  { id: 'cicd', title: 'CI/CD', description: 'GitLab CI, Jenkins, GitOps', baselineLevel: 0 },
  { id: 'ml-lifecycle', title: 'Жизненный цикл ML в production', description: 'Experiment → artifact → registry → deploy → monitor → rollback', baselineLevel: 0 },
  { id: 'model-serving', title: 'Вывод и сопровождение ML-моделей', description: 'Inference-сервисы, версии моделей, эксплуатация serving', baselineLevel: 0 },
  { id: 'ml-platform', title: 'Разработка ML-платформ и сервисов', description: 'Собственные сервисы платформы: gateway, workers, API', baselineLevel: 0 },
  { id: 'ml-monitoring', title: 'Мониторинг ML-систем', description: 'ML/LLM-специфичные метрики, SLO, качество, дрейф данных', baselineLevel: 0 },
  { id: 'async-pipelines', title: 'Асинхронные pipelines', description: 'Очереди задач, workers, retries, DLQ, идемпотентность', baselineLevel: 0 },
  { id: 'kafka', title: 'Kafka / RabbitMQ', description: 'Брокеры сообщений', baselineLevel: 0 },
  { id: 'llm-eval', title: 'Оценка качества LLM и агентов', description: 'Offline/online evaluation, метрики качества, experiments', baselineLevel: 0 },

  // Important — ключевые задачи роли
  { id: 'golden-datasets', title: 'Эталонные датасеты и LLM-as-a-Judge', description: 'Сбор и версионирование эталонных наборов, judge-оценки и их калибровка', baselineLevel: 0 },
  { id: 'retrieval-metrics', title: 'RAG и метрики поиска', description: 'Chunking, embeddings, recall@k, MRR, groundedness', baselineLevel: 0 },
  { id: 'eval-gates', title: 'Регрессионные проверки prompts и RAG в CI', description: 'Пороговые проверки качества, блокирующие merge/deploy', baselineLevel: 0 },
  { id: 'llm-gateway', title: 'LLM Gateway: маршрутизация, fallback, провайдеры', description: 'Маршрутизация между vLLM и внешними провайдерами, timeouts, fallback', baselineLevel: 0 },
  { id: 'llm-slo', title: 'LLM SLI/SLO: p95, RPS, uptime, TTFT', description: 'Latency-метрики LLM serving и их SLO', baselineLevel: 0 },
  { id: 'gpu-monitoring', title: 'Мониторинг загрузки GPU', description: 'Утилизация GPU, VRAM, DCGM-метрики', baselineLevel: 0 },
  { id: 'token-cost', title: 'Квоты на токены и GPU, учёт затрат', description: 'Учёт токенов, квоты по тенантам, стоимость запросов', baselineLevel: 0 },
  { id: 'logging-alerts', title: 'Централизованные логи и алертинг', description: 'Сбор логов, алертинг, корреляция', baselineLevel: 0 },
  { id: 'delivery', title: 'Canary и откат моделей и prompts', description: 'Прогрессивная выкладка версий моделей и prompts, откат', baselineLevel: 0 },
  { id: 'backup-restore', title: 'Резервное копирование и восстановление', description: 'Резервное копирование состояния платформы и restore drills', baselineLevel: 0 },
  { id: 'stt-pipeline', title: 'STT-пайплайн: транскрибация и саммаризация', description: 'Асинхронная обработка аудио: распознавание речи, саммари, статусы задач', baselineLevel: 0 },
  { id: 'queues-cache', title: 'Приоритетные очереди и семантический кэш', description: 'Приоритизация трафика и кэширование ответов LLM', baselineLevel: 0 },

  // Bonus — nice-to-have
  { id: 'vllm', title: 'vLLM', description: 'Запуск, тюнинг и эксплуатация vLLM', baselineLevel: 0 },
  { id: 'triton', title: 'Triton Inference Server', description: 'Понимание места Triton среди inference servers', baselineLevel: 0 },
  { id: 'inference-optimization', title: 'Батчинг, кэширование, оптимизация инференса', description: 'Continuous batching, prefix caching, quantization, benchmark', baselineLevel: 0 },
  { id: 'llm-observability', title: 'Langfuse / LangSmith / OpenTelemetry', description: 'LLM tracing и observability', baselineLevel: 0 },
  { id: 'experiment-tracking', title: 'MLflow / ClearML / Kubeflow / W&B', description: 'Experiment tracking и model registry', baselineLevel: 0 },
  { id: 'iac', title: 'Ansible и конфигурация серверов', description: 'Роли и inventory, идемпотентность, check и diff, handlers; Terraform — отдельный навык', baselineLevel: 0 },
  { id: 'gitlab-ci', title: 'GitLab CI / GitHub Actions', description: 'Pipelines as code', baselineLevel: 0 },
  { id: 'gpu-clusters', title: 'GPU-кластеры', description: 'Device Plugin, GPU Operator, DCGM, GPU scheduling', baselineLevel: 0 },

  // DevOps / Platform — основа платформенной роли; подтверждаются задачами и решёнными стендами
  { id: 'linux', title: 'Linux: эксплуатация серверов', description: 'systemd и journald, диски и файловые системы, процессы, память и лимиты, права, cron', baselineLevel: 0 },
  { id: 'networking', title: 'Сети: DNS, TLS, балансировка, Ingress и CNI', description: 'Диагностика сети хоста и кластера, L4/L7-балансировка, сертификаты, сетевые плагины', baselineLevel: 0 },
  { id: 'k8s-security', title: 'Безопасность Kubernetes', description: 'RBAC, ServiceAccount, Pod Security, NetworkPolicy, секреты и сертификаты кластера', baselineLevel: 0 },
  { id: 'postgresql-ops', title: 'PostgreSQL в эксплуатации', description: 'Репликация и failover, WAL и слоты, PITR, VACUUM, блокировки, производительность запросов', baselineLevel: 0 },

  // Advanced — следующий карьерный уровень, не входит в Vacancy Match
  { id: 'adv-triton', title: 'Triton Inference Server (глубоко)', description: 'Model repository, dynamic batching, ensembles, backends', baselineLevel: 0 },
  { id: 'adv-multi-gpu', title: 'Несколько GPU и torch.distributed', description: 'Tensor/pipeline parallelism, distributed inference', baselineLevel: 0 },
  { id: 'adv-interconnect', title: 'NCCL, PCIe / NVLink', description: 'Коллективные операции и топология GPU', baselineLevel: 0 },
  { id: 'adv-rdma', title: 'RDMA / InfiniBand / GPUDirect', description: 'Высокоскоростные сети для GPU-кластеров', baselineLevel: 0 },
  { id: 'adv-batch-schedulers', title: 'Kueue / Volcano / Slurm', description: 'Gang scheduling, квоты, fair-share для GPU-нагрузок', baselineLevel: 0 },
  { id: 'adv-trtllm', title: 'TensorRT-LLM', description: 'Компиляция engines, in-flight batching, FP8', baselineLevel: 0 },
  // пакеты контента (src/data/packs)
  ...packSkills,
]


// ─────────────────────────────────────────────────────────────────────────────
// Целевые роли (профили требований). Требования — структурированные объекты: добавьте новый профиль —
// обобщённую роль или конкретную вакансию (с полем company) — // в этот массив, и Vacancy Match пересчитается для неё автоматически.
// Тексты вакансий не копируются — только краткое структурированное описание.
// ─────────────────────────────────────────────────────────────────────────────

export const vacancies: Vacancy[] = [
  {
    id: 'mlops-ai-platform',
    title: 'MLOps Engineer / AI Platform Engineer',
    sources: ['Анализ рынка, октябрь 2026: 69 вакансий РФ и 169 зарубежных'],
    summary:
      'Инженер, который развивает и эксплуатирует AI-платформу в production: качество LLM и RAG через evaluation и CI-гейты, мониторинг ML-систем, собственный GPU inference и внешние провайдеры, квоты и стоимость. Профиль собран по реальным вакансиям рынка.',
    platform: ['LLM Gateway с квотами', 'RAG', 'Агентные сценарии', 'Трассировка', 'Собственный инференс на GPU'],
    responsibilities: [
      'Эталонные датасеты, LLM-as-a-Judge, recall@k и groundedness',
      'Регрессионные проверки prompts и RAG в CI',
      'Мониторинг ML: p95 / RPS / uptime, загрузка GPU, расход токенов',
      'Централизованные логи и алерты',
      'vLLM и внешние провайдеры моделей: маршрутизация, fallback, семантический кэш',
      'Квоты на GPU и токены, приоритетные очереди, учёт затрат',
      'CI/CD, canary, откат, резервное копирование и восстановление',
      'Проактивный поиск проблем качества на живом трафике',
      'STT-пайплайн: транскрибация и саммаризация встреч',
    ],
    requirements: [
      { skillId: 'ml-lifecycle', importance: 'required', targetLevel: 3, summary: 'Жизненный цикл ML в production' },
      { skillId: 'model-serving', importance: 'required', targetLevel: 3, summary: 'Вывод и сопровождение ML-моделей' },
      { skillId: 'docker', importance: 'required', targetLevel: 3, summary: 'Docker' },
      { skillId: 'kubernetes', importance: 'required', targetLevel: 3, summary: 'Kubernetes' },
      { skillId: 'cicd', importance: 'required', targetLevel: 3, summary: 'CI/CD' },
      { skillId: 'ml-platform', importance: 'required', targetLevel: 3, summary: 'Разработка ML-платформ / сервисов' },
      { skillId: 'ml-monitoring', importance: 'required', targetLevel: 3, summary: 'Мониторинг ML-систем: latency, uptime, ошибки, дрейф' },
      { skillId: 'async-pipelines', importance: 'required', targetLevel: 3, summary: 'Асинхронные pipelines' },
      { skillId: 'kafka', importance: 'required', targetLevel: 3, summary: 'Kafka или RabbitMQ' },
      { skillId: 'python', importance: 'required', targetLevel: 3, summary: 'Уверенный Python: автоматизация, скрипты, ML pipelines, API' },
      { skillId: 'llm-eval', importance: 'required', targetLevel: 3, summary: 'Понимание оценки качества LLM и агентов' },

      { skillId: 'golden-datasets', importance: 'important', targetLevel: 3, summary: 'Эталонные датасеты, LLM-as-a-Judge' },
      { skillId: 'retrieval-metrics', importance: 'important', targetLevel: 3, summary: 'Метрики поиска: recall@k, groundedness' },
      { skillId: 'eval-gates', importance: 'important', targetLevel: 3, summary: 'Регрессионные проверки prompts и RAG в CI' },
      { skillId: 'llm-gateway', importance: 'important', targetLevel: 3, summary: 'Внешние провайдеры, маршрутизация, fallback' },
      { skillId: 'llm-slo', importance: 'important', targetLevel: 3, summary: 'p95 / RPS / uptime' },
      { skillId: 'gpu-monitoring', importance: 'important', targetLevel: 2, summary: 'Загрузка GPU' },
      { skillId: 'token-cost', importance: 'important', targetLevel: 2, summary: 'Расход токенов, квоты на GPU и токены, учёт затрат' },
      { skillId: 'logging-alerts', importance: 'important', targetLevel: 3, summary: 'Централизованные логи и алерты' },
      { skillId: 'delivery', importance: 'important', targetLevel: 3, summary: 'Canary, откат' },
      { skillId: 'backup-restore', importance: 'important', targetLevel: 3, summary: 'Резервное копирование и восстановление' },
      { skillId: 'queues-cache', importance: 'important', targetLevel: 2, summary: 'Приоритетные очереди, семантический кэш' },
      { skillId: 'stt-pipeline', importance: 'important', targetLevel: 2, summary: 'Транскрибация и саммаризация встреч' },

      { skillId: 'vllm', importance: 'bonus', targetLevel: 3, summary: 'vLLM' },
      { skillId: 'triton', importance: 'bonus', targetLevel: 1, summary: 'Triton' },
      { skillId: 'inference-optimization', importance: 'bonus', targetLevel: 2, summary: 'Батчинг, кэширование, оптимизация инференса' },
      { skillId: 'llm-observability', importance: 'bonus', targetLevel: 3, summary: 'Langfuse / LangSmith / OpenTelemetry' },
      { skillId: 'experiment-tracking', importance: 'bonus', targetLevel: 2, summary: 'MLflow / ClearML / Kubeflow / W&B' },
      { skillId: 'terraform', importance: 'bonus', targetLevel: 2, summary: 'Terraform / OpenTofu' },
      { skillId: 'iac', importance: 'bonus', targetLevel: 2, summary: 'Ansible' },
      { skillId: 'gitlab-ci', importance: 'bonus', targetLevel: 3, summary: 'GitLab CI / GitHub Actions' },
      { skillId: 'gpu-clusters', importance: 'bonus', targetLevel: 2, summary: 'GPU-кластеры' },

      { skillId: 'adv-triton', importance: 'advanced', targetLevel: 3, summary: 'Triton Inference Server (глубоко)' },
      { skillId: 'adv-multi-gpu', importance: 'advanced', targetLevel: 2, summary: 'Несколько GPU, torch.distributed' },
      { skillId: 'adv-interconnect', importance: 'advanced', targetLevel: 2, summary: 'NCCL, PCIe/NVLink' },
      { skillId: 'adv-rdma', importance: 'advanced', targetLevel: 2, summary: 'RDMA, InfiniBand' },
      { skillId: 'adv-batch-schedulers', importance: 'advanced', targetLevel: 2, summary: 'Kueue, Volcano, Slurm' },
      { skillId: 'adv-trtllm', importance: 'advanced', targetLevel: 2, summary: 'TensorRT-LLM' },
      // пакеты контента (src/data/packs)
      ...packRequirements,
    ],
  },
  {
    id: 'platform-engineer',
    title: 'DevOps / Platform Engineer',
    sources: ['Анализ рынка, ноябрь 2026: 39 платформенных и 207 DevOps-вакансий РФ, 50 зарубежных платформенных'],
    summary:
      'Инженер внутренней платформы: Kubernetes-кластеры и путь кода в production для команд разработки — CI/CD, инфраструктура как код, наблюдаемость, сеть и безопасность, эксплуатация баз и брокеров. В России такие вакансии чаще называются DevOps или SRE в платформенной команде. ML/AI-платформа — специализация, отдельный профиль.',
    platform: ['Kubernetes-кластеры', 'CI/CD', 'Метрики, логи и алерты', 'PostgreSQL и Kafka', 'Доступы и секреты'],
    responsibilities: [
      'Эксплуатация и развитие Kubernetes-кластеров',
      'Пайплайны CI/CD и шаблоны выкатки для команд',
      'Инфраструктура как код и конфигурация серверов',
      'Метрики, логи, алерты и разбор инцидентов',
      'Сеть кластера, Ingress, сертификаты и доступы',
      'Эксплуатация PostgreSQL и Kafka, резервное копирование и восстановление',
    ],
    // Новые навыки (секреты, наблюдаемость платформы, self-service) добавляются вместе со своими
    // треками: у каждого требования должны быть вопросы «Своими словами» и практика.
    requirements: [
      { skillId: 'kubernetes', importance: 'required', targetLevel: 3, summary: 'Kubernetes: деплой, эксплуатация, диагностика' },
      { skillId: 'linux', importance: 'required', targetLevel: 3, summary: 'Linux: systemd, диски, память, процессы' },
      { skillId: 'docker', importance: 'required', targetLevel: 3, summary: 'Контейнеры и образы' },
      { skillId: 'cicd', importance: 'required', targetLevel: 3, summary: 'CI/CD' },
      { skillId: 'logging-alerts', importance: 'required', targetLevel: 3, summary: 'Метрики, логи и алерты' },
      { skillId: 'python', importance: 'required', targetLevel: 3, summary: 'Python для автоматизации' },
      { skillId: 'postgresql-ops', importance: 'required', targetLevel: 3, summary: 'PostgreSQL в эксплуатации' },
      { skillId: 'iac', importance: 'required', targetLevel: 3, summary: 'Ansible: роли и идемпотентность' },

      { skillId: 'networking', importance: 'important', targetLevel: 3, summary: 'DNS, TLS, балансировка, Ingress, CNI' },
      { skillId: 'gitlab-ci', importance: 'important', targetLevel: 3, summary: 'GitLab CI / GitHub Actions' },
      { skillId: 'backup-restore', importance: 'important', targetLevel: 3, summary: 'Резервное копирование и восстановление' },
      { skillId: 'k8s-security', importance: 'important', targetLevel: 2, summary: 'RBAC, Pod Security, NetworkPolicy' },
      { skillId: 'kafka', importance: 'important', targetLevel: 2, summary: 'Kafka / RabbitMQ в эксплуатации' },

      // специализация ML/AI-платформа — подробно в профиле MLOps / AI Platform Engineer
      { skillId: 'model-serving', importance: 'bonus', targetLevel: 2, summary: 'Вывод и сопровождение ML-моделей' },
      { skillId: 'ml-lifecycle', importance: 'bonus', targetLevel: 2, summary: 'Жизненный цикл ML в production' },
      { skillId: 'gpu-clusters', importance: 'bonus', targetLevel: 2, summary: 'GPU в Kubernetes' },
      // треки платформы (src/data/packs): Terraform/OpenTofu, GitOps и следующие
      ...packRoleRequirements('platform-engineer'),
    ],
  },
]
