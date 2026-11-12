#!/bin/bash
# Подготовка инцидента git-bisect (один раз при первом старте сервера): репозиторий с историей за три недели.
set -euo pipefail
INC=/usr/local/lib/homeops/incident
# коммиты дежурного (git revert, исправление) — от его имени
git config --system user.name "Дежурный инженер"
git config --system user.email "oncall@shop.example.test"
git config --system init.defaultBranch main
install -d /srv /answers /var/lib/homeops/git-bisect
python3 "$INC/gen_repo.py" /srv/pricing
# исходная вершина main — по ней проверка видит, что история не переписана
git -C /srv/pricing rev-parse refs/heads/main > /var/lib/homeops/git-bisect/orig-head
printf '%s\n' 'cd /srv/pricing 2>/dev/null' 'echo "Репозиторий: /srv/pricing. Ответ — в /answers/culprit. Проверить решение: verify"' >> /root/.bashrc
