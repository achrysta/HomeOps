#!/bin/sh
# Касса: три оплаты, начатые перед инцидентом. Проводятся один раз за жизнь контейнера:
# повторный запуск не должен пробивать чеки ещё раз.
set -u
if [ -f /var/tmp/paid ]; then exec sleep infinity; fi
until pg_isready -h primary -U cashier -d shop -q; do sleep 1; done
until psql -XAtq -h primary -U cashier -d shop -c "SELECT 1" >/dev/null 2>&1; do sleep 1; done
touch /var/tmp/paid
for r in 2001:2300 2002:990 2003:15400; do
  receipt=${r%%:*}
  amount=${r##*:}
  psql -X -h primary -U cashier -d shop -c "INSERT INTO payments (receipt, amount) VALUES ('R-$receipt', $amount)" &
done
wait
echo "касса: все оплаты завершены"
exec sleep infinity
