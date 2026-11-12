#!/bin/bash
# Подготовка инцидента linux-nginx-port (один раз при первом старте сервера).
set -euo pipefail
INC=/usr/local/lib/homeops/incident
# Старая превью-версия сайта на встроенном веб-сервере Python, оставленная с прошлого релиза
install -d /srv/legacy
echo '<h1>Магазин — превью прошлого релиза</h1>' > /srv/legacy/index.html
install -m 0644 "$INC/legacy-preview.service" /etc/systemd/system/legacy-preview.service
# Новый сайт: каталог выложили архивом от root с правами 0700
install -d -m 0700 -o root -g root /srv/site
install -m 0644 "$INC/index.html" /srv/site/index.html
rm -f /etc/nginx/sites-enabled/default
install -m 0644 "$INC/shop.conf" /etc/nginx/sites-available/shop
ln -sf /etc/nginx/sites-available/shop /etc/nginx/sites-enabled/shop
systemctl daemon-reload
systemctl enable --now legacy-preview.service
systemctl enable nginx
systemctl start nginx || true
