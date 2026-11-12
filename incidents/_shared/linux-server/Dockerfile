# Учебный Linux-сервер для инцидентов: Ubuntu 24.04 с systemd как PID 1, journald, cron, nginx
# и набором утилит дежурного. Работает как маленькая VM: терминал дашборда открывается внутри.
#
# Поломку конкретного инцидента готовит homeops-setup.service при первом старте: он запускает
# setup.sh из папки incidents/<id>/setup (монтируется в /usr/local/lib/homeops/incident) и после
# этого отмонтирует её, чтобы сценарий поломки не лежал на виду.
FROM ubuntu:24.04
ENV container=docker \
    DEBIAN_FRONTEND=noninteractive \
    LANG=C.UTF-8
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      systemd systemd-sysv dbus cron nginx python3 curl ca-certificates procps psmisc lsof iproute2 \
      iputils-ping dnsutils netcat-openbsd less vim-tiny nano sudo jq tree file strace htop openssh-server openssh-client git make \
 && apt-get clean && rm -rf /var/lib/apt/lists/* \
 # в контейнере не нужны устройства, консоли и вход в систему
 && systemctl mask systemd-udevd.service systemd-udevd-kernel.socket systemd-udevd-control.socket \
      systemd-logind.service getty.target console-getty.service systemd-firstboot.service \
      systemd-resolved.service apt-daily.timer apt-daily-upgrade.timer motd-news.timer e2scrub_all.timer fstrim.timer \
 && systemctl disable nginx \
 # sshd нужен только стендам про ssh: они включают его сами в setup.sh
 && systemctl disable ssh.socket ssh.service \
 && ln -sf /usr/bin/vim.tiny /usr/local/bin/vim
COPY homeops-setup.service /etc/systemd/system/homeops-setup.service
COPY verify /usr/local/bin/verify
COPY homeops-init /usr/local/bin/homeops-init
RUN chmod 0755 /usr/local/bin/verify /usr/local/bin/homeops-init && systemctl enable homeops-setup.service \
 && printf '%s\n' 'PS1="\[\e[32m\]root@\h\[\e[0m\]:\w# "' \
      'echo "Учебный сервер инцидента. Проверить решение: verify"' >> /root/.bashrc
STOPSIGNAL SIGRTMIN+3
ENTRYPOINT ["/usr/local/bin/homeops-init"]
CMD ["/sbin/init"]
