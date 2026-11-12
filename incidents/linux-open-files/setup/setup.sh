#!/bin/bash
# Подготовка инцидента linux-open-files (один раз при первом старте сервера).
set -euo pipefail
INC=/usr/local/lib/homeops/incident
install -d /opt/notify-hub
install -m 0644 "$INC/hub.py" /opt/notify-hub/hub.py
install -m 0644 "$INC/notify-hub.service" /etc/systemd/system/notify-hub.service
# Год назад «ограничили на всякий случай» — в drop-in, который никто не помнит
install -d /etc/systemd/system/notify-hub.service.d
cat > /etc/systemd/system/notify-hub.service.d/limits.conf <<'CONF'
[Service]
LimitNOFILE=128
CONF
# Вчера коллега «поднял лимит» — там, где его поднимают для пользователей
cat >> /etc/security/limits.conf <<'CONF'
# notify-hub: подняли лимит открытых файлов после инцидента
*    soft    nofile    65536
*    hard    nofile    65536
CONF
install -m 0755 "$INC/hub-load" /usr/local/bin/hub-load
systemctl daemon-reload
systemctl enable --now notify-hub.service
