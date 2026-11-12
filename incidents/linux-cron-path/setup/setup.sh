#!/bin/bash
# Подготовка инцидента linux-cron-path (один раз при первом старте сервера).
set -euo pipefail
INC=/usr/local/lib/homeops/incident
install -d /opt/backup/bin /var/backups/db
install -m 0755 "$INC/backup-tool" /opt/backup/bin/backup-tool
# скрипт залили без права на исполнение
install -m 0644 "$INC/backup.sh" /opt/backup/bin/backup.sh
# в учебном стенде «ночной» бэкап запускается раз в минуту; в строке нет поля пользователя
install -m 0644 "$INC/db-backup.cron" /etc/cron.d/db-backup
# «Добавил инструменты бэкапа в PATH, чтобы было удобно» — и затёр PATH целиком
printf '\n# backup tools\nexport PATH=/opt/backup/bin\n' >> /root/.bashrc
