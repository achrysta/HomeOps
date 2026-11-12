#!/bin/bash
set -euo pipefail
test -s /backup/current/expected
# Каждая попытка начинает восстановление с базовой копии, в собственной tmpfs.
work=$(mktemp -d /var/lib/postgresql/pitr.XXXXXX)
chown postgres:postgres "$work"
gosu postgres cp -a /backup/current/base/. "$work/"
chmod 0700 "$work"
gosu postgres touch "$work/recovery.signal"
cat >> "$work/postgresql.auto.conf" <<'CONFIG'
restore_command = 'cp /backup/current/archive/%f %p'
recovery_target_timeline = 'current'
include = '/config/recovery.conf'
CONFIG
exec gosu postgres postgres -D "$work" -c listen_addresses='*' -c archive_mode=off
