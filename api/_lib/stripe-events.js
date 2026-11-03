import { getSql } from './db.js'

export const HANDLED_EVENT_TYPES = Object.freeze([
  'checkout.session.completed',
  'checkout.session.async_payment_succeeded',
])

const SELECT_EVENT_SQL = 'SELECT processed_at FROM stripe_events WHERE id = $1'

const SELECT_ORDER_SQL = `SELECT id, status, amount_cents, currency, snapshot_key
  FROM orders WHERE stripe_checkout_session_id = $1`

// Records an event without touching any order. A replay of the same event id is a no-op.
const RECORD_EVENT_SQL = `INSERT INTO stripe_events (id, type, order_id, outcome, review_reason, processed_at)
  VALUES ($1, $2, $3, $4, $5, now())
  ON CONFLICT (id) DO NOTHING`

// One statement, therefore one atomic unit: the pending order becomes paid only if amount and currency
// still match, its draft is locked, and the event is recorded as processed. If anything fails, nothing is stored.
const PROCESS_PAID_SQL = `WITH paid AS (
    UPDATE orders
    SET status = 'paid',
        paid_at = now(),
        stripe_payment_intent_id = COALESCE(stripe_payment_intent_id, $4),
        customer_email = COALESCE(customer_email, $5)
    WHERE id = $1 AND status = 'pending' AND amount_cents = $2 AND currency = $3 AND snapshot_key IS NOT NULL
    RETURNING id, draft_id
  ), locked AS (
    UPDATE drafts SET status = 'locked'
    WHERE id IN (SELECT draft_id FROM paid) AND status = 'draft'
    RETURNING id
  )
  INSERT INTO stripe_events (id, type, order_id, outcome, review_reason, processed_at)
  SELECT $6::text, $7::text, $1::uuid,
    CASE WHEN EXISTS (SELECT 1 FROM paid) THEN 'paid' ELSE 'unchanged' END,
    CASE WHEN EXISTS (SELECT 1 FROM paid) THEN NULL ELSE 'order_changed_concurrently' END,
    now()
  ON CONFLICT (id) DO NOTHING
  RETURNING outcome`

function paymentIntentId(session) {
  const value = session.payment_intent
  return typeof value === 'string' ? value : (value?.id ?? null)
}

// Only a plausible address is stored, so a malformed value can never make the update fail permanently.
function customerEmail(session) {
  const email = session.customer_details?.email ?? session.customer_email ?? null

  return typeof email === 'string' && email.length <= 254 && /^[^\s@]+@[^\s@]+$/.test(email) ? email : null
}

async function record(sql, event, { orderId = null, outcome, reviewReason = null }) {
  await sql.query(RECORD_EVENT_SQL, [event.id, event.type, orderId, outcome, reviewReason])
  return { outcome, orderId, reviewReason }
}

/**
 * Applies a verified Stripe event and returns { outcome, orderId, reviewReason }.
 * Infrastructure errors are thrown so the caller can answer with 5xx and Stripe redelivers.
 * Outcomes: ignored, duplicate, not_paid, order_not_found, mismatch, not_pending, paid, unchanged.
 * A non-null reviewReason is also stored in stripe_events.review_reason for manual follow-up.
 */
export async function processStripeEvent(event, sql = getSql()) {
  if (!HANDLED_EVENT_TYPES.includes(event.type)) return { outcome: 'ignored' }

  const session = event.data?.object

  if (!session || typeof session.id !== 'string') return { outcome: 'ignored' }

  const [existingEvent] = await sql.query(SELECT_EVENT_SQL, [event.id])

  if (existingEvent?.processed_at) return { outcome: 'duplicate' }

  // Asynchronous payment methods complete the session as "unpaid"; the later
  // async_payment_succeeded event carries the confirmation.
  if (session.payment_status !== 'paid') return record(sql, event, { outcome: 'not_paid' })

  // The order is found via the session id stored server-side, never via client-supplied metadata.
  const [order] = await sql.query(SELECT_ORDER_SQL, [session.id])

  // Checkout saves the session id before returning the payment URL, so an unknown session is foreign.
  if (!order) {
    return record(sql, event, { outcome: 'order_not_found', reviewReason: 'unknown_checkout_session' })
  }

  const currency = typeof session.currency === 'string' ? session.currency.toUpperCase() : null
  const mismatches = []

  if (session.amount_total !== order.amount_cents) mismatches.push('amount_mismatch')
  if (currency !== order.currency.trim()) mismatches.push('currency_mismatch')
  if (session.client_reference_id !== order.id) mismatches.push('reference_mismatch')

  if (mismatches.length > 0) {
    // Permanent inconsistency: a retry cannot fix it, so the event is closed, the order stays untouched and flagged.
    return record(sql, event, { orderId: order.id, outcome: 'mismatch', reviewReason: mismatches.join(',') })
  }

  // A payable session only exists for an order with a stored snapshot; without one the order cannot be fulfilled.
  if (!order.snapshot_key) {
    return record(sql, event, { orderId: order.id, outcome: 'mismatch', reviewReason: 'snapshot_missing' })
  }

  if (order.status !== 'pending') {
    // A repeated confirmation for an already paid order is normal; any other state with a payment needs a look.
    return record(sql, event, {
      orderId: order.id,
      outcome: 'not_pending',
      reviewReason: order.status === 'paid' ? null : `order_${order.status}`,
    })
  }

  const rows = await sql.query(PROCESS_PAID_SQL, [
    order.id,
    order.amount_cents,
    currency,
    paymentIntentId(session),
    customerEmail(session),
    event.id,
    event.type,
  ])

  // No row: a concurrent delivery of the same event inserted it first.
  if (rows.length === 0) return { outcome: 'duplicate', orderId: order.id }

  const [{ outcome }] = rows

  return {
    outcome,
    orderId: order.id,
    reviewReason: outcome === 'unchanged' ? 'order_changed_concurrently' : null,
  }
}
