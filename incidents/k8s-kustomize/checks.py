"""Автопроверка инцидента k8s-kustomize: выкатка orders-api в orders-prod через overlay Kustomize."""

import json
import pathlib

from incident_kit import check, fail, plural
from k8s_kit import KubectlError, kubectl, proxy_error, require, service_get, wait_deployment

NS = "orders-prod"
SCENARIO = pathlib.Path("/scenario")


def build(overlay: str) -> list[dict]:
    try:
        out = kubectl("kustomize", f"app/overlays/{overlay}")
    except KubectlError as e:
        fail(f"kubectl kustomize app/overlays/{overlay} не собирается: {str(e).strip().splitlines()[-1][:300]}")
    # YAML сборки → JSON силами самого kubectl (без PyYAML в образе): объекты идут подряд
    text = kubectl("create", "--dry-run=client", "-o", "json", "-f", "-", stdin=out)
    dec, i, docs = json.JSONDecoder(), 0, []
    while True:
        while i < len(text) and text[i].isspace():
            i += 1
        if i >= len(text):
            break
        obj, i = dec.raw_decode(text, i)
        docs.extend(obj.get("items", []) if obj.get("kind") == "List" else [obj])
    return docs


def config_name(docs: list[dict]) -> str | None:
    return next((d["metadata"]["name"] for d in docs if d["kind"] == "ConfigMap" and d["metadata"]["name"].startswith("orders-config")), None)


@check("build", "Overlay prod собирается: kubectl kustomize без ошибок", live=True)
def build_prod():
    docs = build("prod")
    dep = next((d for d in docs if d["kind"] == "Deployment"), None)
    if not dep:
        fail("В сборке overlay prod нет Deployment.")
    return f"Сборка: {plural(len(docs), 'объект', 'объекта', 'объектов')}, Deployment {dep['metadata']['name']} с {dep['spec'].get('replicas', 1)} репликами."


@check("base", "Base и overlay dev не изменены", live=True)
def base():
    changed = []
    for orig in sorted((SCENARIO / ".original/app").rglob("*")):
        rel = orig.relative_to(SCENARIO / ".original")
        if not orig.is_file() or rel.parts[:3] == ("app", "overlays", "prod"):
            continue
        cur = SCENARIO / rel
        if not cur.exists() or cur.read_bytes() != orig.read_bytes():
            changed.append(str(rel))
    if changed:
        fail(f"Изменены общие файлы: {', '.join(changed)}. На base живёт и окружение dev — чинить нужно только overlays/prod.")
    return "app/base и app/overlays/dev совпадают с исходными."


@check("applied", "В orders-prod выкачен результат сборки overlay prod", needs=["build"], live=True)
def applied():
    docs = build("prod")
    want = config_name(docs)
    built = next(d for d in docs if d["kind"] == "Deployment")
    built_env = {e["name"] for c in built["spec"]["template"]["spec"].get("containers", []) for e in c.get("env", [])}
    dep = require("deployment", "orders-api", NS)
    spec = dep["spec"]["template"]["spec"]
    refs = [e["configMapRef"]["name"] for c in spec.get("containers", []) for e in c.get("envFrom", []) if "configMapRef" in e]
    if want not in refs:
        fail(f"Deployment в orders-prod берёт конфигурацию из {', '.join(refs) or 'ничего'}, а сборка overlay prod — из {want}. Выкатите overlay: kubectl apply -k app/overlays/prod.")
    extra = sorted({e["name"] for c in spec.get("containers", []) for e in c.get("env", [])} - built_env)
    if extra:
        fail(f"В Deployment есть переменные, которых нет в overlay: {', '.join(extra)}. Конфигурация кластера расходится с репозиторием: результат должен соответствовать сборке overlay prod.")
    return f"Deployment использует {want} из сборки overlay."


@check("replicas", "orders-api в orders-prod — 3 готовые реплики", needs=["applied"], live=True)
def replicas():
    dep = require("deployment", "orders-api", NS)
    want = dep["spec"].get("replicas", 1)
    if want != 3:
        fail(f"У Deployment {want} {'реплика' if want == 1 else 'реплики'}, для прода нужно 3.")
    ok, msg = wait_deployment(NS, "orders-api", timeout=90)
    if not ok:
        fail(msg)
    return msg


@check("config", "Сервис работает с логами info в окружении prod", needs=["replicas"], live=True)
def config():
    r = service_get(NS, "orders-api", 80, "/config")
    if r.status != 200:
        fail(f"orders-api не отвечает через Service: {proxy_error(r)}")
    data = r.json()
    if data.get("log_level") != "info" or data.get("env") != "prod":
        fail(f"Сервис работает с LOG_LEVEL={data.get('log_level')}, APP_ENV={data.get('env')} — для прода нужны info и prod.")
    cm = next(d for d in build("prod") if d["kind"] == "ConfigMap" and d["metadata"]["name"].startswith("orders-config"))
    if cm.get("data", {}).get("LOG_LEVEL") != "info":
        fail(f"В ConfigMap из overlay prod LOG_LEVEL={cm.get('data', {}).get('LOG_LEVEL')} — настройка должна приходить из overlay.")
    return "LOG_LEVEL=info, APP_ENV=prod — из ConfigMap overlay."
