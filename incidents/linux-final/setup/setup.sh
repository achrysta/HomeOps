#!/bin/bash
# Подготовка инцидента linux-final (один раз при первом старте сервера).
set -euo pipefail
INC=/usr/local/lib/homeops/incident
useradd --system --no-create-home --shell /usr/sbin/nologin api
chown api:api /var/log/api
install -d /opt/api /opt/debug
install -m 0644 "$INC/api.py" /opt/api/app.py
install -m 0644 "$INC/debug-dump.py" /opt/debug/dump.py
install -m 0644 "$INC/api.service" /etc/systemd/system/api.service
# /etc/hosts — файл Docker, смонтированный поверх: делаем его обычным файлом, как на настоящем сервере
cp /etc/hosts /tmp/hosts.orig
umount /etc/hosts
cat /tmp/hosts.orig > /etc/hosts
rm -f /tmp/hosts.orig
printf '10.255.0.9\tapi-backend\t# app-01\n' >> /etc/hosts
rm -f /etc/nginx/sites-enabled/default
install -m 0644 "$INC/app.conf" /etc/nginx/sites-available/app.conf
ln -sf /etc/nginx/sites-available/app.conf /etc/nginx/sites-enabled/app.conf
systemctl enable nginx
systemctl restart nginx
# отладочный дамп «на пять минут» — запущен руками через systemd-run и забыт
systemd-run --unit=debug-dump --description="отладочный дамп" /usr/bin/python3 /opt/debug/dump.py
for _ in $(seq 1 60); do [ -f /run/debug-dump.ready ] && break; sleep 0.5; done
rm -f /run/debug-dump.ready
systemctl daemon-reload
systemctl start api.service || true
