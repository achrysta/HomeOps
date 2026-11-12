#!/bin/bash
# Нагрузка от личного кабинета: отчёт по заказам разных клиентов, время каждого запроса — в лог.
while true; do
  for c in 4217 1503 88001 23 61234; do
    start=$(date +%s%N)
    psql -X -q -t -v customer="$c" -f /app/report.sql > /dev/null 2>/tmp/err || { echo "ошибка отчёта для клиента $c: $(cat /tmp/err)"; continue; }
    echo "отчёт по заказам клиента $c: $(( ($(date +%s%N) - start) / 1000000 )) мс"
  done
  sleep 5
done
