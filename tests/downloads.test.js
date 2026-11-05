import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { beforeEach, describe, it } from 'node:test'
import { createOrderDownloadHandler } from '../api/orders/download.js'
import { createOrderStatusHandler } from '../api/orders/status.js'
import { processStripeEvent } from '../api/_lib/stripe-events.js'
import { generateAccessToken } from '../api/_lib/tokens.js'
import { buildRequest, buildResponse, createFakeDb, createFakeStorage } from './helpers/fakes.js'

const DRAFT_ID = '33333333-3333-4333-8333-333333333333'
const OTHER_DRAFT_ID = '44444444-4444-4444-8444-444444444444'
const ORDER_ID = '11111111-1111-4111-8111-111111111111'
const OTHER_ORDER_ID = '22222222-2222-4222-8222-222222222222'
const BUSINESS_DRAFT_ID = '55555555-5555-4555-8555-555555555555'
const BUSINESS_ORDER_ID = '77777777-7777-4777-8777-777777777777'
const SESSION_ID = 'cs_test_dl'
const HTML = Buffer.from('<!doctype html><title>Meine Band</title>')
const JSON_HEADERS = { 'content-type': 'application/json' }
const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex')

const paidEvent = (id = 'evt_1') => ({
  id,
  type: 'checkout.session.completed',
  data: { object: { id: SESSION_ID, payment_status: 'paid', amount_total: 3900, currency: 'eur', client_reference_id: ORDER_ID } },
})

function orderRow(id, draftId, overrides = {}) {
  return {
    id,
    draft_id: draftId,
    package_code: 'artist-band-code-and-go',
    amount_cents: 3900,
    currency: 'EUR',
    status: 'pending',
    stripe_checkout_session_id: SESSION_ID,
    stripe_payment_intent_id: null,
    customer_email: null,
    paid_at: null,
    snapshot_key: `orders/${id}/snapshot`,
    snapshot_sha256: sha256(HTML),
    snapshot_size: HTML.byteLength,
    snapshot_content_type: 'text/html',
    ...overrides,
  }
}

describe('protected order download', () => {
  let db
  let storage
  let token
  let otherToken
  let download
  let status

  const call = async (handler, body, { headers = JSON_HEADERS, method = 'POST' } = {}) => {
    const res = buildResponse()
    await handler(buildRequest(body, { headers, method }), res)
    return res
  }
  const creds = (overrides = {}) => ({ draftId: DRAFT_ID, draftToken: token, ...overrides })
  const markPaid = () => processStripeEvent(paidEvent(), db)

  beforeEach(() => {
    db = createFakeDb()
    storage = createFakeStorage()
    const first = generateAccessToken()
    const second = generateAccessToken()
    token = first.token
    otherToken = second.token
    db.drafts.push(
      { id: DRAFT_ID, builder_id: 'b1', status: 'draft', access_token_hash: first.hash },
      { id: OTHER_DRAFT_ID, builder_id: 'b1', status: 'draft', access_token_hash: second.hash },
    )
    db.orders.push(orderRow(ORDER_ID, DRAFT_ID))
    storage.objects.set(`orders/${ORDER_ID}/snapshot`, { body: HTML, contentType: 'text/html' })
    download = createOrderDownloadHandler({ getDb: () => db, storage })
    status = createOrderStatusHandler({ getDb: () => db })
  })

  it('refuses an unpaid order and reports it as pending', async () => {
    const res = await call(download, creds())
    assert.equal(res.statusCode, 402)
    assert.equal(res.body.code, 'not_paid')
    assert.equal((await call(status, creds())).body.downloadAvailable, false)
  })

  it('serves the verified snapshot with safe headers for a paid order', async () => {
    await markPaid()
    const res = await call(download, creds())
    assert.equal(res.statusCode, 200)
    assert.deepEqual(res.body, HTML)
    assert.match(res.headers['Content-Disposition'], /^attachment; filename="website\.html"$/)
    assert.equal(res.headers['Content-Type'], 'text/html; charset=utf-8')
    assert.equal(res.headers['X-Content-Type-Options'], 'nosniff')
    assert.equal(res.headers['Cache-Control'], 'no-store')
    assert.match(res.headers['Content-Security-Policy'], /sandbox/)
  })

  it('rejects wrong, missing and malformed credentials without revealing anything', async () => {
    await markPaid()
    for (const body of [creds({ draftToken: otherToken }), { draftId: DRAFT_ID }, { draftToken: token }, creds({ draftToken: 'x' }), {}, creds({ draftId: 'nope' })]) {
      const res = await call(download, body)
      assert.equal(res.statusCode, 404)
      assert.ok(!Buffer.isBuffer(res.body))
    }
  })

  it('does not release a foreign order and ignores a manipulated order id', async () => {
    db.orders.push(orderRow(OTHER_ORDER_ID, OTHER_DRAFT_ID, { stripe_checkout_session_id: 'cs_other' }))
    await markPaid()
    // The other customer's token never opens this draft's order and an orderId in the body is ignored.
    assert.equal((await call(download, creds({ draftToken: otherToken }))).statusCode, 404)
    const res = await call(download, { ...creds(), orderId: OTHER_ORDER_ID, snapshotKey: `orders/${OTHER_ORDER_ID}/snapshot` })
    assert.equal(res.statusCode, 200)
    assert.deepEqual(res.body, HTML)
    // The foreign draft's own order is still unpaid.
    const own = await call(download, { draftId: OTHER_DRAFT_ID, draftToken: otherToken })
    assert.equal(own.statusCode, 402)
  })

  it('fails controlled when the snapshot is missing in R2', async () => {
    await markPaid()
    storage.objects.clear()
    const res = await call(download, creds())
    assert.equal(res.statusCode, 409)
    assert.equal(res.body.code, 'snapshot_unavailable')
  })

  it('refuses a manipulated snapshot, a wrong checksum and a wrong size', async () => {
    await markPaid()
    storage.objects.set(`orders/${ORDER_ID}/snapshot`, { body: Buffer.from('<script>evil()</script>'), contentType: 'text/html' })
    assert.equal((await call(download, creds())).body.code, 'snapshot_corrupt')

    storage.objects.set(`orders/${ORDER_ID}/snapshot`, { body: HTML, contentType: 'text/html' })
    db.orders[0].snapshot_sha256 = 'a'.repeat(64)
    assert.equal((await call(download, creds())).body.code, 'snapshot_corrupt')

    db.orders[0].snapshot_sha256 = sha256(HTML)
    db.orders[0].snapshot_size += 1
    assert.equal((await call(download, creds())).body.code, 'snapshot_corrupt')
  })

  it('never reads a storage key other than the one derived from the order id', async () => {
    await markPaid()
    db.orders[0].snapshot_key = `orders/${OTHER_ORDER_ID}/snapshot`
    storage.objects.set(`orders/${OTHER_ORDER_ID}/snapshot`, { body: HTML, contentType: 'text/html' })
    const res = await call(download, creds())
    assert.equal(res.statusCode, 409)
  })

  it('does not release twice-delivered webhooks twice and keeps serving', async () => {
    assert.equal((await markPaid()).outcome, 'paid')
    const paidAt = db.orders[0].paid_at
    assert.equal((await markPaid()).outcome, 'duplicate')
    assert.equal((await processStripeEvent(paidEvent('evt_2'), db)).outcome, 'not_pending')
    assert.equal(db.orders[0].paid_at, paidAt)
    assert.equal((await call(download, creds())).statusCode, 200)
  })

  it('waits for a delayed webhook and releases afterwards, also after a reload', async () => {
    const before = await call(status, creds())
    assert.equal(before.body.status, 'pending')
    assert.equal(before.body.downloadAvailable, false)
    assert.equal((await call(download, creds())).statusCode, 402)

    await markPaid()

    // A reload only repeats the same request with the locally stored credentials.
    for (let i = 0; i < 2; i += 1) {
      const after = await call(status, creds())
      assert.equal(after.body.status, 'paid')
      assert.equal(after.body.downloadAvailable, true)
      assert.equal((await call(download, creds())).statusCode, 200)
    }
  })

  it('uses the same paid-status and protected download flow for Business', async () => {
    const businessAccess = generateAccessToken()
    db.builders.push({ id: 'b2', slug: 'business', name: 'Business', active: true })
    db.drafts.push({
      id: BUSINESS_DRAFT_ID,
      builder_id: 'b2',
      status: 'draft',
      access_token_hash: businessAccess.hash,
    })
    const businessSnapshotKey = `orders/${BUSINESS_ORDER_ID}/snapshot`
    db.orders.push(orderRow(BUSINESS_ORDER_ID, BUSINESS_DRAFT_ID, {
      package_code: 'business-pure-code',
      amount_cents: 29900,
      snapshot_key: businessSnapshotKey,
      status: 'pending',
    }))
    storage.objects.set(businessSnapshotKey, { body: HTML, contentType: 'text/html' })
    const businessCredentials = { draftId: BUSINESS_DRAFT_ID, draftToken: businessAccess.token }

    const pending = await call(status, businessCredentials)
    assert.equal(pending.body.status, 'pending')
    assert.equal(pending.body.downloadAvailable, false)
    assert.equal((await call(download, businessCredentials)).statusCode, 402)

    db.orders.at(-1).status = 'paid'
    db.orders.at(-1).paid_at = new Date()
    const paid = await call(status, businessCredentials)
    assert.equal(paid.body.status, 'paid')
    assert.equal(paid.body.downloadAvailable, true)
    assert.equal(paid.body.package.name, 'Pure Code')

    const file = await call(download, businessCredentials)
    assert.equal(file.statusCode, 200)
    assert.equal(file.headers['Content-Disposition'], 'attachment; filename="website.html"')
    assert.deepEqual(file.body, HTML)
    assert.equal((await call(download, { ...businessCredentials, draftToken: otherToken })).statusCode, 404)
  })

  it('status exposes no keys, hashes or tokens and describes the package', async () => {
    await markPaid()
    const { body } = await call(status, creds())
    assert.equal(body.package.name, 'Code & Go')
    assert.doesNotMatch(JSON.stringify(body), /snapshot|sha256|orders\/|token/i)

    db.orders[0].package_code = 'artist-band-rundum-sorglos'
    assert.match((await call(status, creds())).body.package.notice, /Hosting und Betreuung/)
  })

  it('reports failed and unknown orders without a download', async () => {
    db.orders[0].status = 'failed'
    const failed = await call(status, creds())
    assert.equal(failed.body.downloadAvailable, false)
    assert.equal((await call(download, creds())).statusCode, 402)

    db.orders.length = 0
    assert.equal((await call(status, creds())).body.status, 'none')
    assert.equal((await call(download, creds())).statusCode, 404)
  })

  it('accepts only POST with JSON and never puts credentials into the response', async () => {
    assert.equal((await call(download, creds(), { method: 'GET' })).statusCode, 405)
    assert.equal((await call(status, creds(), { headers: {} })).statusCode, 415)
    assert.doesNotMatch(JSON.stringify((await call(download, creds({ draftToken: otherToken }))).body), new RegExp(token))
  })
})
