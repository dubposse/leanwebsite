-- Migration 0005: extend the existing fulfillment record for Business – Rundum Sorglos.
-- New fields stay nullable so existing Artist & Band rows remain valid without backfills.
-- desired_domain remains the requested new .de registration domain, not a builder domain.

ALTER TABLE order_fulfillment ADD COLUMN customer_type text;
-- statement-breakpoint

ALTER TABLE order_fulfillment ADD COLUMN company_name varchar(200);
-- statement-breakpoint

ALTER TABLE order_fulfillment ADD COLUMN domain_holder_type text;
-- statement-breakpoint

ALTER TABLE order_fulfillment ADD COLUMN domain_holder_organization_name varchar(200);
-- statement-breakpoint

-- 0004 has two table-level CHECKs: the alternative-domain check is _check,
-- and this following domain-holder check is _check1. Verify both name and definition before dropping it.
DO $migration$
DECLARE
  holder_constraint_definition text;
BEGIN
  SELECT pg_get_constraintdef(oid)
    INTO holder_constraint_definition
    FROM pg_constraint
    WHERE conrelid = 'order_fulfillment'::regclass
      AND contype = 'c'
      AND conname = 'order_fulfillment_check1';

  IF NOT FOUND
    OR holder_constraint_definition NOT LIKE '%domain_holder_differs%'
    OR holder_constraint_definition NOT LIKE '%domain_holder_first_name%'
    OR holder_constraint_definition NOT LIKE '%domain_holder_last_name%'
    OR holder_constraint_definition NOT LIKE '%domain_holder_email%' THEN
    RAISE EXCEPTION 'expected 0004 domain-holder constraint order_fulfillment_check1 was not found';
  END IF;

  ALTER TABLE order_fulfillment DROP CONSTRAINT order_fulfillment_check1;
END;
$migration$;
-- statement-breakpoint

ALTER TABLE order_fulfillment ADD CONSTRAINT order_fulfillment_domain_holder_details_valid CHECK (
  (
    domain_holder_differs = false
    AND domain_holder_first_name IS NULL
    AND domain_holder_last_name IS NULL
    AND domain_holder_street IS NULL
    AND domain_holder_postal_code IS NULL
    AND domain_holder_city IS NULL
    AND domain_holder_country_code IS NULL
    AND domain_holder_email IS NULL
    AND domain_holder_type IS NULL
    AND domain_holder_organization_name IS NULL
  )
  OR (
    domain_holder_differs = true
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
    AND (
      (
        (domain_holder_type IS NULL OR domain_holder_type = 'person')
        AND domain_holder_first_name IS NOT NULL
        AND length(btrim(domain_holder_first_name)) > 0
        AND domain_holder_last_name IS NOT NULL
        AND length(btrim(domain_holder_last_name)) > 0
        AND domain_holder_organization_name IS NULL
      )
      OR (
        domain_holder_type = 'organization'
        AND domain_holder_first_name IS NULL
        AND domain_holder_last_name IS NULL
        AND domain_holder_organization_name IS NOT NULL
        AND length(btrim(domain_holder_organization_name)) > 0
      )
    )
  )
);
-- statement-breakpoint

ALTER TABLE order_fulfillment ADD CONSTRAINT order_fulfillment_customer_type_consistent CHECK (
  (customer_type IS NULL AND company_name IS NULL)
  OR (
    customer_type IS NOT NULL
    AND customer_type = 'company'
    AND company_name IS NOT NULL
    AND length(btrim(company_name)) > 0
  )
  OR (
    customer_type IS NOT NULL
    AND customer_type = 'self_employed'
    AND company_name IS NULL
  )
);
-- statement-breakpoint

ALTER TABLE order_fulfillment ADD CONSTRAINT order_fulfillment_domain_holder_type_consistent CHECK (
  (domain_holder_type IS NULL AND domain_holder_organization_name IS NULL)
  OR (
    domain_holder_type IS NOT NULL
    AND domain_holder_type = 'person'
    AND domain_holder_organization_name IS NULL
  )
  OR (
    domain_holder_type IS NOT NULL
    AND domain_holder_type = 'organization'
    AND domain_holder_organization_name IS NOT NULL
    AND length(btrim(domain_holder_organization_name)) > 0
  )
);
-- statement-breakpoint

CREATE OR REPLACE FUNCTION order_fulfillment_validate_order() RETURNS trigger AS $$
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

  IF NOT FOUND OR (
    linked_package_code IS DISTINCT FROM 'artist-band-rundum-sorglos'
    AND linked_package_code IS DISTINCT FROM 'business-rundum-sorglos'
  ) THEN
    RAISE EXCEPTION 'fulfillment data requires an eligible Rundum Sorglos order'
      USING ERRCODE = 'check_violation';
  END IF;

  IF TG_OP = 'INSERT' AND linked_order_status IS DISTINCT FROM 'pending' THEN
    RAISE EXCEPTION 'fulfillment data can only be created for a pending order'
      USING ERRCODE = 'check_violation';
  END IF;

  IF linked_package_code = 'business-rundum-sorglos' THEN
    IF NEW.customer_type IS NULL
      OR NEW.customer_type NOT IN ('company', 'self_employed') THEN
      RAISE EXCEPTION 'Business fulfillment requires a customer type'
        USING ERRCODE = 'check_violation';
    END IF;

    IF NEW.customer_type = 'company'
      AND (NEW.company_name IS NULL OR length(btrim(NEW.company_name)) = 0) THEN
      RAISE EXCEPTION 'Business company fulfillment requires a company name'
        USING ERRCODE = 'check_violation';
    END IF;

    IF NEW.customer_type = 'self_employed' AND NEW.company_name IS NOT NULL THEN
      RAISE EXCEPTION 'self-employed fulfillment cannot have a company name'
        USING ERRCODE = 'check_violation';
    END IF;

    IF NEW.domain_holder_differs
      AND NEW.domain_holder_type IS NULL THEN
      RAISE EXCEPTION 'Business fulfillment requires the differing domain holder type'
        USING ERRCODE = 'check_violation';
    END IF;

    IF NOT NEW.domain_holder_differs
      AND (NEW.domain_holder_type IS NOT NULL OR NEW.domain_holder_organization_name IS NOT NULL) THEN
      RAISE EXCEPTION 'domain holder details require a differing domain holder'
        USING ERRCODE = 'check_violation';
    END IF;
  ELSIF NEW.customer_type IS NOT NULL OR NEW.company_name IS NOT NULL THEN
    RAISE EXCEPTION 'Business customer fields require a Business – Rundum Sorglos order'
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
      NEW.hostinger_consented_at,
      NEW.customer_type,
      NEW.company_name,
      NEW.domain_holder_type,
      NEW.domain_holder_organization_name
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
      OLD.hostinger_consented_at,
      OLD.customer_type,
      OLD.company_name,
      OLD.domain_holder_type,
      OLD.domain_holder_organization_name
    ) THEN
    RAISE EXCEPTION 'fulfillment details are immutable unless the order is pending'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
