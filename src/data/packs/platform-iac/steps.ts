import type { LabStepCheck } from '../../labSteps'

export const steps: Record<string, string[]> = {
  'K1.1': [
    'В `ai-platform-labs/platform/ansible/` создайте Compose-проект: сервис `controller` с закреплёнными ansible-core и ansible-lint (коллекция community.docker — в `requirements.yml`) и два узла `node-1`, `node-2` из `ubuntu:24.04` с python3 и командой `sleep infinity`. Inventory `inventory/lab.yml` подключается к узлам через `ansible_connection: community.docker.docker`, без SSH; контроллер получает сокет Docker только в этом учебном проекте.',
    'Роль `roles/baseline/`: в `defaults/main.yml` — переменные с префиксом `baseline_` (пользователь, ключ, каталоги, порт приложения). Задачи — только специализированные модули: `user` и `authorized_key` для пользователя deploy, `copy` drop-in `/etc/sudoers.d/deploy` с `validate: visudo -cf %s`, `file` для `/opt/app/config` и `/opt/app/data` с владельцем deploy и правами 0750.',
    'Конфигурация `/opt/app/config/app.conf` собирается из `templates/app.conf.j2` модулем `template` с `notify: restart app`. В учебных контейнерах нет systemd, поэтому handler дописывает отметку перезапуска в `/opt/app/data/restarts.log`. В шаблоне нет времени, случайного порядка и других значений, которые меняются от прогона к прогону.',
    'Выполните `docker compose run --rm controller ansible-playbook site.yml` дважды. Первый прогон настраивает узлы, второй обязан дать `changed=0` на обоих. Если какая-то задача всегда сообщает об изменении, исправьте её модулем или условием, а не прячьте через `changed_when: false`.',
    'Сделайте ручную правку: `docker compose exec node-2 sh -c "echo port=9999 >> /opt/app/config/app.conf"`. Прогон `ansible-playbook site.yml --check --diff --limit node-2` показывает строку, которую роль вернёт, и не меняет узел. Обычный прогон исправляет файл и вызывает handler ровно один раз.',
    '`docker compose run --rm controller ansible-lint` проходит без нарушений. Подтверждение: коммит роли, вывод двух прогонов (второй с changed=0), diff ручной правки и `restarts.log`, где отметки перезапуска совпадают с изменениями конфигурации.',
  ],
  K2: [
    'Создайте свой кластер `kind create cluster --name platform` — отдельно от учебного кластера стендов. В `ai-platform-labs/platform/tofu/` — Compose с сервисами `tofu` (образ `ghcr.io/opentofu/opentofu` с закреплённой версией, сеть `kind`, kubeconfig из `kind get kubeconfig --internal --name platform` только на чтение) и `state-db` (postgres:18). Backend `pg`, строка подключения — из переменной окружения `PG_CONN_STR`; выполните `docker compose run --rm tofu init`.',
    'Модуль `modules/team/`: входы `name`, `quota` (cpu, memory, pods) и `group`. Внутри — `kubernetes_namespace_v1` с меткой `platform/team`, `kubernetes_resource_quota_v1`, `kubernetes_limit_range_v1` с requests и limits по умолчанию, `kubernetes_role_v1` и `kubernetes_role_binding_v1` для группы команды, `kubernetes_network_policy_v1`: входящий трафик только из своего namespace. Версии провайдера закрепите в `required_providers`.',
    'В корне — `teams.yaml` с двумя командами и `module "team" { for_each = yamldecode(file("teams.yaml")) }`. Выполните `tofu plan -out=plan.bin`, просмотрите план и примените именно его: `tofu apply plan.bin`. Проверьте блокировку: пока `tofu apply` без сохранённого плана ждёт подтверждения, второй `tofu plan` сразу получает Error acquiring the state lock, а с `-lock-timeout=60s` ждёт освобождения.',
    'Импорт: создайте namespace руками `kubectl create namespace legacy-reports`, добавьте команду в `teams.yaml` и блок `import { to = module.team["legacy-reports"].kubernetes_namespace_v1.this, id = "legacy-reports" }`. План импортирует namespace и создаёт только недостающие ресурсы команды, ничего не удаляя.',
    'Переименование: поменяйте ключ команды `payments` на `payments-core`, оставив имя namespace во входе `name`, и добавьте `moved { from = module.team["payments"], to = module.team["payments-core"] }`. План показывает перемещение адресов без создания и удаления ресурсов; после apply блок moved можно оставить до следующего релиза модуля.',
    'Дрейф: увеличьте квоту руками `kubectl edit resourcequota -n payments`. `tofu plan -detailed-exitcode` возвращает 2 и показывает разницу, `tofu apply` возвращает квоту, повторный plan даёт код 0. Подтверждение: коммит модуля, планы импорта и moved без пересоздания, коды выхода 2 и 0.',
  ],
  K3: [
    'В кластер `platform` поставьте Argo CD Helm-чартом с закреплённой версией: `helm install argocd argo/argo-cd -n argocd --create-namespace --version <версия> --wait`. Репозиторий платформы раздаёт локальный git-сервер в контейнере в сети `kind` (например, Gitea); Argo CD получает его адрес и учётку только на чтение.',
    'Для каждой команды из `teams.yaml` — AppProject (сгенерируйте их OpenTofu через `kubernetes_manifest` или отдельным платформенным приложением, но не двумя способами сразу): `sourceRepos` — репозиторий платформы, `destinations` — только namespace команды, `clusterResourceWhitelist: []`, в `namespaceResourceBlacklist` — ResourceQuota и LimitRange.',
    'ApplicationSet `argocd/teams-apps.yaml`: генератор git directories по `teams/*/apps/*`, шаблон — имя `{{path[1]}}-{{path.basename}}`, project и namespace назначения `{{path[1]}}`, `syncPolicy.automated` с `prune: true` и `selfHeal: true`. В папке приложения — kustomization с ConfigMap (`argocd.argoproj.io/sync-wave: "-1"`) и Deployment (волна 0).',
    'Добавьте приложение команды папкой и коммитом — Application появляется сам и синхронизируется. Без webhook Argo CD и ApplicationSet опрашивают git раз в 3 минуты; не ждать помогают аннотации `argocd.argoproj.io/refresh=normal` на приложении и `argocd.argoproj.io/application-set-refresh=true` на ApplicationSet. Удалите папку — Application и его ресурсы удаляются. Положите в папку команды манифест с namespace другой команды или ResourceQuota — проект отклоняет синхронизацию. Упавшая автосинхронизация повторяет ту же ревизию с растущей паузой, и исправляющий коммит применится только после повторов: прервите операцию кнопкой Terminate или `argocd app terminate-op <приложение>`.',
    'Self-heal и prune: `kubectl scale deployment <имя> -n <команда> --replicas=5` за несколько секунд возвращается к числу реплик из git, а ConfigMap, убранный из kustomization, исчезает из кластера. Self-heal срабатывает после успешной синхронизации текущей ревизии: если последняя операция упала или прервана, сначала доведите приложение до Synced. Порядок волн видно по `metadata.creationTimestamp`: ConfigMap создан раньше Deployment.',
    'Подтверждение: коммит AppProject и ApplicationSet, вывод `kubectl get applications -n argocd`, текст отказа проекта для чужого namespace и квоты, события self-heal.',
  ],
  K4: [
    'Репозиторий платформы: `tofu/` (модуль и `teams.yaml`), `teams/<команда>/apps/`, `argocd/`. Пайплайн merge request — GitLab CI из трека G или локальный раннер: `tofu fmt -check -recursive`, `tofu validate`, `tofu plan -out=plan.bin`; план сохраняется артефактом, краткий итог — в комментарии к MR.',
    'Задача apply — только для main, вручную, применяет сохранённый план из того же пайплайна. Для plan и apply — разные учётные данные: plan только читает кластер, apply меняет окружения команд. Секреты — маскированные переменные CI и `sensitive = true` в коде, в логах плана их нет.',
    'Подключите третью команду одним MR: строка в `teams.yaml` и папка `teams/<команда>/apps/hello/`. В MR виден план; после merge и apply появляются namespace, квота, RBAC и AppProject, Argo CD разворачивает hello без ручных команд.',
    'Отключите команду отдельным MR: удалите строку и папку. После merge ApplicationSet удаляет приложения, apply — окружение; в кластере не остаётся namespace, ролей и проекта команды.',
    'Откатите отключение через `git revert` и пайплайн: команда возвращается целиком. Проверьте, что повторное создание не упирается в остатки прошлого окружения.',
    'Подтверждение: ссылки на MR подключения и отключения, план из артефакта, лог apply только из main, список ресурсов команды до и после, время от merge до готового приложения.',
  ],
}

const observations: Record<string, [string, string][]> = {
  'K1.1': [
    ['docker compose run --rm controller ansible all -m ping', 'node-1 и node-2 отвечают pong через подключение community.docker.docker.'],
    ['docker compose run --rm controller ansible-playbook site.yml --syntax-check', 'Синтаксис верен; в роли нет задач command и shell без условий.'],
    ['docker compose exec node-1 cat /opt/app/config/app.conf', 'Файл собран из шаблона, без меток времени; владелец и права заданы ролью.'],
    ['docker compose run --rm controller ansible-playbook site.yml', 'Повторный прогон: в PLAY RECAP changed=0 для node-1 и node-2.'],
    ['docker compose run --rm controller ansible-playbook site.yml --check --diff --limit node-2', 'diff показывает удаляемую строку port=9999; узел в режиме check не меняется.'],
    ['docker compose run --rm controller ansible-lint', 'ansible-lint завершается без нарушений.'],
  ],
  K2: [
    ['docker compose run --rm tofu init', 'Инициализированы backend pg и провайдер kubernetes; версии закреплены в .terraform.lock.hcl.'],
    ['docker compose run --rm tofu validate', 'Success! The configuration is valid.'],
    ['kubectl get resourcequota,limitrange,networkpolicy,rolebinding -n payments', 'У команды есть квота, LimitRange, NetworkPolicy и RoleBinding группы команды.'],
    ['docker compose run --rm tofu plan', 'Для legacy-reports: 1 to import, 5 to add, 1 to change (метка команды на импортированном namespace), 0 to destroy.'],
    ['docker compose run --rm tofu plan', 'Адреса ресурсов перемещены (has moved to); 0 to add, 0 to destroy.'],
    ['docker compose run --rm tofu plan -detailed-exitcode', 'После ручной правки — код 2 и изменение квоты; после apply — код 0.'],
  ],
  K3: [
    ['kubectl get pods -n argocd', 'argocd-server, repo-server, application-controller и applicationset-controller в состоянии Running.'],
    ['kubectl get appprojects -n argocd -o yaml', 'У каждой команды в destinations только её namespace; ResourceQuota и LimitRange в namespaceResourceBlacklist.'],
    ['kubectl get applications -n argocd', 'По Application на каждую папку teams/*/apps/*, Synced и Healthy, каждое в проекте своей команды.'],
    ['kubectl get application -n argocd <приложение> -o jsonpath="{.status.operationState.message}"', 'Отказ проекта: namespace <чужой> is not permitted in project <команда> или resource :ResourceQuota is not permitted in project <команда>.'],
    ['kubectl get deployment -n <команда> <имя> -o jsonpath="{.spec.replicas}"', 'Через несколько секунд после ручного scale число реплик снова как в git.'],
    ['kubectl get events -n argocd --field-selector involvedObject.kind=Application', 'События синхронизации приложений команд, в том числе после self-heal.'],
  ],
  K4: [
    ['docker compose run --rm tofu fmt -check -recursive', 'Код отформатирован: команда завершается без вывода с кодом 0.'],
    ['git show HEAD:.gitlab-ci.yml', 'Задача apply объявлена только для main, запускается вручную и использует сохранённый план.'],
    ['kubectl get ns,resourcequota,rolebinding -n <новая команда>; kubectl get applications -n argocd', 'Окружение новой команды готово, её приложение Synced и Healthy без ручных kubectl apply.'],
    ['kubectl get namespace <команда>; kubectl get appproject -n argocd <команда>', 'После отключения команды: NotFound для namespace и проекта.'],
    ['kubectl get applications -n argocd', 'После revert и пайплайна приложение команды снова Synced и Healthy.'],
    ['docker compose run --rm tofu plan -detailed-exitcode', 'Код 0: код, state и кластер совпадают.'],
  ],
}

export const checks: Record<string, LabStepCheck[]> = Object.fromEntries(
  Object.entries(observations).map(([id, rows]) => [id, rows.map(([command, expected]) => ({
    command, expected,
    scope: `В своём репозитории ai-platform-labs, задача ${id}: OpenTofu и Ansible — в Compose-контейнерах, kubectl и git — в терминале хоста с контекстом кластера kind platform. Имена команд, приложений и версий замените своими.`,
  }))]),
)
