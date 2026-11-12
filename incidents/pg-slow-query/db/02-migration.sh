#!/bin/bash
# Ночная миграция «индекс для отчёта личного кабинета». Выполнялась без транзакции, ошибку не заметили.
psql -v ON_ERROR_STOP=0 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -c "CREATE UNIQUE INDEX CONCURRENTLY orders_customer_id_idx ON orders (customer_id);" || true
