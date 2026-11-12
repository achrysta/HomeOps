#!/bin/bash
set -euo pipefail
# Этот каталог принадлежит только текущему учебному Compose-проекту.
rm -rf /backup/current
install -d -o postgres -g postgres /backup/current /backup/current/archive /backup/current/base
exec docker-entrypoint.sh postgres -c archive_mode=on \
  -c "archive_command=test -f /backup/current/archive/%f || (cp %p /backup/current/archive/%f.tmp && mv /backup/current/archive/%f.tmp /backup/current/archive/%f)"
