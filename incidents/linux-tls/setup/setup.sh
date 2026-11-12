#!/bin/bash
# Подготовка инцидента linux-tls (один раз при первом старте сервера).
set -euo pipefail
INC=/usr/local/lib/homeops/incident
bash "$INC/pki.sh" /tmp/pki
# старый сертификат витрины — там, откуда его читает nginx; новые — там, куда их ночью положило продление
install -d /etc/nginx/tls /etc/ssl/renewed /etc/ssl/shop-ca /etc/partner-sync /var/www/shop
install -m 644 /tmp/pki/old/shop.crt /etc/nginx/tls/shop.crt
install -m 600 /tmp/pki/old/shop.key /etc/nginx/tls/shop.key
cp -r /tmp/pki/shop.example.test /tmp/pki/api.shop.example.test /etc/ssl/renewed/
install -m 644 /tmp/pki/ca/root.pem /etc/ssl/shop-ca/root.pem
install -m 644 /tmp/pki/ca/root.pem /etc/partner-sync/ca.pem
# корневой CA компании — в системном хранилище: curl и openssl на сервере ему доверяют
install -m 644 /tmp/pki/ca/root.pem /usr/local/share/ca-certificates/shop-example-root.crt
update-ca-certificates >/dev/null 2>&1
UNTIL=$(cat /tmp/pki/renewed-until)
rm -rf /tmp/pki
printf '<!doctype html><html><body data-site="shop"><h1>Магазин</h1></body></html>\n' > /var/www/shop/index.html
# имена сайтов — на этот же сервер; /etc/hosts — файл Docker, делаем его обычным
cp /etc/hosts /tmp/hosts.orig && umount /etc/hosts && cat /tmp/hosts.orig > /etc/hosts && rm -f /tmp/hosts.orig
printf '127.0.0.1\tshop.example.test www.shop.example.test api.shop.example.test\n' >> /etc/hosts
rm -f /etc/nginx/sites-enabled/default
install -m 644 "$INC/shop.conf" /etc/nginx/sites-available/shop.conf
install -m 644 "$INC/api.conf" /etc/nginx/sites-available/api.conf
ln -sf /etc/nginx/sites-available/shop.conf /etc/nginx/sites-enabled/shop.conf
ln -sf /etc/nginx/sites-available/api.conf /etc/nginx/sites-enabled/api.conf
systemctl enable nginx >/dev/null 2>&1
systemctl restart nginx
install -d /opt/partner-sync
install -m 644 "$INC/sync.py" /opt/partner-sync/sync.py
install -m 644 "$INC/partner-sync.service" /etc/systemd/system/partner-sync.service
# отметка до поломки: клиент партнёра и его доверенный CA не меняют
install -d -m 700 /var/lib/homeops/linux-tls
sha256sum /opt/partner-sync/sync.py /etc/partner-sync/ca.pem /etc/systemd/system/partner-sync.service > /var/lib/homeops/linux-tls/client.sha256
systemctl daemon-reload
systemctl enable --now partner-sync >/dev/null 2>&1
# журнал ночного продления: сертификаты обновились, а развёртывание не настроено
YESTERDAY=$(date -u -d '-6 hours' '+%Y-%m-%d %H:%M')
cat > /var/log/cert-renew.log <<LOG
$YESTERDAY renew: shop.example.test — продлён до $UNTIL: /etc/ssl/renewed/shop.example.test/{cert,chain,fullchain,privkey}.pem
$YESTERDAY renew: api.shop.example.test — продлён до $UNTIL: /etc/ssl/renewed/api.shop.example.test/{cert,chain,fullchain,privkey}.pem
$YESTERDAY deploy: хук развёртывания не настроен — nginx не перезагружался
LOG
