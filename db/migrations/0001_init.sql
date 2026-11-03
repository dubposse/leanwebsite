-- Migration 0001: LeanWebsite base schema.
-- Statements are separated by the marker line below and executed in one transaction.
-- Plain CREATE TABLE (no IF NOT EXISTS) on purpose: a name clash with a foreign table must abort, not be skipped.

CREATE TABLE builders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name text NOT NULL CHECK (length(btrim(name)) > 0),
  description text NOT NULL DEFAULT '',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
-- statement-breakpoint

CREATE TABLE drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  builder_id uuid NOT NULL REFERENCES builders (id) ON DELETE RESTRICT,
  configuration jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(configuration) = 'object'),
  storage_key text CHECK (storage_key IS NULL OR length(btrim(storage_key)) > 0),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'locked')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- statement-breakpoint

CREATE INDEX drafts_builder_id_idx ON drafts (builder_id);
-- statement-breakpoint

CREATE INDEX drafts_status_idx ON drafts (status);
-- statement-breakpoint

CREATE FUNCTION drafts_enforce_lock() RETURNS trigger AS $$
BEGIN
  IF OLD.status = 'locked' THEN
    RAISE EXCEPTION 'draft % is locked and cannot be modified', OLD.id
      USING ERRCODE = 'check_violation';
  END IF;
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
-- statement-breakpoint

-- Fires only when the row is already locked, so the first draft -> locked transition still works.
CREATE TRIGGER drafts_enforce_lock
  BEFORE UPDATE ON drafts
  FOR EACH ROW EXECUTE FUNCTION drafts_enforce_lock();
-- statement-breakpoint

CREATE FUNCTION drafts_prevent_locked_delete() RETURNS trigger AS $$
BEGIN
  IF OLD.status = 'locked' THEN
    RAISE EXCEPTION 'draft % is locked and cannot be deleted', OLD.id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;
-- statement-breakpoint

CREATE TRIGGER drafts_prevent_locked_delete
  BEFORE DELETE ON drafts
  FOR EACH ROW EXECUTE FUNCTION drafts_prevent_locked_delete();
-- statement-breakpoint

CREATE TABLE orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  draft_id uuid NOT NULL REFERENCES drafts (id) ON DELETE RESTRICT,
  package_code text NOT NULL CHECK (length(btrim(package_code)) > 0),
  amount_cents integer NOT NULL CHECK (amount_cents > 0),
  currency char(3) NOT NULL DEFAULT 'EUR' CHECK (currency = upper(currency)),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'failed', 'refunded')),
  stripe_checkout_session_id text UNIQUE,
  stripe_payment_intent_id text UNIQUE,
  customer_email text CHECK (customer_email IS NULL OR customer_email LIKE '%_@_%'),
  created_at timestamptz NOT NULL DEFAULT now(),
  paid_at timestamptz,
  CHECK (status NOT IN ('paid', 'refunded') OR paid_at IS NOT NULL),
  CHECK (status NOT IN ('pending', 'failed') OR paid_at IS NULL)
);
-- statement-breakpoint

CREATE INDEX orders_draft_id_idx ON orders (draft_id);
-- statement-breakpoint

CREATE INDEX orders_status_created_at_idx ON orders (status, created_at DESC);
-- statement-breakpoint

CREATE INDEX orders_customer_email_idx ON orders (lower(customer_email)) WHERE customer_email IS NOT NULL;
-- statement-breakpoint

CREATE TABLE downloads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders (id) ON DELETE RESTRICT,
  token_hash text NOT NULL UNIQUE CHECK (length(token_hash) > 0),
  expires_at timestamptz NOT NULL,
  download_count integer NOT NULL DEFAULT 0 CHECK (download_count >= 0),
  max_downloads integer NOT NULL DEFAULT 5 CHECK (max_downloads > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (download_count <= max_downloads)
);
-- statement-breakpoint

CREATE INDEX downloads_order_id_idx ON downloads (order_id);
-- statement-breakpoint

CREATE INDEX downloads_expires_at_idx ON downloads (expires_at);
-- statement-breakpoint

-- Idempotency log for Stripe webhooks: the event id is unique, so a replay is detectable via INSERT ... ON CONFLICT DO NOTHING.
CREATE TABLE stripe_events (
  id text PRIMARY KEY CHECK (length(btrim(id)) > 0),
  type text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);
-- statement-breakpoint

CREATE INDEX stripe_events_type_idx ON stripe_events (type);
-- statement-breakpoint

INSERT INTO builders (slug, name, description) VALUES
  ('artist-band', 'Artist & Band', 'Website-Builder für Künstler und Bands'),
  ('business', 'Business', 'Website-Builder für Selbstständige und Kleinunternehmen');
