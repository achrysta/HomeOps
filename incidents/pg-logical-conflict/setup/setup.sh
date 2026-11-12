#!/bin/sh
# Подготовка инцидента: подписка витрины на биллинг, вчерашняя ручная правка аналитика на витрине
# и новые счета биллинга. Каждый шаг идемпотентен: повторный запуск ничего не дублирует.
set -eu
export PGPASSWORD=lab PGCONNECT_TIMEOUT=2
pub() { psql -XAtq -v ON_ERROR_STOP=1 -h publisher -U lab -d billing -c "$1"; }
sub() { psql -XAtq -v ON_ERROR_STOP=1 -h subscriber -U lab -d billing -c "$1"; }

until pub 'SELECT 1' >/dev/null 2>&1 && sub 'SELECT 1' >/dev/null 2>&1; do sleep 1; done
if [ "$(sub "SELECT count(*) FROM pg_subscription WHERE subname = 'sub_billing'")" = 0 ]; then
  sub "CREATE SUBSCRIPTION sub_billing CONNECTION 'host=publisher dbname=billing user=lab password=lab' PUBLICATION pub_billing"
fi
until [ "$(sub "SELECT count(*) FROM pg_subscription_rel WHERE srsubstate <> 'r'")" = 0 ] && [ "$(sub 'SELECT count(*) FROM invoices')" -ge 3 ]; do sleep 1; done

# вчера: аналитик «досчитал» отчёт, добавив счета вручную прямо на витрине
sub "INSERT INTO invoices VALUES (4, 'Ручная правка', 0) ON CONFLICT DO NOTHING"
sub "INSERT INTO invoices VALUES (6, 'Ручная правка', 0) ON CONFLICT DO NOTHING"
# ночью: биллинг выставил новые счета, каждый — своей транзакцией
pub "INSERT INTO invoices VALUES (4, 'ООО Альфа', 5200) ON CONFLICT DO NOTHING"
pub "INSERT INTO invoices VALUES (5, 'ИП Борисов', 830) ON CONFLICT DO NOTHING"
pub "INSERT INTO invoices VALUES (6, 'ООО Гамма', 12900) ON CONFLICT DO NOTHING"

touch /tmp/ready
echo "подготовка завершена"
exec sleep infinity
