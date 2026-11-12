#!/bin/bash
# Подготовка инцидента linux-oom (один раз при первом старте сервера).
set -euo pipefail
INC=/usr/local/lib/homeops/incident
install -d /opt/search-index /etc/search-index
install -m 0644 "$INC/search.py" /opt/search-index/search.py
install -m 0644 "$INC/search-index.service" /etc/systemd/system/search-index.service
# «Каталог вырос — увеличили кэш, чтобы поиск был быстрее»
cat > /etc/search-index/config <<'CONF'
# Размер кэша индекса в памяти, МБ
CACHE_MB=192
CONF
systemctl daemon-reload
systemctl enable --now search-index.service
