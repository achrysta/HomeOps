import type { RegressionCase } from './incidentCases.ts'

/** Исправления из debrief; выполняются только внутри копии учебного сервера. */
export const LINUX_CASES: RegressionCase[] = [
  {
    "id": "linux-disk-full",
    "kind": "server",
    "stages": [
      {
        "id": "broken",
        "title": "Раздел заполнен удалённым журналом",
        "expected": {
          "api": false,
          "space": false,
          "logger": true,
          "recovered": false
        }
      },
      {
        "id": "partial",
        "title": "Recovery-code сохранён, открытый файл ещё занимает место",
        "expected": {
          "api": false,
          "space": false,
          "logger": true,
          "recovered": true
        },
        "commands": [
          {
            "service": "server",
            "args": [
              "bash",
              "-ec",
              "pid=$(systemctl show -p MainPID --value payment-logger); for fd in /proc/$pid/fd/*; do case \"$(readlink \"$fd\")\" in *audit.log*deleted*) grep -a -o 'RC-[0-9A-F]\\{12\\}' \"$fd\" > /root/recovered-code.txt; break;; esac; done; test -s /root/recovered-code.txt"
            ]
          }
        ]
      },
      {
        "id": "fixed",
        "title": "Файл обрезан через дескриптор без остановки аудита",
        "expected": {
          "api": true,
          "space": true,
          "logger": true,
          "recovered": true
        },
        "commands": [
          {
            "service": "server",
            "args": [
              "bash",
              "-ec",
              "pid=$(systemctl show -p MainPID --value payment-logger); for fd in /proc/$pid/fd/*; do case \"$(readlink \"$fd\")\" in *audit.log*deleted*) : > \"$fd\"; break;; esac; done"
            ]
          }
        ]
      },
      {
        "id": "bypass-logger",
        "title": "Обход: остановить процесс аудита",
        "expected": {
          "api": true,
          "space": true,
          "logger": false,
          "recovered": true
        },
        "commands": [
          {
            "service": "server",
            "args": [
              "bash",
              "-ec",
              "systemctl stop payment-logger"
            ]
          }
        ]
      }
    ]
  },
  {
    "id": "linux-cron-path",
    "kind": "server",
    "stages": [
      {
        "id": "broken",
        "title": "PATH и строка cron неверны",
        "expected": {
          "shell": false,
          "cron": false,
          "valid": false
        }
      },
      {
        "id": "partial",
        "title": "Login-shell исправлен, cron ещё не запускает бэкап",
        "expected": {
          "shell": true,
          "cron": false,
          "valid": false
        },
        "commands": [
          {
            "service": "server",
            "args": [
              "bash",
              "-ec",
              "sed -i 's@export PATH=/opt/backup/bin@export PATH=$PATH:/opt/backup/bin@' /root/.bashrc"
            ]
          }
        ]
      },
      {
        "id": "fixed",
        "title": "Cron с пользователем, PATH и исполняемым скриптом",
        "expected": {
          "shell": true,
          "cron": true,
          "valid": true
        },
        "commands": [
          {
            "service": "server",
            "args": [
              "bash",
              "-ec",
              "printf 'PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/opt/backup/bin\\n* * * * * root /opt/backup/bin/backup.sh\\n' > /etc/cron.d/db-backup; chmod 755 /opt/backup/bin/backup.sh; systemctl restart cron"
            ]
          }
        ]
      }
    ]
  },
  {
    "id": "linux-nginx-port",
    "kind": "server",
    "stages": [
      {
        "id": "broken",
        "title": "Порт занят превью, каталог закрыт",
        "expected": {
          "nginx": false,
          "site": false,
          "legacy": false,
          "perms": true
        }
      },
      {
        "id": "partial",
        "title": "Старый сервис отключён, nginx отдаёт 403",
        "expected": {
          "nginx": true,
          "site": false,
          "legacy": true,
          "perms": true
        },
        "commands": [
          {
            "service": "server",
            "args": [
              "bash",
              "-ec",
              "systemctl disable --now legacy-preview; systemctl reset-failed nginx; systemctl start nginx"
            ]
          }
        ]
      },
      {
        "id": "fixed",
        "title": "Каталог доступен nginx только на чтение",
        "expected": {
          "nginx": true,
          "site": true,
          "legacy": true,
          "perms": true
        },
        "commands": [
          {
            "service": "server",
            "args": [
              "bash",
              "-ec",
              "chmod 755 /srv/site"
            ]
          }
        ]
      },
      {
        "id": "bypass-perms",
        "title": "Обход: chmod 777",
        "expected": {
          "nginx": true,
          "site": true,
          "legacy": true,
          "perms": false
        },
        "commands": [
          {
            "service": "server",
            "args": [
              "bash",
              "-ec",
              "chmod 777 /srv/site"
            ]
          }
        ]
      }
    ]
  },
  {
    "id": "linux-nginx-vhost",
    "kind": "server",
    "stages": [
      {
        "id": "broken",
        "title": "Имя магазина попадает в первый vhost",
        "expected": {
          "nginx": true,
          "shop": false,
          "www": true,
          "blog": true,
          "unknown": false
        }
      },
      {
        "id": "partial",
        "title": "Имя магазина исправлено, неизвестный Host ещё получает сайт",
        "expected": {
          "nginx": true,
          "shop": true,
          "www": true,
          "blog": true,
          "unknown": false
        },
        "commands": [
          {
            "service": "server",
            "args": [
              "bash",
              "-ec",
              "sed -i 's/server_name www.shop.example.test;/server_name shop.example.test www.shop.example.test;/' /etc/nginx/sites-available/shop.conf; nginx -t; systemctl reload nginx"
            ]
          }
        ]
      },
      {
        "id": "fixed",
        "title": "Отдельный default server отклоняет чужие имена",
        "expected": {
          "nginx": true,
          "shop": true,
          "www": true,
          "blog": true,
          "unknown": true
        },
        "commands": [
          {
            "service": "server",
            "args": [
              "bash",
              "-ec",
              "printf 'server { listen 80 default_server; server_name _; return 444; }\\n' > /etc/nginx/sites-enabled/00-default; nginx -t; systemctl reload nginx"
            ]
          }
        ]
      },
      {
        "id": "bypass-blog",
        "title": "Обход: перенести блог с порта 80",
        "expected": {
          "nginx": true,
          "shop": true,
          "www": true,
          "blog": false,
          "unknown": true
        },
        "commands": [
          {
            "service": "server",
            "args": [
              "bash",
              "-ec",
              "sed -i 's/listen 80;/listen 8088;/' /etc/nginx/sites-available/blog.conf; nginx -t; systemctl reload nginx"
            ]
          }
        ]
      }
    ]
  },
  {
    "id": "linux-inodes",
    "kind": "server",
    "stages": [
      {
        "id": "broken",
        "title": "inode закончились, оригиналы сохранены",
        "expected": {
          "upload": false,
          "inodes": false,
          "originals": true,
          "generator": false,
          "cleanup": false
        }
      },
      {
        "id": "partial",
        "title": "Старый кэш очищен, шаблон очистителя ещё неверный",
        "expected": {
          "upload": true,
          "inodes": true,
          "originals": true,
          "generator": true,
          "cleanup": false
        },
        "commands": [
          {
            "service": "server",
            "args": [
              "bash",
              "-ec",
              "find /srv/media/cache -type f -mmin +10 -delete; sleep 4"
            ]
          }
        ]
      },
      {
        "id": "fixed",
        "title": "Таймер удаляет старые webp",
        "expected": {
          "upload": true,
          "inodes": true,
          "originals": true,
          "generator": true,
          "cleanup": true
        },
        "commands": [
          {
            "service": "server",
            "args": [
              "bash",
              "-ec",
              "sed -i \"s/\\\\*.jpg/\\\\*.webp/\" /usr/local/bin/thumbs-clean; systemctl start thumbs-clean.service"
            ]
          }
        ]
      },
      {
        "id": "bypass-originals",
        "title": "Обход: удалить фотографию пользователя",
        "expected": {
          "upload": true,
          "inodes": true,
          "originals": false,
          "generator": true,
          "cleanup": true
        },
        "commands": [
          {
            "service": "server",
            "args": [
              "bash",
              "-ec",
              "cp /srv/media/originals/photo-000.jpg /root/regression-photo-000.jpg; rm /srv/media/originals/photo-000.jpg"
            ]
          }
        ]
      },
      {
        "id": "bypass-generator",
        "title": "Обход: восстановить фото, но остановить генератор",
        "expected": {
          "upload": true,
          "inodes": true,
          "originals": true,
          "generator": false,
          "cleanup": false
        },
        "commands": [
          {
            "service": "server",
            "args": [
              "bash",
              "-ec",
              "cp /root/regression-photo-000.jpg /srv/media/originals/photo-000.jpg; systemctl stop thumbnailer"
            ]
          }
        ]
      }
    ]
  },
  {
    "id": "linux-open-files",
    "kind": "server",
    "stages": [
      {
        "id": "broken",
        "title": "Лимит работающего сервиса 128",
        "expected": {
          "running": true,
          "limit": false,
          "persistent": false,
          "load": false
        }
      },
      {
        "id": "partial",
        "title": "Drop-in исправлен и перечитан, процесс ещё не перезапущен",
        "expected": {
          "running": true,
          "limit": false,
          "persistent": false,
          "load": false
        },
        "commands": [
          {
            "service": "server",
            "args": [
              "bash",
              "-ec",
              "sed -i 's/LimitNOFILE=128/LimitNOFILE=4096/' /etc/systemd/system/notify-hub.service.d/limits.conf; systemctl daemon-reload"
            ]
          }
        ]
      },
      {
        "id": "fixed",
        "title": "Процесс получил новый постоянный лимит",
        "expected": {
          "running": true,
          "limit": true,
          "persistent": true,
          "load": true
        },
        "commands": [
          {
            "service": "server",
            "args": [
              "bash",
              "-ec",
              "systemctl restart notify-hub"
            ]
          }
        ]
      }
    ]
  },
  {
    "id": "linux-oom",
    "kind": "server",
    "stages": [
      {
        "id": "broken",
        "title": "Кэш больше лимита, сервис падает",
        "expected": {
          "limit": true,
          "running": false,
          "headroom": false,
          "stable": false
        }
      },
      {
        "id": "partial",
        "title": "Кэш помещается впритык без запаса",
        "expected": {
          "limit": true,
          "running": true,
          "headroom": false,
          "stable": true
        },
        "commands": [
          {
            "service": "server",
            "args": [
              "bash",
              "-ec",
              "sed -i 's/CACHE_MB=192/CACHE_MB=100/' /etc/search-index/config; systemctl reset-failed search-index; systemctl restart search-index"
            ]
          }
        ]
      },
      {
        "id": "fixed",
        "title": "Кэш 64 МБ оставляет запас",
        "expected": {
          "limit": true,
          "running": true,
          "headroom": true,
          "stable": true
        },
        "commands": [
          {
            "service": "server",
            "args": [
              "bash",
              "-ec",
              "sed -i 's/CACHE_MB=100/CACHE_MB=64/' /etc/search-index/config; systemctl restart search-index"
            ]
          }
        ]
      },
      {
        "id": "bypass-memory",
        "title": "Обход: поднять MemoryMax",
        "expected": {
          "limit": false,
          "running": false,
          "headroom": false,
          "stable": false
        },
        "commands": [
          {
            "service": "server",
            "args": [
              "bash",
              "-ec",
              "sed -i 's/MemoryMax=128M/MemoryMax=256M/' /etc/systemd/system/search-index.service; systemctl daemon-reload; systemctl restart search-index"
            ]
          }
        ]
      },
      {
        "id": "bypass-swap",
        "title": "Обход: вернуть MemoryMax, разрешить swap",
        "expected": {
          "limit": false,
          "running": false,
          "headroom": false,
          "stable": false
        },
        "commands": [
          {
            "service": "server",
            "args": [
              "bash",
              "-ec",
              "sed -i 's/MemoryMax=256M/MemoryMax=128M/; s/MemorySwapMax=0/MemorySwapMax=64M/' /etc/systemd/system/search-index.service; systemctl daemon-reload; systemctl restart search-index"
            ]
          }
        ]
      }
    ]
  },
  {
    "id": "linux-dns",
    "kind": "server",
    "allowRedPartial": true,
    "stages": [
      {
        "id": "broken",
        "title": "NSS берёт старую запись hosts",
        "expected": {
          "resolve": false,
          "checkout": false,
          "no-pin": false
        }
      },
      {
        "id": "partial",
        "title": "Старая привязка убрана, NSS пока без DNS",
        "expected": {
          "resolve": false,
          "checkout": false,
          "no-pin": false
        },
        "commands": [
          {
            "service": "server",
            "args": [
              "bash",
              "-ec",
              "sed -i '/billing\\.internal/d' /etc/hosts"
            ]
          }
        ]
      },
      {
        "id": "fixed",
        "title": "NSS использует files и DNS",
        "expected": {
          "resolve": true,
          "checkout": true,
          "no-pin": true
        },
        "commands": [
          {
            "service": "server",
            "args": [
              "bash",
              "-ec",
              "sed -i 's/^hosts:.*/hosts: files dns/' /etc/nsswitch.conf"
            ]
          }
        ]
      },
      {
        "id": "bypass-pin",
        "title": "Обход: прибить актуальный IP",
        "expected": {
          "resolve": true,
          "checkout": true,
          "no-pin": false
        },
        "commands": [
          {
            "service": "server",
            "args": [
              "bash",
              "-ec",
              "printf '%s billing.internal\\n' \"$(dig +short billing.internal | head -n1)\" >> /etc/hosts"
            ]
          }
        ]
      }
    ]
  },
  {
    "id": "linux-ssh-key",
    "kind": "server",
    "allowRedPartial": true,
    "stages": [
      {
        "id": "broken",
        "title": "Нет нового ключа, неправильные права и AllowUsers",
        "expected": {
          "login": false,
          "deploy": false,
          "perms": false,
          "hardening": false
        }
      },
      {
        "id": "partial",
        "title": "Права и ключ исправлены, AllowUsers ещё исключает deploy",
        "expected": {
          "login": false,
          "deploy": false,
          "perms": false,
          "hardening": false
        },
        "commands": [
          {
            "service": "server",
            "args": [
              "bash",
              "-ec",
              "chmod 755 /home/deploy; cat /opt/ci/deploy_key.pub >> /home/deploy/.ssh/authorized_keys; chown deploy:deploy /home/deploy/.ssh/authorized_keys; chmod 600 /home/deploy/.ssh/authorized_keys"
            ]
          }
        ]
      },
      {
        "id": "fixed",
        "title": "Deploy разрешён, харденинг сохранён",
        "expected": {
          "login": true,
          "deploy": true,
          "perms": true,
          "hardening": true
        },
        "commands": [
          {
            "service": "server",
            "args": [
              "bash",
              "-ec",
              "sed -i 's/^AllowUsers admin$/AllowUsers admin deploy/' /etc/ssh/sshd_config.d/10-hardening.conf; systemctl reload ssh"
            ]
          }
        ]
      },
      {
        "id": "bypass-password",
        "title": "Обход: включить вход по паролю",
        "expected": {
          "login": true,
          "deploy": true,
          "perms": true,
          "hardening": false
        },
        "commands": [
          {
            "service": "server",
            "args": [
              "bash",
              "-ec",
              "sed -i 's/PasswordAuthentication no/PasswordAuthentication yes/' /etc/ssh/sshd_config.d/10-hardening.conf; systemctl reload ssh"
            ]
          }
        ]
      },
      {
        "id": "bypass-strict",
        "title": "Обход: вернуть пароли, отключить StrictModes",
        "expected": {
          "login": true,
          "deploy": true,
          "perms": true,
          "hardening": false
        },
        "commands": [
          {
            "service": "server",
            "args": [
              "bash",
              "-ec",
              "sed -i 's/PasswordAuthentication yes/PasswordAuthentication no/' /etc/ssh/sshd_config.d/10-hardening.conf; printf '\\nStrictModes no\\n' >> /etc/ssh/sshd_config.d/10-hardening.conf; systemctl reload ssh"
            ]
          }
        ]
      },
      {
        "id": "bypass-perms",
        "title": "Обход: запись всем при отключённом StrictModes",
        "expected": {
          "login": true,
          "deploy": true,
          "perms": false,
          "hardening": false
        },
        "commands": [
          {
            "service": "server",
            "args": [
              "bash",
              "-ec",
              "chmod 777 /home/deploy"
            ]
          }
        ]
      }
    ]
  },
  {
    "id": "linux-journald",
    "kind": "server",
    "stages": [
      {
        "id": "broken",
        "title": "Журнал заполнил раздел",
        "expected": {
          "api": true,
          "space": false,
          "journal-limit": false,
          "noise": false,
          "storage": false
        }
      },
      {
        "id": "partial",
        "title": "Место освобождено и шум убран, лимит ещё 1 ГБ",
        "expected": {
          "api": true,
          "space": true,
          "journal-limit": false,
          "noise": false,
          "storage": false
        },
        "commands": [
          {
            "service": "server",
            "args": [
              "bash",
              "-ec",
              "sed -i 's/LOG_LEVEL=debug/LOG_LEVEL=info/' /etc/default/price-sync; systemctl restart price-sync; journalctl --rotate; journalctl --vacuum-size=16M"
            ]
          }
        ]
      },
      {
        "id": "fixed",
        "title": "Ограничен постоянный журнал",
        "expected": {
          "api": true,
          "space": true,
          "journal-limit": true,
          "noise": true,
          "storage": true
        },
        "commands": [
          {
            "service": "server",
            "args": [
              "bash",
              "-ec",
              "sed -i 's/SystemMaxUse=1G/SystemMaxUse=24M/; s/SystemKeepFree=0/SystemKeepFree=32M/' /etc/systemd/journald.conf.d/90-retention.conf; systemctl restart systemd-journald; journalctl --flush; journalctl --rotate; journalctl --vacuum-size=16M; sleep 6"
            ]
          }
        ]
      },
      {
        "id": "bypass-volatile",
        "title": "Обход: перенести журнал в RAM",
        "expected": {
          "api": true,
          "space": true,
          "journal-limit": true,
          "noise": true,
          "storage": false
        },
        "commands": [
          {
            "service": "server",
            "args": [
              "bash",
              "-ec",
              "sed -i 's/Storage=persistent/Storage=volatile/' /etc/systemd/journald.conf.d/90-retention.conf; systemctl restart systemd-journald"
            ]
          }
        ]
      },
      {
        "id": "bypass-no-sync",
        "title": "Обход: журнал вернуть, синхронизацию остановить",
        "expected": {
          "api": true,
          "space": true,
          "journal-limit": true,
          "noise": true,
          "storage": false
        },
        "commands": [
          {
            "service": "server",
            "args": [
              "bash",
              "-ec",
              "sed -i 's/Storage=volatile/Storage=persistent/' /etc/systemd/journald.conf.d/90-retention.conf; systemctl restart systemd-journald; journalctl --flush; systemctl stop price-sync"
            ]
          }
        ]
      }
    ]
  },
  {
    "id": "linux-final",
    "kind": "server",
    "stages": [
      {
        "id": "broken",
        "title": "Раздел занят дампом, пользователь неверен, upstream недоступен",
        "expected": {
          "disk": false,
          "api": false,
          "user": false,
          "logs": false,
          "site": false,
          "boot": false
        }
      },
      {
        "id": "partial",
        "title": "Открытый дамп освобождён, API ещё не стартует",
        "expected": {
          "disk": true,
          "api": false,
          "user": false,
          "logs": false,
          "site": false,
          "boot": false
        },
        "commands": [
          {
            "service": "server",
            "args": [
              "bash",
              "-ec",
              "systemctl stop debug-dump"
            ]
          }
        ]
      },
      {
        "id": "fixed",
        "title": "Непривилегированный API, журнал, upstream и автозапуск",
        "expected": {
          "disk": true,
          "api": true,
          "user": true,
          "logs": true,
          "site": true,
          "boot": true
        },
        "commands": [
          {
            "service": "server",
            "args": [
              "bash",
              "-ec",
              "sed -i 's/User=api-svc/User=api/' /etc/systemd/system/api.service; sed -i 's/10.255.0.9/127.0.0.1/' /etc/hosts; systemctl daemon-reload; systemctl reset-failed api; systemctl enable --now api; systemctl reload nginx"
            ]
          }
        ]
      },
      {
        "id": "bypass-root",
        "title": "Обход: запустить API от root",
        "expected": {
          "disk": true,
          "api": true,
          "user": false,
          "logs": true,
          "site": true,
          "boot": true
        },
        "commands": [
          {
            "service": "server",
            "args": [
              "bash",
              "-ec",
              "sed -i 's/User=api$/User=root/' /etc/systemd/system/api.service; systemctl daemon-reload; systemctl restart api"
            ]
          }
        ]
      },
      {
        "id": "bypass-logs",
        "title": "Обход: пользователя вернуть, журнал перенаправить",
        "expected": {
          "disk": true,
          "api": true,
          "user": true,
          "logs": false,
          "site": true,
          "boot": true
        },
        "commands": [
          {
            "service": "server",
            "args": [
              "bash",
              "-ec",
              "sed -i 's/User=root/User=api/' /etc/systemd/system/api.service; sed -i 's@LOG = \"/var/log/api/api.log\"@LOG = \"/tmp/api.log\"@' /opt/api/app.py; rm -f /var/log/api/api.log; systemctl daemon-reload; systemctl restart api"
            ]
          }
        ]
      }
    ]
  }
]
