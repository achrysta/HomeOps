#!/bin/sh
# Redis каталога и заказов. При создании контейнера шаблон /conf/redis.conf копируется в рабочий файл,
# очередь заданий на доставку засевается один раз за жизнь контейнера: стёртые задания сами не вернутся.
set -eu
mkdir -p /var/lib/redis-node
[ -f /var/lib/redis-node/redis.conf ] || cp /conf/redis.conf /var/lib/redis-node/redis.conf
redis-server /var/lib/redis-node/redis.conf &
pid=$!
# остановка контейнера: Redis сохраняет RDB и завершается сам
trap 'kill -TERM "$pid"; wait "$pid"; exit 0' TERM INT
until redis-cli ping >/dev/null 2>&1; do sleep 0.2; done
if [ ! -f /var/lib/redis-node/.seeded ]; then
  pad=$(printf '%0900d' 0)
  i=1
  while [ "$i" -le 300 ]; do
    printf 'HSET job:%d order_id %d status pending address %s\nRPUSH jobs:pending %d\n' "$i" $((70000 + i)) "$pad" "$i"
    i=$((i + 1))
  done | redis-cli >/dev/null
  redis-cli SET jobs:seq 300 >/dev/null
  touch /var/lib/redis-node/.seeded
fi
wait "$pid"
