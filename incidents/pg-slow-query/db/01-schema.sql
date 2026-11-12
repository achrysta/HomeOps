-- Магазин: 3 млн заказов за два года, 100 тысяч клиентов.
CREATE TABLE orders (
    id          bigserial PRIMARY KEY,
    customer_id integer     NOT NULL,
    status      text        NOT NULL,
    total       numeric(10, 2) NOT NULL,
    created_at  timestamptz NOT NULL
);
INSERT INTO orders (customer_id, status, total, created_at)
SELECT 1 + (random() * 99999)::int,
       (ARRAY['paid', 'paid', 'paid', 'new', 'cancelled'])[1 + (random() * 4)::int],
       round((random() * 5000)::numeric, 2),
       now() - random() * interval '730 days'
FROM generate_series(1, 3000000);
-- индекс для выборок «за период» — был с самого начала
CREATE INDEX orders_created_at_idx ON orders (created_at);
ANALYZE orders;
