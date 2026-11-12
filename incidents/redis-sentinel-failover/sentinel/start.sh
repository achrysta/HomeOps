#!/bin/sh
# Sentinel. Шаблон /conf/sentinel.conf копируется в рабочий файл при первом старте контейнера:
# Sentinel должен иметь возможность переписывать свою конфигурацию.
set -eu
mkdir -p /var/lib/sentinel
[ -f /var/lib/sentinel/sentinel.conf ] || cp /conf/sentinel.conf /var/lib/sentinel/sentinel.conf
exec redis-sentinel /var/lib/sentinel/sentinel.conf
