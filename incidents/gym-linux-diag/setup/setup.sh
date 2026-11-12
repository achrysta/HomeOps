#!/bin/bash
# Зал gym-linux-diag: сервисы и файлы для подходов (один раз при первом старте сервера).
set -euo pipefail
mkdir -p /answers /opt/gym/www /opt/report-sync /var/lib/app

# Порт 8081 слушает агент метрик, рядом — ещё один сервис на 8080, чтобы ответ не угадывался
for unit in metrics-agent:8081 web-preview:8080; do
  name=${unit%%:*} port=${unit##*:}
  cat > "/etc/systemd/system/$name.service" <<UNIT
[Unit]
Description=$name
[Service]
ExecStart=/usr/bin/python3 -m http.server $port --bind 127.0.0.1 --directory /opt/gym/www
Restart=always
[Install]
WantedBy=multi-user.target
UNIT
done

# Сервис, который падает при старте: не находит токен
cat > /opt/report-sync/sync.sh <<'SH'
#!/bin/sh
echo "report-sync: начинаю синхронизацию отчётов"
if [ ! -r /etc/report-sync/token ]; then
  echo "report-sync: ERROR: не удалось прочитать /etc/report-sync/token: No such file or directory" >&2
  exit 3
fi
SH
chmod 0755 /opt/report-sync/sync.sh
cat > /etc/systemd/system/report-sync.service <<'UNIT'
[Unit]
Description=Синхронизация отчётов
[Service]
ExecStart=/opt/report-sync/sync.sh
[Install]
WantedBy=multi-user.target
UNIT

# Данные приложения: самый большой каталог не угадывается по имени
for d in cache:6 exports:40 models:18 tmp:3; do
  mkdir -p "/var/lib/app/${d%%:*}"
  dd if=/dev/zero of="/var/lib/app/${d%%:*}/data.bin" bs=1M count="${d##*:}" status=none
done
for i in $(seq 1 200); do echo "кэш $i" > "/var/lib/app/cache/item-$i"; done

# Отправщик логов держит открытым буфер, который уже удалили (как после неудачного logrotate)
cat > /opt/gym/shipper.py <<'PY'
import os
import time

path = "/var/log/shipper/buffer.log"
os.makedirs(os.path.dirname(path), exist_ok=True)
f = open(path, "wb")
f.write(b"\0" * 24 * 1024 * 1024)
f.flush()
os.unlink(path)
while True:
    time.sleep(3600)
PY
cat > /etc/systemd/system/log-shipper.service <<'UNIT'
[Unit]
Description=Отправщик логов
[Service]
ExecStart=/usr/bin/python3 /opt/gym/shipper.py
Restart=always
[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable --now metrics-agent.service web-preview.service log-shipper.service
systemctl start report-sync.service || true
