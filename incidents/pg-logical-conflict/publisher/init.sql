-- Биллинг: источник истины по счетам, публикует их на витрину отчётов.
CREATE TABLE invoices (id integer PRIMARY KEY, customer text NOT NULL, total integer NOT NULL);
-- служебная таблица пробных записей автопроверки
CREATE TABLE probe (token text PRIMARY KEY, at timestamptz NOT NULL DEFAULT now());
INSERT INTO invoices VALUES (1, 'ООО Ромашка', 4800), (2, 'ИП Соколов', 1200), (3, 'ООО Вектор', 7500);
CREATE PUBLICATION pub_billing FOR TABLE invoices, probe;
