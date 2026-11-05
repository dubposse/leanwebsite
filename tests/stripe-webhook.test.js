import assert from 'node:assert/strict'
import { beforeEach, describe, it } from 'node:test'
import Stripe from 'stripe'
import { createStripeWebhookHandler } from '../api/stripe-webhook.js'
import { buildRequest, buildResponse, createFakeDb } from './helpers/fakes.js'

const SECRET = 'whsec_test_dummy_secret'
const SESSION_ID = 'cs_test_123'
const ORDER_ID = '11111111-1111-4111-8111-111111111111'
const DRAFT_ID = '33333333-3333-4333-8333-333333333333'

function pendingOrder(overrides = {}) {
  return {
    id: ORDER_ID,
    draft_id: DRAFT_ID,
    status: 'pending',
    package_code: 'artist-band-code-and-go',
    amount_cents: 3900,
    currency: 'EUR',
    stripe_checkout_session_id: SESSION_ID,
    stripe_payment_intent_id: null,
    customer_email: null,
    paid_at: null,
    snapshot_key: `orders/${ORDER_ID}/snapshot`,
    ...overrides,
  }
}

function buildEvent({ id = 'evt_1', type = 'checkout.session.completed', session = {} } = {}) {
  return {
    id,
    object: 'event',
    type,
    data: {
      object: {
        id: SESSION_ID,
        object: 'checkout.session',
        payment_status: 'paid',
        amount_total: 3900,
        currency: 'eur',
        client_reference_id: ORDER_ID,
        payment_intent: 'pi_test_1',
        customer_details: { email: 'kunde@example.com' },
        ...session,
      },
    },
  }
}

function signedRequest(payload, { signature, method = 'POST', secret = SECRET } = {}) {
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload)
  const headers = {}
  const sig = signature === undefined ? Stripe.webhooks.generateTestHeaderString({ payload: body, secret }) : signature

  if (sig !== null) headers['stripe-signature'] = sig

  return buildRequest(body, { method, headers })
}

describe('POST /api/stripe-webhook', () => {
  let db
  let handler

  const send = async (payload, options) => {
    const res = buildResponse()
    await handler(signedRequest(payload, options), res)
    return res
  }

  beforeEach(() => {
    db = createFakeDb()
    db.drafts.push({ id: DRAFT_ID, builder_id: 'b1', status: 'draft', access_token_hash: null })
    db.orders.push(pendingOrder())
    handler = createStripeWebhookHandler({ getSecret: () => SECRET, getDb: () => db })
  })

  describe('signature handling', () => {
    it('rejects an invalid signature with 400 and changes nothing', async () => {
      const res = await send(buildEvent(), { signature: 't=1,v1=deadbeef' })
      assert.equal(res.statusCode, 400)
      assert.equal(db.orders[0].status, 'pending')
      assert.equal(db.events.size, 0)
    })

    it('rejects a missing signature header with 400', async () => {
      assert.equal((await send(buildEvent(), { signature: null })).statusCode, 400)
    })

    it('rejects a payload modified after signing', async () => {
      const body = JSON.stringify(buildEvent())
      const signature = Stripe.webhooks.generateTestHeaderString({ payload: body, secret: SECRET })
      const res = await send(body.replace('3900', '1'), { signature })
      assert.equal(res.statusCode, 400)
      assert.equal(db.orders[0].status, 'pending')
    })

    it('rejects a signature made with another secret', async () => {
      assert.equal((await send(buildEvent(), { secret: 'whsec_other' })).statusCode, 400)
    })

    it('rejects non-POST methods with 405', async () => {
      const res = await send(buildEvent(), { method: 'GET' })
      assert.equal(res.statusCode, 405)
      assert.equal(res.headers.Allow, 'POST')
    })

    it('answers 500 when the webhook secret is not configured', async () => {
      handler = createStripeWebhookHandler({
        getSecret: () => {
          throw new Error('missing')
        },
        getDb: () => db,
      })
      assert.equal((await send(buildEvent())).statusCode, 500)
    })
  })

  describe('event handling', () => {
    it('marks the order paid and locks the draft for checkout.session.completed', async () => {
      const res = await send(buildEvent())
      assert.equal(res.statusCode, 200)
      assert.equal(db.orders[0].status, 'paid')
      assert.ok(db.orders[0].paid_at)
      assert.equal(db.orders[0].stripe_payment_intent_id, 'pi_test_1')
      assert.equal(db.orders[0].customer_email, 'kunde@example.com')
      assert.equal(db.drafts[0].status, 'locked')
      assert.equal(db.events.get('evt_1').outcome, 'paid')
      assert.equal(db.events.get('evt_1').review_reason, null)
    })

    it('marks the order paid for checkout.session.async_payment_succeeded', async () => {
      await send(buildEvent({ type: 'checkout.session.async_payment_succeeded' }))
      assert.equal(db.orders[0].status, 'paid')
    })

    it('does not mark unpaid sessions as paid and keeps the draft editable', async () => {
      const res = await send(buildEvent({ session: { payment_status: 'unpaid' } }))
      assert.equal(res.statusCode, 200)
      assert.equal(db.orders[0].status, 'pending')
      assert.equal(db.drafts[0].status, 'draft')
    })

    it('ignores unknown event types without touching the database', async () => {
      const res = await send(buildEvent({ type: 'customer.created' }))
      assert.equal(res.statusCode, 200)
      assert.equal(db.queries.length, 0)
      assert.equal(db.events.size, 0)
    })

    it('closes foreign sessions without changing any order and flags them for review', async () => {
      const res = await send(buildEvent({ session: { id: 'cs_test_foreign', metadata: { order_id: ORDER_ID } } }))
      assert.equal(res.statusCode, 200)
      assert.equal(db.orders[0].status, 'pending')
      assert.equal(db.events.get('evt_1').review_reason, 'unknown_checkout_session')
    })

    it('drops an invalid customer email instead of failing', async () => {
      await send(buildEvent({ session: { customer_details: { email: 'not an email' } } }))
      assert.equal(db.orders[0].status, 'paid')
      assert.equal(db.orders[0].customer_email, null)
    })
  })

  describe('validation against stored order data', () => {
    for (const [name, session, reason] of [
      ['amount', { amount_total: 100 }, 'amount_mismatch'],
      ['currency', { currency: 'usd' }, 'currency_mismatch'],
      ['client_reference_id', { client_reference_id: '22222222-2222-4222-8222-222222222222' }, 'reference_mismatch'],
      ['missing client_reference_id', { client_reference_id: null }, 'reference_mismatch'],
    ]) {
      it(`leaves the order pending and flags it on ${name} mismatch`, async () => {
        const res = await send(buildEvent({ session }))
        assert.equal(res.statusCode, 200)
        assert.equal(db.orders[0].status, 'pending')
        assert.equal(db.orders[0].paid_at, null)
        assert.equal(db.drafts[0].status, 'draft')
        assert.equal(db.events.get('evt_1').review_reason, reason)
        assert.equal(db.events.get('evt_1').order_id, ORDER_ID)
      })
    }

    it('never marks an order without a stored snapshot as paid', async () => {
      db.orders[0].snapshot_key = null
      const res = await send(buildEvent())
      assert.equal(res.statusCode, 200)
      assert.equal(db.orders[0].status, 'pending')
      assert.equal(db.events.get('evt_1').review_reason, 'snapshot_missing')
    })

    it('keeps the snapshot reference of a paid order unchanged', async () => {
      const before = db.orders[0].snapshot_key
      await send(buildEvent())
      assert.equal(db.orders[0].status, 'paid')
      assert.equal(db.orders[0].snapshot_key, before)
    })

    it('reports every mismatch at once', async () => {
      await send(buildEvent({ session: { amount_total: 1, currency: 'usd' } }))
      assert.equal(db.events.get('evt_1').review_reason, 'amount_mismatch,currency_mismatch')
    })
  })

  describe('idempotency and failure handling', () => {
    it('processes a redelivered event only once', async () => {
      await send(buildEvent())
      const paidAt = db.orders[0].paid_at
      const writes = db.queries.length
      const res = await send(buildEvent())
      assert.equal(res.statusCode, 200)
      assert.equal(db.queries.length, writes + 1)
      assert.equal(db.orders[0].paid_at, paidAt)
    })

    it('does not reprocess an already paid order for a new event id and needs no review', async () => {
      db.orders[0] = pendingOrder({ status: 'paid', paid_at: new Date('2026-01-01') })
      const paidAt = db.orders[0].paid_at
      await send(buildEvent({ id: 'evt_2' }))
      assert.equal(db.orders[0].paid_at, paidAt)
      assert.equal(db.events.get('evt_2').review_reason, null)
    })

    it('flags a payment for a failed or refunded order and does not revive it', async () => {
      db.orders[0] = pendingOrder({ status: 'failed' })
      await send(buildEvent())
      assert.equal(db.orders[0].status, 'failed')
      assert.equal(db.events.get('evt_1').review_reason, 'order_failed')
    })

    it('returns 500 on a database failure, leaves no trace, and succeeds on redelivery', async () => {
      db.failNextWrite = true
      const failed = await send(buildEvent())
      assert.equal(failed.statusCode, 500)
      assert.equal(db.orders[0].status, 'pending')
      assert.equal(db.drafts[0].status, 'draft')
      assert.equal(db.events.size, 0)

      const retried = await send(buildEvent())
      assert.equal(retried.statusCode, 200)
      assert.equal(db.orders[0].status, 'paid')
    })

    it('does not leak details in error responses', async () => {
      db.failNextWrite = true
      const res = await send(buildEvent())
      assert.deepEqual(res.body, { error: 'Processing failed' })
    })
  })
})
