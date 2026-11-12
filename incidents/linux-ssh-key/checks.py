"""Проверки инцидента linux-ssh-key. Выполняются внутри учебного сервера."""

import os
import stat
import subprocess
from pathlib import Path

from incident_kit import check, fail

KEY = "/opt/ci/deploy_key"
HOME = Path("/home/deploy")
SSH = ["ssh", "-i", KEY, "-o", "BatchMode=yes", "-o", "ConnectTimeout=3", "-o", "StrictHostKeyChecking=no", "-o", "UserKnownHostsFile=/dev/null", "-o", "LogLevel=ERROR", "deploy@127.0.0.1"]


def ssh(command: str) -> subprocess.CompletedProcess:
    return subprocess.run([*SSH, command], capture_output=True, text=True, timeout=15)


def sshd_settings() -> dict[str, list[str]]:
    """Итоговые настройки sshd (sshd -T): у повторяющихся директив, как allowusers, — все значения."""
    out = subprocess.run(["sshd", "-T"], capture_output=True, text=True, timeout=10).stdout
    settings: dict[str, list[str]] = {}
    for key, _, value in (line.partition(" ") for line in out.splitlines()):
        settings.setdefault(key, []).extend(value.split())
    return settings


@check("login", "CI входит по ssh как deploy со своим ключом", live=True)
def login():
    r = ssh("whoami")
    if r.returncode != 0 or r.stdout.strip() != "deploy":
        fail(f"ssh -i {KEY} deploy@127.0.0.1 не пускает: {(r.stderr or r.stdout).strip().rstrip('.')[:200] or f'код {r.returncode}'}.")
    return "deploy входит по ключу CI"


@check("deploy", "Деплой записывает релиз в ~/releases", needs=["login"], live=True)
def deploy():
    r = ssh("echo release-ok > ~/releases/last && cat ~/releases/last")
    if r.returncode != 0 or r.stdout.strip() != "release-ok":
        fail(f"Деплой по ssh не смог записать ~/releases/last: {(r.stderr or r.stdout).strip()[:200]}.")
    return "~/releases/last записан по ssh"


@check("perms", "Права на домашний каталог и ~/.ssh не шире необходимого", needs=["deploy"], live=True)
def perms():
    for path in (HOME, HOME / ".ssh", HOME / ".ssh" / "authorized_keys"):
        st = os.stat(path)
        if st.st_mode & (stat.S_IWGRP | stat.S_IWOTH):
            fail(f"{path} доступен на запись группе или всем (права {stat.filemode(st.st_mode)}).")
    return "домашний каталог, ~/.ssh и authorized_keys закрыты на запись для чужих"


@check("hardening", "Харденинг sshd на месте", needs=["perms"], live=True)
def hardening():
    s = {k: v[0] if len(v) == 1 else " ".join(v) for k, v in sshd_settings().items() if k != "allowusers"}
    if s.get("passwordauthentication") != "no" or s.get("kbdinteractiveauthentication") != "no":
        fail("В sshd включён вход по паролю — по требованию безопасности только ключи.")
    if s.get("permitrootlogin") not in ("no", "prohibit-password", "without-password"):
        fail(f"PermitRootLogin {s.get('permitrootlogin')}: root по ssh не пускаем.")
    if s.get("strictmodes") != "yes":
        fail("StrictModes выключен: sshd перестал проверять права на домашний каталог и ~/.ssh — это ослабляет защиту, а не чинит её.")
    allowed = set(sshd_settings().get("allowusers", []))
    if allowed != {"admin", "deploy"}:
        fail(f"AllowUsers: {', '.join(sorted(allowed)) or 'не задан'}. Ограничение остаётся: по ssh входят только admin и deploy.")
    return "пароли выключены, root не пускают, StrictModes включён, AllowUsers admin deploy"
