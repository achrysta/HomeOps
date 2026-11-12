// Пошаговые планы пакета «Пайплайны и доставка на Kubernetes». Папки — в репозитории ai-platform-labs:
// pipelines/airflow/ (compose и DAG), ml/ (код обучения из B1), deploy/ (манифесты, Argo CD).
export const steps: Record<string, string[]> = {
  B6: [
    'Возьмите официальный `docker-compose.yaml` Airflow 3 (сервисы airflow-api-server, airflow-scheduler, airflow-dag-processor, postgres; для учебного стенда переключите AIRFLOW__CORE__EXECUTOR=LocalExecutor, уберите redis и airflow-worker и все depends_on на них; остальные службы и общие настройки официального Compose сохраните) в `pipelines/airflow/`; дайте Docker не меньше 4 ГБ памяти, выполните `docker compose up airflow-init`, затем `docker compose up -d`.',
    'Подключите MLflow и MinIO из B2: переменные `MLFLOW_TRACKING_URI`, `MLFLOW_S3_ENDPOINT_URL`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` в сервисах Airflow, общая сеть compose; зависимости (`mlflow`, `scikit-learn` или `catboost`) — в своём образе на базе apache/airflow.',
    'DAG `pipelines/airflow/dags/train_model.py` на TaskFlow API: `prepare_data` → `train` → `evaluate` → `log_to_mlflow`; путь входной партиции строится из `data_interval_start`; ключ результата — интервал + hash данных/конфига/кода (tag `logical_key` в MLflow), `run_id` хранится как идентификатор попытки, тяжёлые импорты — внутри задач, а не на верхнем уровне файла.',
    '`default_args`: `retries=2`, `retry_delay=timedelta(minutes=1)`, `execution_timeout=timedelta(minutes=15)`; запись результата — перезапись файла интервала, а не дописывание.',
    'Запустите DAG вручную, затем повторите тот же интервал (Clear в интерфейсе): в MinIO один артефакт на интервал, в MLflow повтор использует тот же logical run по ключу interval + dataset/config/code hash; номер попытки сохраняется отдельно. Для нового эксперимента с другим конфигом нужен другой ключ.',
    'Подтверждение: коммит `pipelines/airflow/`, скриншот графа успешного запуска и run в MLflow.',
  ],
  B7: [
    'Задача `compare` получает метрику candidate из run текущего запуска и метрику версии с алиасом `champion` (`MlflowClient().get_model_version_by_alias`) на том же оценочном наборе.',
    'Ветвление: `@task.branch` возвращает `register` при улучшении больше порога из `pipelines/airflow/config.yaml`, иначе `skip_deploy`; первая модель без champion регистрируется сразу.',
    '`register`: найдите уже зарегистрированную версию по run id; если её нет, вызовите `mlflow.register_model`, затем установите alias candidate. Сохраните прежний champion до выкатки: `skip_deploy` пишет метрики и порог, но не меняет champion.',
    '`deploy`: выкатка B4 либо MR для G9; повтор по номеру версии идемпотентен. Champion обновляйте после успешной выкатки/проверки. Если это MR, ожидание merge, CI gate и canary — отдельный этап; создание MR ещё не подтверждает deployment.',
    'Проверьте обе ветки: ухудшите модель параметром запуска (`dag_run.conf`) — выкатки нет; верните — новая версия с алиасом champion.',
    'Подтверждение: коммит, два запуска (пропуск и выкатка) и история алиаса в MLflow.',
  ],
  B8: [
    'Расписание `@daily`, `catchup=False`, `max_active_runs=1`; данные приходят партициями `data/date=YYYY-MM-DD/` в MinIO.',
    'Ожидание данных: сенсор на объект партиции интервала с `mode="reschedule"`, `timeout=2 часа`, `poke_interval=5 минут`; по таймауту запуск завершается понятным статусом, а не висит.',
    '`on_failure_callback` отправляет алерт (webhook Alertmanager из трека D или учебный endpoint) с `dag_id`, `task_id`, интервалом и ссылкой на лог.',
    'Backfill за три прошлых дня: `airflow backfill create --dag-id train_model --from-date <дата> --to-date <дата> --reprocess-behavior failed --max-active-runs 1` (в контейнере airflow-api-server или через интерфейс).',
    'Проверка дублей: напишите `pipelines/airflow/dags/check_logical_runs.py`: через MlflowClient.search_runs сгруппируйте run по tag logical_key и завершите проверку с ошибкой при дубле. После backfill и повтора — по одному run и набору артефактов на ключ interval + dataset/config/code hash; разные конфигурации — не дубли. Папка dags монтируется в /opt/airflow/dags официального Compose.',
    'Подтверждение: коммит, вывод backfill, пример алерта и короткий runbook в `docs/runbooks/airflow.md`.',
  ],
  G7: [
    'На кластере kind поставьте cert-manager и KServe 0.20 в режиме Standard: `helm install kserve-crd oci://ghcr.io/kserve/charts/kserve-crd --version v0.20.0 -n kserve --create-namespace`, затем `helm install kserve-resources oci://ghcr.io/kserve/charts/kserve-resources --version v0.20.0 -n kserve --set kserve.controller.deploymentMode=Standard --wait`. Проверьте `kubectl get clusterservingruntime kserve-sklearnserver`; если runtime не установлен чартом, примените его YAML из config/runtimes релиза v0.20.0.',
    'MinIO из B2 доступен кластеру. Экспортируйте sklearn-модель из конкретной версии Registry в `model.joblib` с совместимой версией sklearn; выложите папку с файлом в `s3://models/<имя>/<версия>/`, сохраните SHA-256 и эталон локального predict.',
    'Доступ к S3: Secret с ключами и аннотациями endpoint и региона для KServe, ServiceAccount `kserve-s3` с этим Secret (формат аннотаций — в разделе Model Storage документации KServe).',
    '`deploy/kserve/model.yaml`: InferenceService с аннотациями `serving.kserve.io/deploymentMode: Standard`, `serving.kserve.io/autoscalerClass: hpa`. У predictor задайте serviceAccountName, minReplicas=1/maxReplicas=3, scaleTarget=60 и scaleMetric=cpu; у model — modelFormat.name=sklearn, protocolVersion=v2, runtime=kserve-sklearnserver, storageUri папки, requests.cpu и limits. Установите metrics-server; одни границы реплик не гарантируют autoscaling.',
    'Дождитесь `READY=True` (`kubectl get inferenceservice`), отправьте запрос V2 `POST /v2/models/<имя>/infer` через port-forward и сравните предсказание с локальным.',
    'Нагрузите сервис коротким скриптом и посмотрите рост реплик; подтверждение: манифесты в `deploy/kserve/`, вывод `kubectl get isvc,pods` и ответ V2.',
  ],
  G8: [
    'Поставьте Argo CD и Argo Rollouts в кластер kind; создайте `deploy/argocd/model-api.yaml` — Application на папку `deploy/model-api/` вашего репозитория с `syncPolicy.automated: {prune: true, selfHeal: true}`.',
    'Сервис модели в `deploy/model-api/` — Rollout вместо Deployment: `strategy.canary.steps` 20% → пауза → 50% → пауза → 100%, сервисы stable и canary. Для точных долей трафика настройте trafficRouting через установленный ingress/mesh; без него setWeight распределяет реплики приблизительно, а не гарантирует процент запросов.',
    'AnalysisTemplate `deploy/model-api/analysis.yaml` с провайдером Prometheus: доля 5xx и p95 латентности canary (метрики с меткой версии или хэша пода), `failureLimit: 1`, интервал 30 с; подключите анализ к шагам canary.',
    'Выкатите хорошую версию изменением тега в git: Argo CD синхронизирует, Rollout проходит все шаги.',
    'Выкатите плохую версию (переменная, включающая 30% ошибок): анализ проваливается, Rollout прерывается и возвращает stable без ручных команд; поправьте git — `git revert`.',
    'Проверьте self-heal: `kubectl scale` или ручная правка Rollout откатывается Argo CD; подтверждение: манифесты, вывод `kubectl argo rollouts get rollout model-api` для обеих версий.',
  ],
  G9: [
    'Репозиторий деплоя (`deploy/` или отдельный) хранит версию модели в манифесте сервиса (тег образа или `storageUri`); прямой `kubectl apply` для production запрещён.',
    'Задача `deploy` DAG из B7 при продвижении создаёт ветку и MR с новой версией модели через API GitLab (токен — в Airflow Connection, не в коде).',
    'CI на MR: eval gate из G2 сравнивает candidate с champion; провал — MR не мержится.',
    'После merge Argo CD синхронизирует, Rollout проводит canary с анализом из G8; в аннотациях Rollout — версия MLflow и коммит.',
    'Откат: `git revert` коммита версии — Argo CD возвращает предыдущую версию; запишите время от revert до stable.',
    'Подтверждение: MR с прошедшим и упавшим eval gate, история Rollout и таблица версия MLflow ↔ коммит ↔ ревизия в `docs/evidence/`.',
  ],
}

const SCOPE = 'Из корня ai-platform-labs на машине с docker compose и kubectl к кластеру kind; имена сервисов, namespace и пути замените своими.'
const c = (command: string, expected: string) => ({ command, expected, scope: SCOPE })

// Самопроверка каждого шага: команда и что должно быть видно в выводе. Порядок совпадает с шагами.
export const checks: Record<string, { command: string; expected: string; scope: string }[]> = {
  B6: [
    c('docker compose -f pipelines/airflow/docker-compose.yaml ps', 'airflow-api-server, airflow-scheduler, airflow-dag-processor и postgres в состоянии healthy или running.'),
    c('docker compose -f pipelines/airflow/docker-compose.yaml exec airflow-scheduler python -c "import mlflow, os; print(mlflow.__version__, os.environ[\'MLFLOW_TRACKING_URI\'])"', 'Печатает версию mlflow и адрес MLflow: зависимости и переменные доступны в Airflow.'),
    c('docker compose -f pipelines/airflow/docker-compose.yaml exec airflow-scheduler airflow dags list-import-errors', 'No data found: DAG train_model разбирается без ошибок импорта.'),
    c('docker compose -f pipelines/airflow/docker-compose.yaml exec airflow-scheduler airflow tasks list train_model', 'Четыре задачи: prepare_data, train, evaluate, log_to_mlflow.'),
    c('docker compose -f pipelines/airflow/docker-compose.yaml exec airflow-scheduler airflow dags list-runs train_model', 'Повторные запуски нужного интервала завершились со статусом success; отсутствие дублей MLflow проверяется отдельно.'),
    c('git log --oneline -3 -- pipelines/airflow', 'Коммит с compose и DAG; скриншоты графа и run в MLflow — в docs/evidence/.'),
  ],
  B7: [
    c('docker compose -f pipelines/airflow/docker-compose.yaml exec airflow-scheduler airflow tasks test train_model compare 2026-10-01', 'В логе задачи метрики candidate и champion на одном наборе.'),
    c('docker compose -f pipelines/airflow/docker-compose.yaml exec airflow-scheduler airflow dags show train_model', 'В графе после compare две ветки: register и skip_deploy.'),
    c('docker compose -f pipelines/airflow/docker-compose.yaml exec airflow-scheduler python -c "from mlflow import MlflowClient; print(MlflowClient().get_model_version_by_alias(\'support-model\', \'champion\').version)"', 'Champion меняется после принятой и успешно выкатанной версии; создание candidate/MR само по себе champion не меняет.'),
    c('docker compose -f pipelines/airflow/docker-compose.yaml exec airflow-scheduler airflow tasks test train_model deploy 2026-10-01', 'Повторный вызов deploy для той же версии ничего не меняет повторно.'),
    c('docker compose -f pipelines/airflow/docker-compose.yaml exec airflow-scheduler airflow dags list-runs train_model', 'Есть запуск с пропуском выкатки и запуск с регистрацией champion.'),
    c('git log --oneline -3 -- pipelines/airflow', 'Коммит с ветвлением; скриншоты двух запусков и истории алиаса сохранены.'),
  ],
  B8: [
    c('docker compose -f pipelines/airflow/docker-compose.yaml exec airflow-scheduler airflow dags details train_model', 'schedule @daily, catchup False, max_active_runs 1.'),
    c('docker compose -f pipelines/airflow/docker-compose.yaml exec airflow-scheduler airflow tasks test train_model wait_for_data 2026-10-01', 'Без партиции сенсор уходит в ожидание (reschedule), по таймауту задача завершается с понятным статусом.'),
    c('docker compose -f pipelines/airflow/docker-compose.yaml logs --tail 50 alert-receiver', 'Пришёл алерт с dag_id, task_id, интервалом и ссылкой на лог упавшей задачи.'),
    c('docker compose -f pipelines/airflow/docker-compose.yaml exec airflow-scheduler airflow dags list-runs train_model', 'Есть три запуска backfill за прошлые дни, все success; они шли по одному.'),
    c('docker compose -f pipelines/airflow/docker-compose.yaml exec airflow-scheduler python /opt/airflow/dags/check_logical_runs.py', 'Один logical run на одинаковые interval/dataset/config/code hash; другие конфигурации не считаются дублем.'),
    c('git log --oneline -3 -- pipelines/airflow docs/runbooks', 'Коммит с расписанием, сенсором и алертами; runbook в docs/runbooks/airflow.md.'),
  ],
  G7: [
    c('kubectl get pods -n kserve; kubectl get crd inferenceservices.serving.kserve.io', 'Контроллер KServe Running, CRD inferenceservices.serving.kserve.io существует.'),
    c('kubectl run s3check --rm -it --restart=Never --image=amazon/aws-cli --env AWS_ACCESS_KEY_ID=<ключ> --env AWS_SECRET_ACCESS_KEY=<секрет> -- --endpoint-url http://minio:9000 s3 ls s3://models/', 'Из кластера виден бакет models с папкой модели.'),
    c('kubectl get serviceaccount kserve-s3 -o yaml', 'У ServiceAccount указан Secret с ключами S3; в Secret — аннотации endpoint и региона.'),
    c('kubectl get inferenceservice -o wide', 'InferenceService модели с READY=True и адресом.'),
    c('kubectl logs <под-predictor> -c storage-initializer', 'Модель скачана из s3://models/... без ошибок доступа.'),
    c('kubectl get hpa,pods -l serving.kserve.io/inferenceservice=<имя>', 'Под нагрузкой число реплик выросло и не превысило maxReplicas.'),
  ],
  G8: [
    c('kubectl get application -n argocd model-api', 'Application в состоянии Synced и Healthy.'),
    c('kubectl argo rollouts get rollout model-api', 'Стратегия canary с шагами 20 → пауза → 50 → пауза → 100.'),
    c('kubectl get analysistemplate -o yaml', 'Метрики доли 5xx и p95 canary с провайдером prometheus и failureLimit 1.'),
    c('kubectl argo rollouts get rollout model-api --watch', 'Хорошая версия проходит все шаги, AnalysisRun Successful.'),
    c('kubectl get analysisrun', 'Для плохой версии AnalysisRun Failed, Rollout в состоянии Degraded/Aborted, трафик вернулся на stable.'),
    c('kubectl scale rollout model-api --replicas 5; sleep 30; kubectl get rollout model-api', 'Argo CD вернул число реплик из git: ручная правка откатилась self-heal.'),
  ],
  G9: [
    c('git log --oneline -5 -- deploy/model-api', 'Версия модели меняется только коммитами из MR.'),
    c('docker compose -f pipelines/airflow/docker-compose.yaml exec airflow-scheduler airflow tasks test train_model deploy 2026-10-01', 'Задача создаёт ветку и MR с новой версией модели; токен берётся из Connection.'),
    c('git log --oneline -3 -- .gitlab-ci.yml', 'В pipeline MR есть eval gate; упавший gate блокирует merge.'),
    c('kubectl argo rollouts get rollout model-api', 'После merge Rollout проводит canary; в аннотациях — версия MLflow и коммит.'),
    c('git revert --no-edit HEAD && git push && kubectl argo rollouts get rollout model-api --watch', 'Argo CD вернул предыдущую версию; время от revert до stable записано.'),
    c('git log --oneline -3 -- docs/evidence', 'Таблица версия MLflow ↔ коммит ↔ ревизия rollout и ссылки на MR сохранены.'),
  ],
}
