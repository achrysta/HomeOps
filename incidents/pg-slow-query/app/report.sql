-- Последние оплаченные заказы клиента для личного кабинета.
-- Запрос принадлежит приложению команды кабинета: менять его нельзя.
SELECT id, total, created_at
FROM orders
WHERE customer_id = :customer AND status = 'paid'
ORDER BY created_at DESC
LIMIT 20;
