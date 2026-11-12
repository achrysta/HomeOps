// Пакет «Пайплайны и доставка на Kubernetes»: Airflow в треке B, KServe и GitOps-доставка в треке G.
// Основание — анализ рынка: Airflow в 22% вакансий РФ,
// KServe/Kubeflow — 10–13%, Helm/Argo CD — 17–22%.
import { interviewQuestion as q, resource as r, task as t } from '../../builders'
import type { ContentPack } from '../index'

export const pack: ContentPack = {
  id: 'pipelines',
  skills: [
    {
      id: 'pipeline-orchestration',
      title: 'Оркестрация ML-пайплайнов',
      description: 'Airflow: DAG и зависимости, повторы и идемпотентные задачи, расписание, catchup и backfill, сенсоры и алерты; связь с MLflow и хранилищем артефактов',
      baselineLevel: 0,
    },
    {
      id: 'k8s-model-serving',
      title: 'Model serving на Kubernetes',
      description: 'KServe: InferenceService, runtime и storage-initializer, модели из S3, протоколы V1/V2, режимы Standard и serverless, автомасштабирование',
      baselineLevel: 0,
    },
    {
      id: 'gitops-delivery',
      title: 'GitOps: Argo CD и Argo Rollouts',
      description: 'Приложения, проекты и ApplicationSet Argo CD, prune и self-heal, canary с анализом метрик, откат через git',
      baselineLevel: 0,
    },
  ],
  requirements: [
    { skillId: 'pipeline-orchestration', importance: 'important', targetLevel: 3, summary: 'Airflow: пайплайны обучения и переобучения' },
    { skillId: 'k8s-model-serving', importance: 'important', targetLevel: 3, summary: 'KServe / Kubeflow: serving моделей в Kubernetes' },
    { skillId: 'gitops-delivery', importance: 'bonus', targetLevel: 2, summary: 'Argo CD, Argo Rollouts: доставка моделей через git' },
  ],
  resources: [
    r('ru-habr-mlops-kts', 'MLOps-пазл: как мы собрали единый конвейер для ML-моделей из разрозненных инструментов', 'article', 'https://habr.com/ru/companies/kts/articles/993670/', 'Хабр, KTS: MLflow, Airflow и KServe в одном конвейере', 'ru'),
    r('ru-habr-autoretrain-alfa', 'Автопереобучение моделей в Production', 'article', 'https://habr.com/ru/companies/alfa/articles/821447/', 'Хабр, Альфа-Банк: Airflow, MLflow и метки моделей', 'ru'),
    r('ru-habr-airflow-ml-tutorial', 'Пишем первый ML-пайплайн на Airflow: подробный туториал', 'article', 'https://habr.com/ru/articles/737046/', 'Хабр', 'ru'),
    r('ru-habr-airflow-dag-design', 'Все, что вам нужно знать об Airflow DAGs, ч.3 — Проектирование DAG', 'article', 'https://habr.com/ru/articles/682714/', 'Хабр: идемпотентность и атомарность задач', 'ru'),
    r('ru-habr-argo-workflows-alfa', 'GitOps для Airflow: как мы перешли на лёгкий K8s-native Argo Workflows', 'article', 'https://habr.com/ru/companies/alfa/articles/947754/', 'Хабр, Альфа-Банк: Airflow против Argo Workflows на сотнях моделей', 'ru'),
    r('ru-habr-argo-rollouts-slurm', 'Argo Rollouts с примерами', 'article', 'https://habr.com/ru/companies/slurm/articles/704502/', 'Хабр, Слёрм', 'ru'),
    r('airflow-dags', 'Airflow — Dags', 'docs', 'https://airflow.apache.org/docs/apache-airflow/stable/core-concepts/dags.html'),
    r('airflow-best-practices', 'Airflow — Best Practices', 'docs', 'https://airflow.apache.org/docs/apache-airflow/stable/best-practices.html', 'Идемпотентность, верхний уровень DAG-файла, тестирование'),
    r('airflow-docker', 'Running Airflow in Docker', 'docs', 'https://airflow.apache.org/docs/apache-airflow/stable/howto/docker-compose/index.html', 'Официальный compose Airflow 3'),
    r('airflow-backfill', 'Airflow — Backfill', 'docs', 'https://airflow.apache.org/docs/apache-airflow/stable/core-concepts/backfill.html', 'airflow backfill create, reprocess behavior'),
    r('kserve-intro', 'KServe — Welcome', 'docs', 'https://kserve.github.io/website/docs/intro'),
    r('kserve-install', 'KServe — Install KServe', 'docs', 'https://kserve.github.io/website/docs/install/kserve-install', 'Режим Standard без Knative, Helm-чарты'),
    r('kserve-quickstart', 'KServe — Quickstart Guide', 'docs', 'https://kserve.github.io/website/docs/getting-started/quickstart-guide'),
    r('kserve-storage', 'KServe — Model Storage', 'docs', 'https://kserve.github.io/website/docs/model-serving/storage/overview', 'S3, GCS, PVC и storage-initializer'),
    r('argocd-concepts', 'Argo CD — Core Concepts', 'docs', 'https://argo-cd.readthedocs.io/en/stable/core_concepts/'),
    r('argo-rollouts-analysis', 'Argo Rollouts — Analysis & Progressive Delivery', 'docs', 'https://argo-rollouts.readthedocs.io/en/stable/features/analysis/', 'AnalysisTemplate, AnalysisRun, Prometheus'),
  ],
  tasks: [
    t({
      id: 'B6', trackId: 'ml-lifecycle', kind: 'lab', priority: 'P1',
      title: 'Airflow: DAG обучения с MLflow и MinIO',
      description:
        'Airflow 3 в Docker Compose и DAG train_model: подготовка данных → обучение (модель B1 или CatBoost) → оценка → запись run в MLflow с артефактом в MinIO. У задач — повторы и таймауты; каждая задача идемпотентна: результат пишется по интервалу данных запуска, повторный запуск того же интервала не создаёт дублей.',
      prerequisites: ['B2'],
      resourceIds: ['ru-habr-airflow-ml-tutorial', 'ru-habr-airflow-dag-design', 'ru-habr-mlops-kts', 'airflow-docker', 'airflow-dags', 'airflow-best-practices'],
      acceptanceCriteria: [
        'DAG train_model проходит и пишет run в MLflow с артефактом в MinIO',
        'У задач заданы retries и execution_timeout; повторный запуск того же интервала не создаёт дублей',
        'Конфигурация Airflow и DAG лежат в репозитории, запуск — docker compose',
      ],
      tags: ['airflow', 'mlflow', 'lab'], vacancyRequirementIds: ['pipeline-orchestration', 'ml-lifecycle', 'experiment-tracking'],
    }),
    t({
      id: 'B7', trackId: 'ml-lifecycle', kind: 'lab', priority: 'P1',
      title: 'Условная регистрация и выкатка модели из DAG',
      description:
        'DAG сравнивает метрику candidate с текущим champion из MLflow Model Registry на одном наборе. При улучшении регистрирует candidate и вызывает выкатку; champion меняется после её успешной проверки. Для GitOps создание MR ещё не означает успешную выкатку; при отказе gate прежний champion сохраняется.',
      prerequisites: ['B6', 'B3'],
      resourceIds: ['ru-habr-autoretrain-alfa', 'ru-habr-mlops-kts', 'airflow-dags'],
      acceptanceCriteria: [
        'Модель хуже champion не получает алиас — DAG пропускает выкатку с понятной причиной',
        'Модель лучше — новая версия с алиасом champion, выкатка вызвана из DAG',
        'В логах задачи видны метрики обеих версий и принятое решение',
      ],
      tags: ['airflow', 'registry', 'lab'], vacancyRequirementIds: ['pipeline-orchestration', 'ml-lifecycle'],
    }),
    t({
      id: 'B8', trackId: 'ml-lifecycle', kind: 'integration', priority: 'P2',
      title: 'Пайплайн по расписанию: backfill, ожидание данных и алерты',
      description:
        'Ежедневный запуск без catchup, ожидание свежей партиции данных с таймаутом, алерт при падении задачи с названием DAG, задачи и интервала, backfill за прошлые дни через airflow backfill create с ограничением параллелизма. Повторная обработка интервала не плодит версии в MLflow и файлы в хранилище.',
      prerequisites: ['B7'],
      resourceIds: ['ru-habr-autoretrain-alfa', 'ru-habr-airflow-dag-design', 'ru-habr-argo-workflows-alfa', 'airflow-backfill', 'airflow-best-practices'],
      acceptanceCriteria: [
        'Backfill за три прошлых дня проходит без дублей в MLflow и хранилище',
        'Без свежих данных DAG ждёт и завершается понятным статусом по таймауту',
        'Падение задачи приводит к алерту с названием DAG, задачи и интервала',
      ],
      tags: ['airflow', 'backfill', 'lab'], vacancyRequirementIds: ['pipeline-orchestration', 'logging-alerts'],
    }),
    t({
      id: 'G7', trackId: 'cicd', kind: 'lab', priority: 'P1',
      title: 'KServe: InferenceService на кластере kind',
      description:
        'KServe 0.20 в режиме Standard (обычный Deployment, без Knative) через Helm-чарты и cert-manager. Модель из Model Registry (B3) лежит в MinIO: InferenceService со storageUri s3://, ServiceAccount с секретом доступа к S3, runtime для формата модели, requests/limits, minReplicas/maxReplicas. Запрос по протоколу V2.',
      prerequisites: ['B3'],
      resourceIds: ['ru-habr-mlops-kts', 'kserve-intro', 'kserve-install', 'kserve-quickstart', 'kserve-storage'],
      acceptanceCriteria: [
        'InferenceService в статусе Ready, модель загружена из MinIO через storage-initializer',
        'Запрос по протоколу V2 возвращает предсказание',
        'Заданы requests/limits и minReplicas/maxReplicas; под нагрузкой растёт число реплик',
      ],
      tags: ['kserve', 'kubernetes', 'lab'], vacancyRequirementIds: ['k8s-model-serving', 'model-serving', 'kubernetes'],
    }),
    t({
      id: 'G8', trackId: 'cicd', kind: 'lab', priority: 'P1',
      title: 'GitOps-доставка модели: Argo CD и Argo Rollouts',
      description:
        'Argo CD Application синхронизирует сервис модели из папки деплоя в git (auto-sync, self-heal, prune). Сервис — Argo Rollout с canary 20 → 50 → 100 и AnalysisTemplate по метрикам Prometheus (доля ошибок и p95 canary). Плохая версия автоматически прерывается анализом и откатывается; откат в git — git revert.',
      prerequisites: ['G3'],
      resourceIds: ['ru-habr-argo-rollouts-slurm', 'ru-habr-canary-prom', 'ru-habr-canary-flant', 'argocd-concepts', 'argo-rollouts-analysis', 'argo-canary'],
      acceptanceCriteria: [
        'Argo CD синхронизирует приложение из git; ручная правка в кластере откатывается self-heal',
        'Rollout проходит шаги canary с анализом метрик Prometheus',
        'Плохая версия прерывается анализом и откатывается без ручных команд',
      ],
      tags: ['argocd', 'rollouts', 'lab'], vacancyRequirementIds: ['gitops-delivery', 'delivery'],
    }),
    t({
      id: 'G9', trackId: 'cicd', kind: 'integration', priority: 'P2',
      title: 'Модель из пайплайна до production через GitOps',
      description:
        'Продвижение модели в DAG (B7) открывает MR в репозиторий деплоя с новой версией модели. CI прогоняет eval gate (G2), после merge Argo CD синхронизирует, Rollout проводит canary с анализом. Версия в MLflow, коммит и ревизия rollout связаны; откат — git revert.',
      prerequisites: ['B7', 'G8', 'G2'],
      resourceIds: ['ru-habr-mlops-kts', 'ru-habr-argo-workflows-alfa', 'argocd-concepts', 'argo-rollouts-analysis'],
      acceptanceCriteria: [
        'Новая версия модели попадает в production только через MR в репозиторий деплоя',
        'Видна связь версии MLflow, коммита и ревизии rollout',
        'Откат выполнен git revert: Argo CD вернул предыдущую версию',
      ],
      tags: ['gitops', 'airflow', 'lab'], vacancyRequirementIds: ['gitops-delivery', 'pipeline-orchestration', 'delivery', 'eval-gates'],
    }),
  ],
  taskEstimates: {
    B6: { minMinutes: 180, maxMinutes: 300, level: 'practice' },
    B7: { minMinutes: 120, maxMinutes: 240, level: 'practice' },
    B8: { minMinutes: 180, maxMinutes: 300, level: 'challenge' },
    G7: { minMinutes: 180, maxMinutes: 300, level: 'challenge' },
    G8: { minMinutes: 180, maxMinutes: 300, level: 'challenge' },
    G9: { minMinutes: 240, maxMinutes: 420, level: 'challenge' },
  },
  interviewTopics: [
    {
      id: 'iv-mlpipe',
      title: 'ML-пайплайны и доставка на Kubernetes',
      group: 'mlops',
      trackIds: ['ml-lifecycle', 'cicd'],
      skillIds: ['pipeline-orchestration', 'k8s-model-serving', 'gitops-delivery'],
      incidentIds: ['airflow-retrain', 'kserve-isvc'],
      questions: [
        q('iv-mp-1', 'Зачем оркестратор вроде Airflow, если есть cron и CI?', [
          'DAG зависимостей и история каждого запуска по интервалам данных',
          'Повторы, таймауты, ожидание данных и backfill из коробки',
          'CI — для изменений кода, оркестратор — для работы с данными по расписанию',
          'Видно, какая задача какого интервала упала, и её можно перезапустить',
        ], 'Запускать обучение в CI по cron без истории запусков и повторов.', ['pipeline-orchestration']),
        q('iv-mp-2', 'Что значит идемпотентная задача в Airflow и почему это важно?', [
          'Повтор того же интервала даёт тот же результат',
          'Запись по интервалу данных запуска: перезапись или upsert вместо дописывания',
          'Без идемпотентности retries и backfill создают дубли',
          'Тяжёлую работу не делают на верхнем уровне DAG-файла — его постоянно разбирает планировщик',
        ], 'Дописывать результат в общую таблицу при каждом запуске.', ['pipeline-orchestration']),
        q('iv-mp-3', 'Как устроены catchup и backfill?', [
          'Catchup создаёт пропущенные интервалы при включении DAG',
          'Backfill — явный диапазон дат, в Airflow 3 — airflow backfill create',
          'Поведение при повторе: только отсутствующие, упавшие или все запуски',
          'Ограничивать параллелизм и нагрузку на источники, задачи должны быть идемпотентны',
        ], 'Включить DAG с catchup и стартовой датой год назад.', ['pipeline-orchestration']),
        q('iv-mp-4', 'Как пайплайн решает, выкатывать ли новую модель?', [
          'Метрики candidate и champion на одном наборе данных',
          'Порог улучшения, алиас champion — только при улучшении',
          'Ветка пропуска с причиной в логе, а не тихое завершение',
          'Выкатка через MR в репозиторий деплоя и canary, а не прямой kubectl',
        ], 'Автоматически выкатывать каждую обученную модель.', ['pipeline-orchestration']),
        q('iv-mp-5', 'Что делает KServe и из чего состоит InferenceService?', [
          'CRD поверх Kubernetes для serving моделей',
          'Predictor: runtime для формата модели и storageUri',
          'storage-initializer скачивает модель из S3, GCS или PVC до старта сервера',
          'Режимы: Standard (обычный Deployment) и serverless на Knative с scale-to-zero',
          'Протоколы V1 и V2 (Open Inference Protocol)',
        ], 'Считать KServe инференс-сервером — это управляющий слой поверх серверов.', ['k8s-model-serving']),
        q('iv-mp-6', 'InferenceService не становится Ready. Как разбираться?', [
          'kubectl describe inferenceservice и события пода',
          'Логи init-контейнера storage-initializer: доступ к S3, ключи, endpoint, путь',
          'Совпадают ли формат модели и runtime',
          'Ресурсы и readiness: OOM при загрузке, слишком короткий порог проверки',
        ], 'Смотреть только логи predictor, не заглянув в init-контейнер.', ['k8s-model-serving']),
        q('iv-mp-7', 'Как сделать canary модели с автоматическим откатом?', [
          'Argo Rollouts: шаги веса трафика и паузы',
          'AnalysisTemplate: ошибки, латентность и бизнес-метрика canary из Prometheus',
          'Метрики разделены по версии, иначе stable маскирует проблему',
          'Провал анализа — abort и возврат к stable без ручных команд',
        ], 'Сравнивать метрики canary, не разделяя их по версии.', ['gitops-delivery']),
        q('iv-mp-8', 'Что такое GitOps и как он меняет выкатку моделей?', [
          'Желаемое состояние в git, контроллер сверяет и синхронизирует кластер',
          'Аудит изменений и откат через git revert',
          'Ручные правки в кластере откатываются self-heal',
          'Версия модели в манифесте связывает реестр моделей и коммит',
        ], 'Править кластер руками в обход git.', ['gitops-delivery']),
        q('iv-mp-9', 'Airflow, Kubeflow Pipelines или Argo Workflows — что выбрать?', [
          'Airflow — расписания и данные, зрелая экосистема операторов',
          'Kubeflow Pipelines — ML-эксперименты на Kubernetes с артефактами и метаданными',
          'Argo Workflows — K8s-native, каждый шаг — под, удобно вместе с GitOps',
          'Выбор по команде, масштабу и инфраструктуре, а не по моде',
        ], 'Выбирать инструмент, не учитывая, кто и как будет его поддерживать.', ['pipeline-orchestration']),
      ],
    },
  ],
}
