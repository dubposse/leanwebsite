-- Migration 0003: immutable website snapshot per order.
-- 0001 and 0002 stay untouched. Additive changes only; nothing is dropped or rewritten.
--
-- The snapshot is a byte-for-byte copy of the draft content, stored in the private R2 bucket under
-- orders/<order id>/snapshot. The order references it by key, SHA-256 and size. It is written before the
-- Stripe session exists and can never change afterwards.

ALTER TABLE orders ADD COLUMN snapshot_key text;
-- statement-breakpoint

ALTER TABLE orders ADD COLUMN snapshot_sha256 text;
-- statement-breakpoint

ALTER TABLE orders ADD COLUMN snapshot_size integer;
-- statement-breakpoint

ALTER TABLE orders ADD COLUMN snapshot_content_type text;
-- statement-breakpoint

-- All four snapshot fields are set together, and the key is derived from the order id (no foreign or client paths).
ALTER TABLE orders ADD CONSTRAINT orders_snapshot_consistent CHECK (
  (snapshot_key IS NULL AND snapshot_sha256 IS NULL AND snapshot_size IS NULL AND snapshot_content_type IS NULL)
  OR (
    snapshot_key = 'orders/' || id::text || '/snapshot'
    AND snapshot_sha256 ~ '^[0-9a-f]{64}$'
    AND snapshot_size BETWEEN 1 AND 52428800
    AND length(btrim(snapshot_content_type)) > 0
  )
);
-- statement-breakpoint

-- A payable Stripe session, or a paid order, requires a stored snapshot.
-- NOT VALID: enforced for every new or updated row without scanning rows that predate this migration.
ALTER TABLE orders ADD CONSTRAINT orders_session_requires_snapshot
  CHECK (stripe_checkout_session_id IS NULL OR snapshot_key IS NOT NULL) NOT VALID;
-- statement-breakpoint

ALTER TABLE orders ADD CONSTRAINT orders_paid_requires_snapshot
  CHECK (status <> 'paid' OR snapshot_key IS NOT NULL) NOT VALID;
-- statement-breakpoint

CREATE FUNCTION orders_protect_immutable_fields() RETURNS trigger AS $$
BEGIN
  IF OLD.snapshot_key IS NOT NULL AND (
    NEW.snapshot_key IS DISTINCT FROM OLD.snapshot_key
    OR NEW.snapshot_sha256 IS DISTINCT FROM OLD.snapshot_sha256
    OR NEW.snapshot_size IS DISTINCT FROM OLD.snapshot_size
    OR NEW.snapshot_content_type IS DISTINCT FROM OLD.snapshot_content_type
  ) THEN
    RAISE EXCEPTION 'snapshot of order % is immutable', OLD.id USING ERRCODE = 'check_violation';
  END IF;

  -- Once a checkout session is attached, the offer it was created for cannot change.
  IF OLD.stripe_checkout_session_id IS NOT NULL AND (
    NEW.stripe_checkout_session_id IS DISTINCT FROM OLD.stripe_checkout_session_id
    OR NEW.draft_id IS DISTINCT FROM OLD.draft_id
    OR NEW.package_code IS DISTINCT FROM OLD.package_code
    OR NEW.amount_cents IS DISTINCT FROM OLD.amount_cents
    OR NEW.currency IS DISTINCT FROM OLD.currency
  ) THEN
    RAISE EXCEPTION 'order % is bound to a checkout session and its offer is immutable', OLD.id
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
-- statement-breakpoint

CREATE TRIGGER orders_protect_immutable_fields
  BEFORE UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION orders_protect_immutable_fields();
