-- Migration 0006: persist electronic consumer withdrawal declarations.

CREATE TABLE withdrawals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_name varchar(200) NOT NULL CHECK (length(btrim(customer_name)) > 0),
  customer_email varchar(254) NOT NULL CHECK (customer_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  order_reference varchar(200),
  message text,
  received_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'received' CHECK (status IN ('received', 'acknowledged', 'resolved')),
  acknowledged_at timestamptz,
  CHECK (order_reference IS NULL OR length(btrim(order_reference)) > 0),
  CHECK (message IS NULL OR length(btrim(message)) > 0)
);
-- statement-breakpoint

CREATE INDEX withdrawals_status_idx ON withdrawals (status);
-- statement-breakpoint

CREATE INDEX withdrawals_received_at_idx ON withdrawals (received_at);
