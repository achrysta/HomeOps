#!/bin/bash
# Подготовка инцидента linux-dns (один раз при первом старте сервера).
set -euo pipefail
INC=/usr/local/lib/homeops/incident
install -d /opt/checkout
install -m 0644 "$INC/checkout.py" /opt/checkout/checkout.py
install -m 0644 "$INC/checkout.service" /etc/systemd/system/checkout.service
# /etc/hosts в контейнере — файл Docker, смонтированный поверх: sed -i и редакторы, пересоздающие файл, на нём падают.
# Делаем его обычным файлом, как на настоящем сервере
cp /etc/hosts /tmp/hosts.orig
umount /etc/hosts
cat /tmp/hosts.orig > /etc/hosts
rm -f /tmp/hosts.orig
# «На время переезда биллинга прибили адрес» — переезд закончился, адрес сменился, запись осталась
printf '10.99.0.10\tbilling.internal\t# временно, на время переезда биллинга\n' >> /etc/hosts
# «Убрали DNS из порядка поиска, чтобы не ждать таймаутов»
sed -i 's/^hosts:.*/hosts:          files/' /etc/nsswitch.conf
systemctl daemon-reload
systemctl enable --now checkout.service
