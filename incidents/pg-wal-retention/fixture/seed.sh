#!/bin/bash
set -eu
sql() { psql -X -q -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" "$@"; }
sql <<'SQL'
CREATE TABLE orders (id integer PRIMARY KEY, amount integer NOT NULL);
INSERT INTO orders VALUES (1, 480), (2, 1200), (3, 750);
CREATE SCHEMA fixture;
CREATE TABLE fixture.baseline (protected_lsn pg_lsn, old_wal text);
SELECT * FROM pg_create_physical_replication_slot('legacy_export', true);
INSERT INTO fixture.baseline (old_wal)
SELECT pg_walfile_name(restart_lsn) FROM pg_replication_slots WHERE slot_name = 'legacy_export';
SQL
for step in $(seq 1 12); do
  sql -c "COMMENT ON TABLE orders IS 'batch $step'; SELECT pg_switch_wal();" >/dev/null
done
sql <<'SQL'
SELECT * FROM pg_create_physical_replication_slot('orders_dr', true);
UPDATE fixture.baseline
SET protected_lsn = (SELECT restart_lsn FROM pg_replication_slots WHERE slot_name = 'orders_dr');
CHECKPOINT;
SQL
