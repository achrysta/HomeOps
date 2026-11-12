"""Зал gym-k8s-config: ConfigMap и Secret — создать, прочитать, подключить к поду, обновить (namespace gym-config).

Проверки смотрят итоговое состояние: объекты, шаблон пода api и окружение работающего пода.
Каждый подход зависит от предыдущего (needs): дашборд засчитывает подходы по порядку.
"""

import base64
import binascii
from pathlib import Path

from incident_kit import check, fail
from k8s_kit import KubectlError, container, deployment_status, get, kubectl, running_pod

NS = "gym-config"
ANSWERS = Path("/answers")
RESTART = "начните сессию заново, чтобы вернуть исходное состояние"


def answer(name: str) -> str:
    f = ANSWERS / name
    if not f.exists():
        fail(f"Файла /answers/{name} пока нет.")
    text = f.read_text(encoding="utf-8", errors="replace").strip()
    if not text:
        fail(f"Файл /answers/{name} пустой.")
    return text


def config() -> dict:
    cm = get("configmap", "app-config", NS)
    if cm is None:
        fail("ConfigMap app-config в namespace gym-config пока нет.")
    return cm.get("data") or {}


def api() -> dict:
    d = get("deployment", "api", NS)
    if d is None:
        fail(f"Deployment api пропал из namespace gym-config — {RESTART}.")
    return d


def rolled_out() -> None:
    ok, msg = deployment_status(NS, "api")
    if not ok:
        fail(f"Выкатка api не завершена: {msg}.")


def in_pod(*cmd: str) -> str | None:
    """Команда в работающем поде api; None — команда завершилась ошибкой (например, нет переменной)."""
    pod = running_pod(NS, "app=api")
    if pod is None:
        fail("Нет запущенного пода api.")
    try:
        return kubectl("exec", "-n", NS, pod["metadata"]["name"], "--", *cmd, timeout=15).strip()
    except KubectlError:
        return None


@check("configmap", "Создать ConfigMap", live=True)
def configmap():
    data = config()
    if data.get("MODE") != "prod":
        fail(f"В app-config MODE = «{data['MODE']}», а нужно prod." if "MODE" in data else "В app-config нет ключа MODE.")
    # debug — значение после последнего подхода зала
    if data.get("LOG_LEVEL") not in ("info", "debug"):
        fail(f"В app-config LOG_LEVEL = «{data['LOG_LEVEL']}», а нужно info." if "LOG_LEVEL" in data else "В app-config нет ключа LOG_LEVEL.")
    return f"app-config: MODE=prod, LOG_LEVEL={data['LOG_LEVEL']}"


@check("secret-read", "Прочитать Secret", needs=["configmap"], live=True)
def secret_read():
    secret = get("secret", "db-creds", NS)
    raw = ((secret or {}).get("data") or {}).get("password")
    if not raw:
        fail(f"В namespace gym-config нет Secret db-creds с ключом password — {RESTART}.")
    try:
        want = base64.b64decode(raw).decode()
    except (binascii.Error, UnicodeDecodeError):
        fail(f"Ключ password в db-creds повреждён — {RESTART}.")
    got = answer("db-password")
    if got == raw:
        fail("В /answers/db-password записано значение в base64 — нужен сам пароль.")
    if got != want:
        fail("В /answers/db-password записан не тот пароль, что лежит в db-creds.")
    return "пароль из db-creds прочитан"


@check("env", "Переменные из ConfigMap и Secret", needs=["secret-read"], live=True)
def env():
    c = container(api())
    # envFrom целиком или по переменной на ключ (так делает kubectl set env --from=configmap/…)
    whole = any((e.get("configMapRef") or {}).get("name") == "app-config" for e in c.get("envFrom") or [])
    refs = {e["name"]: (e.get("valueFrom") or {}).get("configMapKeyRef") or {} for e in c.get("env") or []}
    by_key = all(refs.get(k, {}).get("name") == "app-config" and refs[k].get("key") == k for k in ("MODE", "LOG_LEVEL"))
    if not (whole or by_key):
        fail("Контейнер api не получает ключи app-config как переменные окружения.")
    ref = next(((e.get("valueFrom") or {}).get("secretKeyRef") for e in c.get("env") or [] if e.get("name") == "DB_PASSWORD"), None)
    if not ref or ref.get("name") != "db-creds" or ref.get("key") != "password":
        fail("Переменная DB_PASSWORD не берётся из ключа password Secret db-creds.")
    rolled_out()
    if in_pod("printenv", "MODE") != "prod":
        fail("В окружении работающего пода api нет MODE=prod.")
    if not in_pod("printenv", "DB_PASSWORD"):
        fail("В окружении работающего пода api нет DB_PASSWORD.")
    return "api получает MODE, LOG_LEVEL и DB_PASSWORD"


@check("volume", "ConfigMap как файлы", needs=["env"], live=True)
def volume():
    d = api()
    vols = {v["name"] for v in d["spec"]["template"]["spec"].get("volumes") or [] if (v.get("configMap") or {}).get("name") == "app-config"}
    if not vols:
        fail("В шаблоне пода api нет тома из ConfigMap app-config.")
    if not any(m["name"] in vols and m.get("mountPath", "").rstrip("/") == "/etc/app" for m in container(d).get("volumeMounts") or []):
        fail("Том с app-config не смонтирован в каталог /etc/app.")
    rolled_out()
    mode = in_pod("cat", "/etc/app/MODE")
    if mode != "prod":
        fail(f"В работающем поде api файл /etc/app/MODE {'не найден' if mode is None else f'содержит «{mode[:40]}»'}.")
    return "ключи app-config — файлы в /etc/app"


@check("reload", "Обновить конфигурацию", needs=["volume"], live=True)
def reload():
    level = config().get("LOG_LEVEL")
    if level != "debug":
        fail(f"В app-config LOG_LEVEL = «{level}», а нужно debug.")
    rolled_out()
    env_level = in_pod("printenv", "LOG_LEVEL")
    if env_level != "debug":
        fail(f"В ConfigMap уже debug, а в окружении работающего пода api — «{env_level or 'нет'}».")
    return "LOG_LEVEL=debug и в ConfigMap, и в окружении пода"
