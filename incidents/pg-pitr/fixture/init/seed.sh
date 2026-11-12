#!/bin/bash
set -euo pipefail
printf '\nhost replication lab all scram-sha-256\n' >> "$PGDATA/pg_hba.conf"
psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" <<'SQL'
CREATE TABLE ledger (event text PRIMARY KEY, ticket uuid NOT NULL DEFAULT gen_random_uuid());
INSERT INTO ledger (event) VALUES ('opening');
SQL
