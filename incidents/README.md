# Инциденты

Сломанные стенды в Docker Compose. По симптомам нужно найти причину и починить, как на дежурстве. Решение засчитывает автопроверка по итоговому состоянию стенда: подходит любой корректный способ.

### MLOps и AI Platform

| Инцидент | Трек | Уровень | Что внутри |
| --- | --- | --- | --- |
| `sse-streaming` | C | Старт | nginx перед LLM ломает стриминг и рвёт длинные запросы |
| `gateway-fallback` | C | Практика | LLM Gateway не переключается на резервную модель |
| `vllm-metrics` | D | Практика | Prometheus, recording rule для TTFT p95 и алерт на очередь vLLM |
| `rag-retrieval` | E | Практика | Qdrant: индекс и запросы на разных моделях эмбеддингов |
| `eval-gate` | G | Старт | CI pipeline выкатывает регрессию через «зелёный» eval gate |
| `train-serve-skew` | B | Практика | Признаки в сервинге собираются не так, как при обучении |
| `llm-context` | C | Вызов | llama.cpp + Qwen2.5: контекст, слоты и память под KV cache |
| `agent-loop` | I | Практика | Цикл агента: лимит шагов, причина остановки, идемпотентность `create_ticket` |
| `airflow-retrain` | B | Практика | Airflow 3 и MLflow: данные по интервалу запуска, таймаут, идемпотентная регистрация |
| `kserve-isvc` | G | Вызов | KServe в кластере kind: `nodeSelector` пула, `storage-initializer`, OOM сервера модели (стенд уровня кластера) |

### Платформенная и DevOps-база (подтверждает навыки, прогресс обучения не меняет)

| Инцидент | Тема | Уровень | Что внутри |
| --- | --- | --- | --- |
| `linux-disk-full` | Linux, сервер | Практика | `df` 100%, `du` — ноль: удалённый открытый файл, данные из `/proc/<pid>/fd` |
| `linux-systemd-unit` | Linux, сервер | Старт | `217/USER`, права на код, `Restart=`, `enable` |
| `linux-cron-path` | Linux, сервер | Старт | затёртый `PATH` в `.bashrc`, формат `cron.d`, окружение cron |
| `linux-nginx-port` | Linux, сервер | Практика | порт занят сервисом с `Restart=always`, 403 из-за прав, ловушка `chmod 777` |
| `linux-open-files` | Linux, сервер | Практика | «Too many open files»: `LimitNOFILE=128` в забытом drop-in, лимит «подняли» в `limits.conf`, который systemd не читает; нагрузка — `hub-load` |
| `linux-oom` | Linux, сервер | Практика | OOM killer по `MemoryMax=128M` после роста кэша; лимит не поднимать — уменьшить `CACHE_MB` |
| `linux-dns` | Linux, сервер | Практика | «dig работает, а приложение нет»: устаревшая запись в `/etc/hosts` и `hosts: files` без `dns` в `nsswitch.conf`; биллинг — второй контейнер с именем в Docker DNS |
| `linux-ssh-key` | Linux, сервер | Практика | вход по ключу: `AllowUsers` в drop-in усиления защиты, `chmod 777` на домашний каталог (StrictModes), новый ключ CI не добавлен; обходы — пароли, `StrictModes no` |
| `linux-journald` | Linux, сервер | Практика | `/var/log` (tmpfs 96 МБ) забит журналом systemd: отладка `price-sync` и drop-in без лимитов (`SystemMaxUse=1G`, `KeepFree=0`); обходы — `Storage=volatile`, остановка сервиса |
| `linux-nginx-vhost` | Linux, сервер | Практика | «вместо магазина открывается блог»: выбор server-блока nginx по `server_name`, `default_server`, 444 для чужих имён |
| `linux-inodes` | Linux, сервер | Практика | `df` свободен, а inode кончились: генератор миниатюр сыплет файлы, чистка по таймеру удаляет не то; оригиналы фото не трогать |
| `linux-tls` | Linux, сервер | Практика | HTTPS после ночного продления: истёкший сертификат витрины, у API сертификат без своего имени в SAN; ловушки — старый ключ и `cert.pem` без промежуточного CA; клиент партнёра проверяет по CA компании |
| `linux-final` | Linux, сервер | Вызов | финал блока: `217/USER`, раздел журнала забит удалённым открытым файлом, устаревшая запись в `/etc/hosts` у upstream nginx, сервис не в автозапуске |
| `docker-oom-healthcheck` | Docker | Практика | OOMKilled 137 без swap, healthcheck без `curl`, `depends_on healthy` |
| `docker-network-dns` | Docker | Практика | localhost в контейнере, сети compose, `bind` и `protected-mode` Redis |
| `pg-slow-query` | PostgreSQL | Практика | INVALID-индекс после упавшего `CREATE UNIQUE INDEX CONCURRENTLY`, Seq Scan по 3 млн строк; текст запроса менять нельзя |
| `pg-wal-retention` | PostgreSQL | Практика | устаревший слот удерживает WAL; аварийный слот и его исходную позицию нужно сохранить |
| `pg-pitr` | PostgreSQL | Практика | восстановление двух записей на отдельной копии из физического бэкапа и WAL до контрольной точки |
| `pg-sync-replica` | PostgreSQL | Практика | `synchronous_standby_names` указывает на выведенную реплику: коммиты кассы ждут `SyncRep`; живая реплика подключена как `walreceiver`; обходы — отключить синхронность, `synchronous_commit = local`, пробить чек повторно |
| `pg-logical-conflict` | PostgreSQL | Практика | логическая подписка встала на `insert_exists`: ручные строки аналитика на витрине; ловушки — `SKIP` и пересоздание подписки без `copy_data` теряют счета, править биллинг нельзя |
| `redis-sentinel-failover` | Redis | Практика | учения `SENTINEL FAILOVER`: реплики с `replica-priority 0` (NOGOODSLAVE), приложение привязано к адресу узла (READONLY); аналитическую реплику повышать нельзя |
| `redis-eviction` | Redis | Практика | `maxmemory` 32 МБ и `noeviction`: прогрев записал кэш без TTL, отказ всех записей; ловушки — `allkeys-lru` вытесняет задания, `FLUSHALL`, поднять лимит |
| `ci-lockfile` | CI/CD | Практика | `uv sync --locked` падает: `pyproject` обновили без `uv.lock`; за ним ruff и тесты (`LegacyVersion` убран в packaging 22); без сети — пакеты в образе раннера |
| `git-bisect` | CI/CD, сервер | Практика | ~50 коммитов со случайным порядком: «форматирующий» коммит сменил режим округления; WIP-коммиты без сборки ловят наивный `bisect run` (нужен код 125); история не переписывается |
| `k8s-crashloop` | Kubernetes | Старт | CrashLoopBackOff: команда контейнера, `logs --previous`, ConfigMap в env, OOMKilled |
| `k8s-service-endpoints` | Kubernetes | Практика | DNS между namespace, init-контейнер, селектор Service, `targetPort` |
| `k8s-pending` | Kubernetes | Практика | Pending (requests, PVC без StorageClass) и FailedCreate из-за ResourceQuota |
| `k8s-probes` | Kubernetes | Практика | model-server: перепутанные liveness и readiness, выкатка без ошибок |
| `k8s-rollout` | Kubernetes | Старт | ImagePullBackOff, `rollout undo`, стратегия `maxUnavailable` / `maxSurge` |
| `k8s-hpa-pdb` | Kubernetes | Вызов | metrics-server через Helm (TLS kubelet в kind), HPA без requests, PDB блокирует drain |
| `k8s-netpol` | Kubernetes | Вызов | default deny: DNS в egress, метка namespace, `podSelector` без `namespaceSelector`, порт пода вместо порта Service |
| `k8s-rbac` | Kubernetes | Вызов | 403 от ServiceAccount default, `apiGroup` в Role, Pod Security restricted и `securityContext`, минимальные права |
| `k8s-storage` | Kubernetes | Практика | StatefulSet: RWX у local-path, неизменяемые `volumeClaimTemplates`, `mountPath` мимо `DATA_DIR`, `reclaimPolicy Retain` |
| `k8s-nodeport` | Kubernetes | Практика | NodePort: `targetPort` по несуществующему имени порта, `externalTrafficPolicy: Local` — отвечает только узел с подом |
| `k8s-kustomize` | Kubernetes | Практика | overlay prod: опечатка в имени патча и в ключе литерала `configMapGenerator`; base и dev не трогаются, ручной `set env` не засчитывается |
| `k8s-secret` | Kubernetes | Практика | двойной base64 в data Secret, переменные из Secret не обновляются без перезапуска, пароль открытым текстом в ConfigMap |
| `k8s-statefulset` | Kubernetes | Практика | StatefulSet без headless Service: у подов нет имён `kv-0.kv`, реплики не находят лидера, `kv-2` не создаётся; `clusterIP` неизменяем; тома с данными не терять |
| `k8s-gateway` | Kubernetes | Практика | Traefik: Ingress с чужим `ingressClassName` и `pathType Exact`, Gateway API — `allowedRoutes Same` у общего Gateway и порт контейнера в `backendRefs` |
| `k8s-operator` | Kubernetes | Практика | CRD и оператор: манифест на снятой версии API v1beta1 (поля переименованы), namespace команды не в настройках оператора, `cronjobs` в ClusterRole в группе `apps` вместо `batch` |
| `k8s-storm` | Kubernetes | Вызов | финал блока: лимит больше квоты, `configMapKeyRef` на чужой ключ, liveness не туда, селектор Service и NetworkPolicy не по меткам — по цепочке |
| `k8s-node-notready` | Kubernetes, уровень кластера | Вызов | kubelet остановлен и выключен, неверный флаг в /etc/default/kubelet, опечатка в `clientCAFile`; терминал в узле |
| `k8s-control-plane` | Kubernetes, уровень кластера | Вызов | static pods: controller-manager с неверным kubeconfig, манифест scheduler вне `staticPodPath`; `crictl` |
| `k8s-gpu-scheduling` | Kubernetes, уровень кластера | Практика | GPU-узел: taint без toleration, nodeSelector не по той метке, нет класса приоритета — GPU занят обучением; GPU освобождает вытеснение, Job с `podFailurePolicy`; GPU эмулирован расширенным ресурсом |
| `k8s-cni` | Kubernetes, уровень кластера | Практика | поды в ContainerCreating на Ready-узле: старый конфиг flannel первым в `/etc/cni/net.d` и каталог плагинов CNI в `config.toml` containerd; `crictl info` |
| `k8s-coredns` | Kubernetes, уровень кластера | Практика | опечатка в зоне `Corefile` CoreDNS, `dnsPolicy: Default` у приложения; обход через `hostAliases` не засчитывается |
| `k8s-certs` | Kubernetes, уровень кластера | Практика | просрочен `apiserver-kubelet-client`: `logs` и `exec` — 401; `kubeadm certs renew` и перезапуск API-сервера |
| `k8s-etcd-restore` | Kubernetes, уровень кластера | Вызов | восстановление удалённого namespace из снапшота etcd: `etcdutl restore`, hostPath в манифесте etcd; объекты сверяются по UID |
| `k8s-kubeadm-upgrade` | Kubernetes, уровень кластера | Вызов | обновление v1.37.0 → v1.37.1: `kubeadm upgrade apply`, kubelet, `drain`, `upgrade node`, `uncordon`; бинарники и образы новой версии загружаются в узлы офлайн |

Kubernetes-инциденты размечены доменами экзамена CKA (программа v1.35, [cncf/curriculum](https://github.com/cncf/curriculum)).

## Как проходить

Основной способ — дашборд: раздел «Стенды», вкладка «Инциденты». На странице инцидента есть кнопки «Запустить», «Проверить», «Сбросить» и «Остановить», состояние сервисов, логи и терминал внутри сети стенда. Конфиги правьте в своём редакторе: папка `incidents/<id>` смонтирована в контейнеры, после правки перезапустите сервис (nginx: `nginx -s reload`, Prometheus: `POST /-/reload`, остальные — кнопкой «Пересоздать»).

Подсказки открываются по одной. Разбор открывается после решения; если открыть его раньше, решение будет отмечено «с разбором».

## Без дашборда — командами

Те же действия из терминала (одинаково в zsh, bash и PowerShell, на хосте нужен только Docker):

```bash
cd incidents/sse-streaming
```

```bash
docker compose up -d --build
```

```bash
docker compose run --rm shell
```

```bash
docker compose run --rm verify
```

```bash
docker compose run --rm reset
```

```bash
docker compose down
```

- `shell` — терминал внутри сети стенда: сервисы доступны по именам, есть `curl`, `jq`, `dig`, `python`, файлы стенда — в `/scenario`.
- `verify` — автопроверка. Пишет отчёт в `.reports/last.json` и отправляет его в дашборд на `http://host.docker.internal:8080`. Если дашборд на другом компьютере, загрузите файл кнопкой «Отчёт из файла» или задайте `DASHBOARD_URL`. `DASHBOARD_URL=off` выключает отправку (для прогонов при разработке стендов).
- `reset` — возвращает файлы стенда из `.original/` в исходное (сломанное) состояние. После него пересоздайте стенд: `docker compose up -d --build --force-recreate`.

## Учебный сервер (Linux-инциденты)

Стенды с пометкой «сервер» — это Ubuntu 24.04 с systemd внутри контейнера, как маленькая VM. Терминал в дашборде открывается прямо на сервере под `root`; внутри работают `systemctl`, `journalctl`, `cron`, `ss`, `lsof`, `vim` и `nano`. Проверить решение — команда `verify` на сервере или кнопка «Проверить». «Сбросить» пересоздаёт сервер со свежей поломкой. Командами:

```bash
docker compose up -d --build
```

```bash
docker compose exec server bash -l
```

```bash
docker compose up -d --force-recreate
```

Для systemd контейнеру нужны `SYS_ADMIN` и собственный cgroup namespace (`cgroup: private`): общий `homeops-init` перемонтирует cgroup2 контейнера на запись. Не добавляйте bind mount `/sys/fs/cgroup` хоста — в WSL он не совпадает с namespace контейнера и systemd падает при создании `init.scope`. Полный `--privileged` не используется. Образ сервера собирается один раз и общий для всех Linux-инцидентов.

## Kubernetes-кластер (k8s-инциденты)

Все Kubernetes-стенды живут в одном кластере [kind](https://kind.sigs.k8s.io/) «homeops»: control-plane + worker, внутри узлов — kubeadm, static pods в `/etc/kubernetes/manifests` и kubelet под systemd, как на экзамене CKA. У каждого стенда свои namespace (`K8S_NAMESPACES` в `compose.yaml`).

- **Запуск** первого стенда создаёт кластер (на Mac с Apple Silicon — меньше минуты, первый раз ещё скачивается образ узла ~400 МБ), остановка последнего — удаляет его. Пустой кластер занимает около 850 МБ памяти (control-plane ~670 МБ, worker ~185 МБ). Образы приложений стендов (`_shared/k8s/images.txt`) скачиваются в Docker один раз и загружаются в узлы — пересоздание кластера сеть не требует.
- **Рабочее место** — контейнер `kubectl` стенда в сети `kind`: `kubectl` с автодополнением и алиасом `k`, `helm`, `etcdctl`, `vim` и `nano`; namespace стенда выбран. Терминал дашборда открывается в нём, манифесты — в `/scenario/manifests` (это папка стенда, правки из редактора видны сразу).
- **Поломку** готовит `.setup/setup.sh` при старте рабочего места: namespace пересоздаются, применяются `manifests/`. Перезапуск контейнера работу не сбрасывает, пересоздание (кнопка «Сбросить») — сбрасывает.
- **Проверки** ходят в кластер через `kubectl` и прокси API-сервера (`_tools/k8s_kit.py`): запросы к Service выглядят как запросы клиента внутри кластера.

Командами:

```bash
docker compose -f ../_shared/k8s/compose.yaml run --rm cluster up
```

```bash
docker compose up -d --wait
```

```bash
docker compose exec kubectl bash -l
```

```bash
docker compose -f ../_shared/k8s/compose.yaml run --rm cluster down
```

Узлам kind нужен привилегированный режим (kind создаёт их сам через сокет Docker в служебном сервисе `cluster`); API кластера публикуется только на 127.0.0.1.

## Mac и Windows

Все образы есть под arm64 и amd64. Стенды проверены на Mac (Apple Silicon). Контейнеры на Mac не видят GPU, поэтому модели в `llm-context` считаются на CPU.

На Windows держите проект внутри WSL (например, `~/HomeOps`) и запускайте `docker compose` оттуда: так быстрее работают bind mount и корректно определяются пути для сервиса стендов.

## Модель в `llm-context`

Пресеты лежат в `llm-context/models/*.env`, выбор — в карточке инцидента:

| Пресет | Размер | Ответы | Проверка на CPU Mac |
| --- | --- | --- | --- |
| `qwen2.5-0.5b` | ≈ 0.4 ГБ | бессвязные | ≈ 30 с |
| `qwen2.5-3b` (по умолчанию) | ≈ 2 ГБ | по-русски, по делу | ≈ 1–1,5 мин |
| `qwen2.5-7b` | ≈ 4.7 ГБ | хорошие | ≈ 3 мин, 6 ГБ памяти в Docker |

Командой: `docker compose --env-file models/qwen2.5-7b.env up -d`. Модель скачивается с Hugging Face при первом запуске и остаётся в volume `llm-models`.

## Как устроен стенд

```
incidents/<id>/
├── compose.yaml   # стенд + служебные сервисы verify, reset, shell (profile tools)
├── checks.py      # автопроверка: @check("id", "что проверяем")
├── .original/     # исходные версии файлов, которые можно править (для reset)
└── …              # конфиги и код сервисов стенда
incidents/_tools/  # образ инструментов, verify.py, reset.py, incident_kit.py
incidents/_shared/ # общие сервисы (учебная LLM с OpenAI-совместимым API)
```

## Как добавить инцидент

Для проверки изменений есть [автопрогон разработчика](../scripts/README.md): фиксированный каталог стендов с исходным, частично и полностью исправленным состоянием. Он использует отдельный кластер, копии стендов и отключённую отправку отчётов, не трогая ваш прогресс.

1. Папка `incidents/<id>/` со стендом в сломанном состоянии. Образы — мультиархитектурные, без GPU. Монтируйте папки, а не отдельные файлы: правка файла редактором, который пересоздаёт файл, не видна в контейнере, если смонтирован сам файл.
2. Сервисы `verify`, `reset`, `shell` — скопируйте блок `x-tools` из любого стенда и укажите `INCIDENT_ID`.
3. `checks.py`: проверяйте результат (ответы сервисов, метрики, код возврата пайплайна), а не способ. Сообщение об ошибке описывает наблюдаемый симптом и цель, но не решение. Убедитесь, что сломанное состояние ловится, а правильное исправление проходит.
4. В `.original/` положите копии файлов, которые пользователь будет править.
5. Kubernetes-инцидент вместо пункта 2: скопируйте `compose.yaml` любого `k8s-*` (рабочее место `kubectl` с меткой `homeops.role: k8s`, `verify` и `reset`), задайте `K8S_NAMESPACES` — свои, не занятые другими стендами (это проверяет тест). Исходное состояние — `.setup/setup.sh`, правимые манифесты — `manifests/` и их копия в `.original/`. Новые образы приложений добавьте в `_shared/k8s/images.txt`.
6. Серверный инцидент вместо пунктов 2 и 4: сервис `server` с образом `homeops-linux-server:1` и меткой `homeops.role: server` (скопируйте Compose любого `linux-*`), поломка — в `setup/setup.sh`.
7. Описание в `src/data/incidents.ts`: сценарий, цель, подсказки по возрастанию конкретности, проверки (те же id, что в `checks.py`), разбор, связь с навыками и задачами. Тест `incidents.test.ts` сверит описание с папкой.

## Живые проверки и залы

Проверки с `live=True` в `checks.py` — лёгкие: пока стенд запущен, дашборд опрашивает их каждые несколько секунд (`verify --live` в рабочем месте `kubectl` или на учебном сервере) и показывает строку «сейчас» под проверкой. Отчёт при этом не пишется и не отправляется — решение засчитывает только полная автопроверка. В живом режиме ожидания (`wait_deployment`, `wait_for`) делают одну попытку; проверки с нагрузкой, окнами стабильности или изменением стенда живыми не помечаются.

Папки `gym-*` — стенды залов: рабочее место `kubectl` в общем кластере и живые проверки подходов (`@check("<id подхода>", ..., live=True)`). Подход засчитывает дашборд, когда проходит проверка текущего подхода; новая сессия начинается со сброса стенда. Описания залов — в `src/data/gyms.ts`.

## Стенды уровня кластера

Стенды уровня кластера (`k8s-node-notready`, `k8s-control-plane`, `k8s-coredns`, `k8s-certs`, `k8s-etcd-restore`, `k8s-kubeadm-upgrade`) ломают узлы, control plane или DNS всего кластера, поэтому работают по одному на свежем кластере (метка `homeops.cluster: exclusive`): сервис стендов пересоздаёт кластер, загружает в узлы образы из `.setup/images.txt` стенда (если он есть), выполняет `.setup/node-<узел>.sh` внутри узлов (`homeops-cluster prepare <id>`) и только потом готовит namespace. Терминал открывается и в рабочем месте с `kubectl`, и прямо в узле kind. Сброс пересоздаёт кластер, остановка удаляет его. Вручную: `cluster down`, `cluster up`, `cluster prepare <id>`, затем `docker compose up -d --wait` в папке стенда.


## Память compose-залов

На Mac с Apple Silicon (arm64) измерены Airflow 3.3.2 standalone и `shell` — 1152,22 МиБ (около 1,2 ГБ, планировать запас 2 ГБ), LLM API с gateway, двумя CPU-провайдерами и `shell` — 38,22 МиБ. Это занятая память работающих контейнеров из `labs memory`, без завершённого `prepare`, после полного прохода; это не пик и не размер образа. Полный живой опрос через API: Airflow — 0,293 с, LLM API — 2,778 с (синтетический стриминг и `Retry-After: 1`); это не замер настоящего inference. Залы запускаются без внешней сети, сброс очищает только их учебные метаданные, ответы и результаты.
