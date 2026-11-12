#!/bin/bash
# Подготовка инцидента linux-disk-full (выполняется один раз при первом старте сервера).
set -euo pipefail
INC=/usr/local/lib/homeops/incident
mkdir -p /opt/payments /var/lib/homeops
cp "$INC/logger.py" "$INC/api.py" /opt/payments/
cp "$INC/payment-logger.service" "$INC/payments-api.service" /etc/systemd/system/
systemctl daemon-reload

# Секретная строка в журнале аудита; для проверки храним только её хеш
CODE="RC-$(head -c 6 /dev/urandom | od -An -tx1 | tr -d ' \n' | tr 'a-f' 'A-F')"
printf '%s' "$CODE" | sha256sum | cut -d' ' -f1 > /var/lib/homeops/recovery.sha256
printf '%s' "$CODE" > /run/homeops-recovery-code
systemctl enable --now payment-logger.service payments-api.service
for _ in $(seq 1 120); do [ -f /var/lib/homeops/logger.ready ] && break; sleep 0.5; done
systemctl show -p MainPID --value payment-logger > /var/lib/homeops/logger.pid
rm -f /run/homeops-recovery-code

# «Администратор удалил большой журнал, чтобы освободить место»
rm -f /var/log/payments/audit.log
