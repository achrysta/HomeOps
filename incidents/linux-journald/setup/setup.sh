#!/bin/bash
# Подготовка инцидента linux-journald (один раз при первом старте сервера).
set -euo pipefail
INC=/usr/local/lib/homeops/incident
install -d /opt/shop
install -m 0644 "$INC/price_sync.py" "$INC/orders_api.py" /opt/shop/
# Логи приложения API ротируются logrotate — их размер под контролем
cat > /etc/logrotate.d/orders <<'CONF'
/var/log/orders/*.log {
    daily
    rotate 3
    maxsize 5M
    missingok
    compress
}
CONF
# «Храним логи дольше — для расследований»: без ограничения размера, запаса и частоты
install -d /etc/systemd/journald.conf.d /var/log/journal
cat > /etc/systemd/journald.conf.d/90-retention.conf <<'CONF'
[Journal]
# Храним логи дольше — для расследований
Storage=persistent
SystemMaxUse=1G
SystemKeepFree=0
RateLimitBurst=0
CONF
# Отладку включили на время разбора с поставщиком и забыли выключить
echo "LOG_LEVEL=debug" > /etc/default/price-sync
cat > /etc/systemd/system/price-sync.service <<'UNIT'
[Unit]
Description=Синхронизация цен с поставщиком
[Service]
EnvironmentFile=/etc/default/price-sync
ExecStart=/usr/bin/python3 -u /opt/shop/price_sync.py
Restart=always
[Install]
WantedBy=multi-user.target
UNIT
cat > /etc/systemd/system/orders-api.service <<'UNIT'
[Unit]
Description=API заказов
[Service]
ExecStart=/usr/bin/python3 -u /opt/shop/orders_api.py
Restart=always
[Install]
WantedBy=multi-user.target
UNIT
systemctl restart systemd-journald
# журнал переезжает из /run на диск (/var/log/journal) — как при обычной загрузке systemd-journal-flush
journalctl --flush
# Отладка шла всю ночь: журнал уже почти занял раздел
head -c 56M /dev/urandom | base64 -w 1200 | sed 's/^/DEBUG price-sync: payload=/' | systemd-cat -t price-sync -p debug
systemctl daemon-reload
systemctl enable --now orders-api.service price-sync.service
