#!/bin/sh
# Узел Redis. При первом старте контейнера шаблон /conf/<узел>.conf копируется в рабочий файл,
# дальше узел живёт со своим файлом: его переписывают CONFIG REWRITE и Sentinel при переключениях.
# Правка шаблона применяется после пересоздания контейнера узла.
set -eu
node="$1"
mkdir -p /var/lib/redis-node
[ -f /var/lib/redis-node/redis.conf ] || cp "/conf/$node.conf" /var/lib/redis-node/redis.conf
exec redis-server /var/lib/redis-node/redis.conf
