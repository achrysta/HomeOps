#!/bin/bash
# Бэкап базы заказов. Запускается по cron (/etc/cron.d/db-backup).
set -euo pipefail
mkdir -p /var/backups/db
backup-tool --db orders > "/var/backups/db/orders-$(date +%F-%H%M).sql"
