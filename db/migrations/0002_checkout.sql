-- Migration 0002: checkout support (draft ownership, one open order per draft, event review trail).
-- 0001_init.sql stays untouched. Additive changes only; nothing is dropped or rewritten.

-- Draft ownership: only the SHA-256 hash (hex) of a secret token is stored, never the token itself.
-- Nullable so rows created before this migration stay valid; checkout rejects drafts without a hash.
ALTER TABLE drafts ADD COLUMN access_token_hash text;
-- statement-breakpoint

ALTER TABLE drafts ADD CONSTRAINT drafts_access_token_hash_format
  CHECK (access_token_hash IS NULL OR access_token_hash ~ '^[0-9a-f]{64}$');
-- statement-breakpoint

CREATE UNIQUE INDEX drafts_access_token_hash_key ON drafts (access_token_hash) WHERE access_token_hash IS NOT NULL;
-- statement-breakpoint

-- At most one open checkout per draft: repeated or concurrent checkout requests cannot create duplicate orders.
CREATE UNIQUE INDEX orders_one_pending_per_draft_idx ON orders (draft_id) WHERE status = 'pending';
-- statement-breakpoint

-- An order can only be paid if it is linked to a Stripe Checkout Session.
ALTER TABLE orders ADD CONSTRAINT orders_paid_requires_session
  CHECK (status <> 'paid' OR stripe_checkout_session_id IS NOT NULL);
-- statement-breakpoint

-- Audit trail for processed webhook events: which order, what happened, and why a manual review is needed.
ALTER TABLE stripe_events ADD COLUMN order_id uuid REFERENCES orders (id) ON DELETE RESTRICT;
-- statement-breakpoint

ALTER TABLE stripe_events ADD COLUMN outcome text;
-- statement-breakpoint

ALTER TABLE stripe_events ADD COLUMN review_reason text;
-- statement-breakpoint

CREATE INDEX stripe_events_order_id_idx ON stripe_events (order_id) WHERE order_id IS NOT NULL;
-- statement-breakpoint

-- Open review items: SELECT id, type, order_id, outcome, review_reason, received_at FROM stripe_events WHERE review_reason IS NOT NULL;
CREATE INDEX stripe_events_review_idx ON stripe_events (received_at) WHERE review_reason IS NOT NULL;
