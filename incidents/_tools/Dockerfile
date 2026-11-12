# Общий образ инструментов для всех инцидентов: автопроверка, сброс и терминал в сети стенда.
# Скрипты (verify.py, reset.py) не копируются в образ, а монтируются — образ почти не меняется.
FROM python:3.12-alpine
# postgresql-client — psql для стендов с базой, redis — redis-cli для стендов Redis (проверки и терминал)
RUN apk add --no-cache curl jq bind-tools postgresql-client redis
ENV PYTHONIOENCODING=utf-8 \
    PYTHONDONTWRITEBYTECODE=1 \
    PS1='incident:\w$ '
WORKDIR /scenario
