-- Витрина отчётов: копия счетов биллинга по логической репликации (подписку создаёт setup).
CREATE TABLE invoices (id integer PRIMARY KEY, customer text NOT NULL, total integer NOT NULL);
CREATE TABLE probe (token text PRIMARY KEY, at timestamptz NOT NULL DEFAULT now());
