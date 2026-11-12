# Раннер CI-стендов на Python: uv, ruff и локальный набор пакетов (/wheels).
# Стенд работает без сети: uv берёт пакеты только из /wheels, как раннер с внутренним зеркалом пакетов.
# Пакеты скачиваются один раз при сборке образа.
FROM python:3.12-slim
ARG UV_VERSION=0.12.24
ARG RUFF_VERSION=0.16.10
RUN pip install --no-cache-dir "uv==${UV_VERSION}" "ruff==${RUFF_VERSION}" \
 # версии, которые нужны стенду ci-lockfile: старая и новая ветка packaging и зависимости pytest
 && for req in packaging==21.3 packaging==26.3 pyparsing==3.3.3 pytest==8.3.5 pluggy==1.6.0 iniconfig==2.3.1 colorama==0.4.6; do \
      pip download --no-cache-dir --only-binary=:all: --no-deps -d /wheels "$req" || exit 1; \
    done
# Только локальные пакеты: у --no-index нет переменной окружения, поэтому — системный конфиг uv
COPY uv.toml /etc/uv/uv.toml
ENV UV_PYTHON_DOWNLOADS=never \
    UV_PROJECT_ENVIRONMENT=/tmp/venv \
    UV_CACHE_DIR=/tmp/uv-cache \
    UV_LINK_MODE=copy \
    RUFF_CACHE_DIR=/tmp/ruff-cache \
    PYTEST_ADDOPTS="-p no:cacheprovider" \
    PYTHONDONTWRITEBYTECODE=1
