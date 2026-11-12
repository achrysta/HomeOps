#!/bin/sh
# Физическая реплика: при каждом старте контейнера данные копируются с primary заново (pg_basebackup -R).
set -eu
export PGPASSWORD=replicator
until pg_isready -h primary -U replicator -q; do sleep 1; done
mkdir -p "$PGDATA"
chown postgres:postgres "$PGDATA"
chmod 700 "$PGDATA"
gosu postgres pg_basebackup -h primary -U replicator -D "$PGDATA" -R -X stream
echo "include_if_exists = '/conf/standby2.conf'" >> "$PGDATA/postgresql.conf"
exec gosu postgres postgres -D "$PGDATA"
