#!/bin/bash
# Подготовка инцидента linux-nginx-vhost (один раз при первом старте сервера).
set -euo pipefail
INC=/usr/local/lib/homeops/incident
install -d /srv/shop /srv/blog
install -m 0644 "$INC/shop.html" /srv/shop/index.html
install -m 0644 "$INC/blog.html" /srv/blog/index.html
rm -f /etc/nginx/sites-enabled/default
install -m 0644 "$INC/shop.conf" /etc/nginx/sites-available/shop.conf
install -m 0644 "$INC/blog.conf" /etc/nginx/sites-available/blog.conf
ln -sf /etc/nginx/sites-available/shop.conf /etc/nginx/sites-enabled/shop.conf
ln -sf /etc/nginx/sites-available/blog.conf /etc/nginx/sites-enabled/blog.conf
# имена сайтов указывают на этот сервер (дописываем: /etc/hosts — bind mount Docker, sed -i его не заменит)
echo '127.0.0.1 shop.example.test www.shop.example.test blog.example.test' >> /etc/hosts
systemctl enable nginx
systemctl restart nginx
