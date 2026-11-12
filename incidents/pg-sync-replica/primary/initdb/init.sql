-- Первичная база платежей: исходные чеки, касса и пользователь репликации.
CREATE ROLE cashier LOGIN PASSWORD 'cashier';
CREATE ROLE replicator LOGIN REPLICATION PASSWORD 'replicator';

CREATE TABLE payments (
  id bigserial PRIMARY KEY,
  receipt text NOT NULL,
  amount integer NOT NULL,
  paid_at timestamptz NOT NULL DEFAULT now()
);
-- служебная таблица пробных оплат автопроверки
CREATE TABLE probe (token text PRIMARY KEY, at timestamptz NOT NULL DEFAULT now());
GRANT SELECT, INSERT ON payments, probe TO cashier;
GRANT USAGE ON SEQUENCE payments_id_seq TO cashier;

INSERT INTO payments (receipt, amount) VALUES ('R-1001', 4800), ('R-1002', 1200), ('R-1003', 7500);

-- RPO 0: коммит подтверждает синхронная реплика
ALTER SYSTEM SET synchronous_standby_names = 'standby1';
