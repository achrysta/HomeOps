#!/bin/bash
set -euo pipefail
work=/backup/current
# Повторный up того же проекта не создаёт новый инцидент поверх уже подготовленного.
if [ -s "$work/expected" ]; then exit 0; fi
sql() { psql -XAtq -v ON_ERROR_STOP=1 -h source -U lab -d shop -c "$1"; }
gosu postgres pg_basebackup -h source -U lab -D "$work/base" -X stream -c fast
opening=$(sql "SELECT ticket FROM ledger WHERE event='opening'")
sql "INSERT INTO ledger(event) VALUES ('approved');"
approved=$(sql "SELECT ticket FROM ledger WHERE event='approved'")
before=$(sql "SELECT pg_create_restore_point('before_bad_delete')")
target_time=$(sql "SELECT clock_timestamp()")
sql "DELETE FROM ledger;"
after=$(sql "SELECT pg_current_wal_insert_lsn()")
sql "INSERT INTO ledger(event) VALUES ('after_delete');"
post_delete=$(sql "SELECT ticket FROM ledger WHERE event='after_delete'")
sysid=$(sql 'SELECT system_identifier FROM pg_control_system()')
last_wal=$(sql 'SELECT pg_walfile_name(pg_current_wal_insert_lsn())')
sql 'SELECT pg_switch_wal()' >/dev/null
for attempt in $(seq 1 100); do
  [ -s "$work/archive/$last_wal" ] && break
  sleep 0.2
done
test -s "$work/archive/$last_wal"
printf 'Журнал дежурного: контрольная точка before_bad_delete, %s, LSN %s.\n' "$target_time" "$before" > "$work/handover"
printf '%s|%s|%s|%s|%s|%s\n' "$sysid" "$before" "$after" "$opening" "$approved" "$post_delete" > "$work/expected.tmp"
mv "$work/expected.tmp" "$work/expected"
