#!/bin/bash
# Подготовка инцидента linux-ssh-key (один раз при первом старте сервера).
set -euo pipefail
useradd -m -s /bin/bash admin
useradd -m -s /bin/bash deploy
install -d -m 0700 -o deploy -g deploy /home/deploy/.ssh /home/deploy/releases

# Старый ключ CI — в authorized_keys; новый (перевыпущен на прошлой неделе) лежит у «раннера» в /opt/ci
ssh-keygen -q -t ed25519 -N "" -C "ci-deploy-2025" -f /tmp/old_key
install -m 0600 -o deploy -g deploy /tmp/old_key.pub /home/deploy/.ssh/authorized_keys
rm -f /tmp/old_key /tmp/old_key.pub
install -d -m 0755 /opt/ci
ssh-keygen -q -t ed25519 -N "" -C "ci-deploy-2026" -f /opt/ci/deploy_key
chmod 0600 /opt/ci/deploy_key

# «Харденинг» sshd: без паролей, без root — и только admin
cat > /etc/ssh/sshd_config.d/10-hardening.conf <<'CONF'
# Харденинг по требованию безопасности
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin no
AllowUsers admin
CONF

# «CI не мог писать артефакты в домашний каталог — дали права»
chmod 0777 /home/deploy

systemctl enable --now ssh.service
