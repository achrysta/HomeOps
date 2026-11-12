"""Зал gym-k8s-helm: установка, значения, откат, show values, template (namespace gym-helm, чарт /scenario/charts/web).

Состояние релизов берётся из helm (-o json), отрендеренные манифесты разбираются kubectl --dry-run=client.
Каждый подход зависит от предыдущего (needs): дашборд засчитывает подходы по порядку.
"""

import json
import subprocess
from pathlib import Path

from incident_kit import check, fail
from k8s_kit import KubectlError, deployment_status, get, kubectl

NS = "gym-helm"
ANSWERS = Path("/answers")
IMAGE_OK = "python:3.12-alpine"


def helm(*args: str):
    p = subprocess.run(["helm", *args, "-n", NS, "-o", "json"], capture_output=True, text=True, timeout=30)
    if p.returncode != 0:
        return None
    return json.loads(p.stdout or "null")


def answer(name: str) -> str:
    f = ANSWERS / name
    if not f.exists():
        fail(f"Файла /answers/{name} пока нет.")
    text = f.read_text(encoding="utf-8", errors="replace").strip()
    if not text:
        fail(f"Файл /answers/{name} пустой.")
    return text


def release(name: str = "web") -> dict:
    rel = next((r for r in helm("list", "-a") or [] if r.get("name") == name), None)
    if rel is None:
        fail(f"Релиза {name} в namespace gym-helm пока нет.")
    return rel


def ready(replicas: int) -> None:
    d = get("deployment", "web", NS)
    if d is None:
        fail("Deployment web не найден — его создаёт чарт.")
    want = d["spec"].get("replicas", 1)
    if want != replicas:
        fail(f"У Deployment web {want} реплик, а нужно {replicas}.")
    ok, msg = deployment_status(NS, "web")
    if not ok:
        fail(f"Выкатка web не завершена: {msg}.")


@check("install", "Установить релиз", live=True)
def install():
    rel = release()
    if rel.get("chart") != "web-0.3.1":
        fail(f"Релиз web поставлен из чарта {rel.get('chart')}, а нужен локальный web-0.3.1.")
    if rel.get("status") not in ("deployed",):
        fail(f"Релиз web в состоянии {rel.get('status')}.")
    d = get("deployment", "web", NS)
    if d is None:
        fail("Релиз есть, но Deployment web не создан.")
    available = d.get("status", {}).get("availableReplicas", 0)
    if available < 2:
        fail(f"У web доступно {available} реплик — сервис из релиза ещё не поднялся.")
    return f"релиз web (web-0.3.1), доступно реплик: {available}"


@check("values", "Поменять значения", needs=["install"], live=True)
def values():
    v = helm("get", "values", "web") or {}
    if v.get("replicaCount") != 3:
        fail(f"В значениях релиза web replicaCount = {v.get('replicaCount', 'по умолчанию (2)')}, а нужно 3.")
    # доступность, а не завершённая выкатка: в следующем подходе выкатывают заведомо сломанную версию
    d = get("deployment", "web", NS) or {}
    available = d.get("status", {}).get("availableReplicas", 0)
    if d.get("spec", {}).get("replicas") != 3 or available < 3:
        fail(f"У web доступно {available} из 3 реплик.")
    return "replicaCount=3 в значениях релиза, 3 реплики доступны"


@check("rollback", "Откатить неудачную версию", needs=["values"], live=True)
def rollback():
    hist = helm("history", "web") or []
    broken = [h["revision"] for h in hist if ((helm("get", "values", "web", "--revision", str(h["revision"])) or {}).get("image") or {}).get("tag") == "broken"]
    if not broken:
        fail("В истории релиза нет версии с image.tag=broken — сначала выкатите её.")
    if not hist or not str(hist[-1].get("description", "")).startswith("Rollback to"):
        fail("Последняя ревизия релиза — не откат (helm history web покажет описание ревизий).")
    d = get("deployment", "web", NS)
    image = d["spec"]["template"]["spec"]["containers"][0]["image"] if d else ""
    if image != IMAGE_OK:
        fail(f"После отката web работает на образе {image or 'нет'}, а нужен {IMAGE_OK}.")
    ready(3)
    return f"ревизия {hist[-1]['revision']} — откат, web снова на {IMAGE_OK}, 3 реплики"


@check("show-values", "Значение по умолчанию из чарта", needs=["rollback"], live=True)
def show_values():
    got = answer("default-memory")
    if got != "96Mi":
        fail(f"В /answers/default-memory записано «{got[:40]}» — это не лимит памяти контейнера из значений чарта по умолчанию.")
    return "limits.memory по умолчанию — 96Mi"


@check("template", "Манифесты без установки", needs=["show-values"], live=True)
def template():
    path = ANSWERS / "rendered.yaml"
    if not path.exists():
        fail("Файла /answers/rendered.yaml пока нет.")
    try:
        objs = json.loads(kubectl("apply", "--dry-run=client", "-f", str(path), "-o", "json", timeout=20))
    except (KubectlError, json.JSONDecodeError) as e:
        fail(f"/answers/rendered.yaml не разбирается как манифесты Kubernetes: {str(e)[:160]}")
    items = objs.get("items", [objs]) if isinstance(objs, dict) else []
    dep = next((o for o in items if o.get("kind") == "Deployment"), None)
    if dep is None or dep["metadata"].get("name") != "preview":
        fail("В /answers/rendered.yaml нет Deployment preview — отрендерите чарт с именем релиза preview.")
    if dep["spec"].get("replicas") != 2:
        fail(f"У Deployment preview в rendered.yaml replicas {dep['spec'].get('replicas')}, а нужно 2.")
    if any(r.get("name") == "preview" for r in helm("list", "-a") or []):
        fail("Релиз preview установлен в кластер — нужны только манифесты, без установки.")
    return "rendered.yaml: Deployment preview, 2 реплики, релиз не установлен"
