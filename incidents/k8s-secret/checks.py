"""Автопроверка инцидента k8s-secret: payments-api входит в ledger-db с паролем из Secret."""

import base64
import binascii

from incident_kit import check, fail
from k8s_kit import get, proxy_error, require, service_get

NS = "payments"
DB_PASSWORD = "Ledger-2026-q4"


def b64(value: str) -> str | None:
    try:
        return base64.b64decode(value, validate=True).decode()
    except (binascii.Error, UnicodeDecodeError):
        return None


def secret_value(name: str, key: str) -> str | None:
    s = get("secret", name, NS)
    if s is None:
        fail(f"Secret {name} не найден в namespace {NS}.")
    raw = (s.get("data") or {}).get(key)
    return b64(raw) if raw is not None else None


@check("db-password", "Пароль базы не изменён", live=True)
def db_password():
    if secret_value("ledger-db-auth", "password") != DB_PASSWORD:
        fail("Пароль в Secret ledger-db-auth изменён. Им пользуются и другие сервисы — чинить нужно Secret платежей.")
    return "Пароль базы прежний."


@check("secret", "Secret payments-db содержит пароль базы, закодированный один раз", live=True)
def secret():
    value = secret_value("payments-db", "password")
    if value is None:
        fail("В Secret payments-db нет ключа password или значение не в base64.")
    if value != DB_PASSWORD:
        fail("Значение, которое приложение получит из Secret payments-db, не совпадает с паролем базы. Посмотрите, что лежит в Secret после декодирования.")
    return "Secret payments-db декодируется в пароль базы."


@check("from-secret", "Пароль приходит в payments-api из Secret, а не открытым текстом", live=True)
def from_secret():
    dep = require("deployment", "payments-api", NS)
    for c in dep["spec"]["template"]["spec"].get("containers", []):
        for e in c.get("env", []):
            if e.get("name") == "DB_PASSWORD" and "value" in e:
                fail("DB_PASSWORD задан в Deployment открытым текстом — его видно любому, кто читает манифест. Берите его из Secret (secretKeyRef).")
            if e.get("name") == "DB_PASSWORD" and "configMapKeyRef" in e.get("valueFrom", {}):
                fail("DB_PASSWORD берётся из ConfigMap — пароль должен храниться в Secret.")
        if any("configMapRef" in ef and DB_PASSWORD in str(get("configmap", ef["configMapRef"]["name"], NS) or "") for ef in c.get("envFrom", [])):
            fail("Пароль приходит из ConfigMap через envFrom — он должен храниться в Secret.")
    return "DB_PASSWORD берётся из Secret."


@check("api", "payments-api входит в базу и отвечает", needs=["secret", "from-secret"], live=True)
def api():
    r = service_get(NS, "payments-api", 80, "/health")
    if r.status == 200:
        return "payments-api: база доступна."
    detail = r.json().get("error") if r.text.startswith("{") else proxy_error(r)
    fail(f"payments-api не может войти в ledger-db: {detail}. Если Secret уже верный, проверьте, какое значение видит сам под: kubectl exec deploy/payments-api -- env.")


@check("no-plaintext", "Пароля нет открытым текстом ни в одном ConfigMap", live=True)
def no_plaintext():
    leaked = [cm["metadata"]["name"] for cm in get("configmaps", ns=NS) or [] if any(DB_PASSWORD in str(v) for v in (cm.get("data") or {}).values())]
    if leaked:
        fail(f"Пароль базы лежит открытым текстом в ConfigMap: {', '.join(leaked)}. ConfigMap доступны читателям namespace и попадают в git — открытых паролей в них быть не должно.")
    return "Открытого пароля в ConfigMap нет."
