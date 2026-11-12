#!/bin/bash
# Подготовка инцидента linux-systemd-unit (один раз при первом старте сервера).
set -euo pipefail
INC=/usr/local/lib/homeops/incident
useradd --system --no-create-home --shell /usr/sbin/nologin reportsvc
install -d -m 0700 -o root -g root /opt/reports
install -m 0600 -o root -g root "$INC/app.py" /opt/reports/app.py
install -m 0644 "$INC/reports.service" /etc/systemd/system/reports.service
systemctl daemon-reload
# «Новый сервис выкатили вручную, он сразу упал — разбираться не стали»
systemctl start reports.service || true
