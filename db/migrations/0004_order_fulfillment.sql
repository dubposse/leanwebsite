-- Migration 0004: private fulfillment details for Artist & Band – Rundum Sorglos orders.
-- Order payment state remains in orders.status; fulfillment progress is stored separately.

CREATE TABLE order_fulfillment (
  order_id uuid PRIMARY KEY REFERENCES orders (id) ON DELETE RESTRICT,
  first_name varchar(100) NOT NULL CHECK (length(btrim(first_name)) > 0),
  last_name varchar(100) NOT NULL CHECK (length(btrim(last_name)) > 0),
  billing_street varchar(200) NOT NULL CHECK (length(btrim(billing_street)) > 0),
  billing_postal_code varchar(20) NOT NULL CHECK (length(btrim(billing_postal_code)) > 0),
  billing_city varchar(100) NOT NULL CHECK (length(btrim(billing_city)) > 0),
  billing_country_code varchar(2) NOT NULL CHECK (billing_country_code ~ '^[A-Z]{2}$'),
  communication_email varchar(254) NOT NULL
    CHECK (communication_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  desired_domain varchar(253) NOT NULL
    CHECK (desired_domain ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.de$'),
  alternative_domain varchar(253)
    CHECK (
      alternative_domain IS NULL
      OR alternative_domain ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.de$'
    ),
  domain_holder_differs boolean NOT NULL,
  domain_holder_first_name varchar(100),
  domain_holder_last_name varchar(100),
  domain_holder_street varchar(200),
  domain_holder_postal_code varchar(20),
  domain_holder_city varchar(100),
  domain_holder_country_code varchar(2),
  domain_holder_email varchar(254),
  hostinger_consent_version varchar(64) NOT NULL
    CHECK (length(btrim(hostinger_consent_version)) > 0),
  hostinger_consented_at timestamptz NOT NULL,
  fulfillment_status text NOT NULL DEFAULT 'pending'
    CHECK (fulfillment_status IN (
      'pending',
      'in_progress',
      'published',
      'credentials_handed_over',
      'completed',
      'needs_review'
    )),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (alternative_domain IS NULL OR alternative_domain <> desired_domain),
  CHECK (
    (
      domain_holder_differs = false
      AND domain_holder_first_name IS NULL
      AND domain_holder_last_name IS NULL
      AND domain_holder_street IS NULL
      AND domain_holder_postal_code IS NULL
      AND domain_holder_city IS NULL
      AND domain_holder_country_code IS NULL
      AND domain_holder_email IS NULL
    )
    OR (
      domain_holder_differs = true
      AND domain_holder_first_name IS NOT NULL
      AND length(btrim(domain_holder_first_name)) > 0
      AND domain_holder_last_name IS NOT NULL
      AND length(btrim(domain_holder_last_name)) > 0
      AND domain_holder_street IS NOT NULL
      AND length(btrim(domain_holder_street)) > 0
      AND domain_holder_postal_code IS NOT NULL
      AND length(btrim(domain_holder_postal_code)) > 0
      AND domain_holder_city IS NOT NULL
      AND length(btrim(domain_holder_city)) > 0
      AND domain_holder_country_code IS NOT NULL
      AND domain_holder_country_code ~ '^[A-Z]{2}$'
      AND domain_holder_email IS NOT NULL
      AND domain_holder_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    )
  )
);
-- statement-breakpoint

CREATE INDEX order_fulfillment_status_created_at_idx
  ON order_fulfillment (fulfillment_status, created_at);
-- statement-breakpoint

CREATE FUNCTION order_fulfillment_validate_order() RETURNS trigger AS $$
DECLARE
  linked_package_code text;
  linked_order_status text;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.order_id IS DISTINCT FROM OLD.order_id THEN
    RAISE EXCEPTION 'fulfillment order_id is immutable'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT package_code, status
    INTO linked_package_code, linked_order_status
    FROM orders
    WHERE id = NEW.order_id
    FOR UPDATE;

  IF NOT FOUND OR linked_package_code IS DISTINCT FROM 'artist-band-rundum-sorglos' THEN
    RAISE EXCEPTION 'fulfillment data requires an Artist & Band – Rundum Sorglos order'
      USING ERRCODE = 'check_violation';
  END IF;

  IF TG_OP = 'INSERT' AND linked_order_status IS DISTINCT FROM 'pending' THEN
    RAISE EXCEPTION 'fulfillment data can only be created for a pending order'
      USING ERRCODE = 'check_violation';
  END IF;

  IF TG_OP = 'UPDATE'
    AND linked_order_status IS DISTINCT FROM 'pending'
    AND ROW(
      NEW.first_name,
      NEW.last_name,
      NEW.billing_street,
      NEW.billing_postal_code,
      NEW.billing_city,
      NEW.billing_country_code,
      NEW.communication_email,
      NEW.desired_domain,
      NEW.alternative_domain,
      NEW.domain_holder_differs,
      NEW.domain_holder_first_name,
      NEW.domain_holder_last_name,
      NEW.domain_holder_street,
      NEW.domain_holder_postal_code,
      NEW.domain_holder_city,
      NEW.domain_holder_country_code,
      NEW.domain_holder_email,
      NEW.hostinger_consent_version,
      NEW.hostinger_consented_at
    ) IS DISTINCT FROM ROW(
      OLD.first_name,
      OLD.last_name,
      OLD.billing_street,
      OLD.billing_postal_code,
      OLD.billing_city,
      OLD.billing_country_code,
      OLD.communication_email,
      OLD.desired_domain,
      OLD.alternative_domain,
      OLD.domain_holder_differs,
      OLD.domain_holder_first_name,
      OLD.domain_holder_last_name,
      OLD.domain_holder_street,
      OLD.domain_holder_postal_code,
      OLD.domain_holder_city,
      OLD.domain_holder_country_code,
      OLD.domain_holder_email,
      OLD.hostinger_consent_version,
      OLD.hostinger_consented_at
    ) THEN
    RAISE EXCEPTION 'fulfillment details are immutable unless the order is pending'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
-- statement-breakpoint

CREATE TRIGGER order_fulfillment_validate_order
  BEFORE INSERT OR UPDATE ON order_fulfillment
  FOR EACH ROW EXECUTE FUNCTION order_fulfillment_validate_order();
-- statement-breakpoint

CREATE FUNCTION order_fulfillment_protect_delete() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'fulfillment data cannot be deleted'
    USING ERRCODE = 'check_violation';
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;
-- statement-breakpoint

CREATE TRIGGER order_fulfillment_protect_delete
  BEFORE DELETE ON order_fulfillment
  FOR EACH ROW EXECUTE FUNCTION order_fulfillment_protect_delete();
-- statement-breakpoint

CREATE FUNCTION order_fulfillment_set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
-- statement-breakpoint

CREATE TRIGGER order_fulfillment_set_updated_at
  BEFORE UPDATE ON order_fulfillment
  FOR EACH ROW EXECUTE FUNCTION order_fulfillment_set_updated_at();
