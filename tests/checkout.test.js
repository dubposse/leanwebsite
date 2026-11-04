import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { beforeEach, describe, it } from 'node:test'
import { createCheckoutHandler } from '../api/checkout.js'
import { getSiteUrl } from '../api/_lib/checkout.js'
import { packages } from '../api/_lib/packages.js'
import { defaultGenerators } from '../api/_lib/generators.js'
import { generateAccessToken } from '../api/_lib/tokens.js'
import { saveDraftContent } from '../api/_lib/drafts.js'
import { buildRequest, buildResponse, createFakeDb, createTestGenerators, htmlFor, createFakeStorage, createFakeStripe } from './helpers/fakes.js'

const DRAFT_ID = '33333333-3333-4333-8333-333333333333'
const OTHER_DRAFT_ID = '44444444-4444-4444-8444-444444444444'
const BUSINESS_DRAFT_ID = '55555555-5555-4555-8555-555555555555'
const OTHER_BUSINESS_DRAFT_ID = '66666666-6666-4666-8666-666666666666'
const SITE_URL = 'https://leanwebsite.example'
const DRAFT_KEY = `drafts/${DRAFT_ID}/content`
const CONTENT_V1 = Buffer.from('{"pages":["home"]}')
const CONTENT_V2 = Buffer.from('{"pages":["home","about"]}')
const HTML_V1 = htmlFor(['home'])
const HTML_V2 = htmlFor(['home', 'about'])
const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex')
const JSON_HEADERS = { 'content-type': 'application/json' }

describe('POST /api/checkout', () => {
  let db
  let stripe
  let storage
  let handler
  let token
  let otherToken

  const validBody = (overrides = {}) => ({
    builder: 'artist-band',
    package: 'artist-band-code-and-go',
    draftId: DRAFT_ID,
    draftToken: token,
    ...overrides,
  })

  const send = async (body, { headers = JSON_HEADERS, method = 'POST' } = {}) => {
    const res = buildResponse()
    await handler(buildRequest(body, { headers, method }), res)
    return res
  }

  const noWrites = () => {
    assert.equal(db.orders.length, 0)
    assert.equal(stripe.createCalls, 0)
  }

  const addBusinessDraft = (draftId, data) => {
    let builder = db.builders.find((item) => item.slug === 'business')
    if (!builder) {
      builder = { id: 'b2', slug: 'business', name: 'Business', active: true }
      db.builders.push(builder)
    }
    const access = generateAccessToken()
    const storageKey = `drafts/${draftId}/content`
    db.drafts.push({
      id: draftId,
      builder_id: builder.id,
      status: 'draft',
      access_token_hash: access.hash,
      storage_key: storageKey,
    })
    storage.objects.set(storageKey, {
      body: Buffer.from(JSON.stringify(data)),
      contentType: 'application/json',
    })
    return access.token
  }

  beforeEach(() => {
    db = createFakeDb()
    stripe = createFakeStripe()
    storage = createFakeStorage()
    storage.objects.set(DRAFT_KEY, { body: CONTENT_V1, contentType: 'application/json' })
    const first = generateAccessToken()
    const second = generateAccessToken()
    token = first.token
    otherToken = second.token
    db.drafts.push(
      { id: DRAFT_ID, builder_id: 'b1', status: 'draft', access_token_hash: first.hash, storage_key: DRAFT_KEY },
      { id: OTHER_DRAFT_ID, builder_id: 'b1', status: 'draft', access_token_hash: second.hash },
    )
    handler = createCheckoutHandler({
      getDb: () => db,
      getStripeClient: () => stripe,
      resolveSiteUrl: () => SITE_URL,
      storage,
      generators: createTestGenerators(),
    })
  })

  describe('valid requests', () => {
    it('creates a pending order and a Stripe session with server-side price and returns only the url', async () => {
      const res = await send(validBody())
      assert.equal(res.statusCode, 200)
      assert.deepEqual(Object.keys(res.body), ['url'])
      assert.match(res.body.url, /^https:\/\/checkout\.stripe\.com\//)
      assert.equal(res.headers['Cache-Control'], 'no-store')

      const [order] = db.orders
      assert.equal(db.orders.length, 1)
      assert.equal(order.status, 'pending')
      assert.equal(order.amount_cents, packages['artist-band-code-and-go'].amountCents)
      assert.equal(order.currency, 'EUR')
      assert.equal(order.draft_id, DRAFT_ID)
      assert.equal(order.stripe_checkout_session_id, 'cs_test_1')

      const { params, options } = stripe.sessions.get('cs_test_1')
      assert.equal(params.mode, 'payment')
      assert.equal(params.client_reference_id, order.id)
      assert.equal(params.line_items[0].price_data.currency, 'eur')
      assert.equal(params.line_items[0].price_data.unit_amount, 24900)
      assert.equal(params.line_items[0].quantity, 1)
      assert.equal('automatic_tax' in params, false)
      assert.equal(params.success_url, `${SITE_URL}/order/complete?checkout=success&builder=artist-band`)
      assert.equal(params.cancel_url, `${SITE_URL}/order/complete?checkout=cancelled&builder=artist-band`)
      assert.doesNotMatch(`${params.success_url}${params.cancel_url}`, /draftId|draftToken|33333333/)
      assert.match(options.idempotencyKey, new RegExp(order.id))
    })

    it('uses the configured price of the selected package', async () => {
      await send(validBody({ package: 'artist-band-rundum-sorglos' }))
      assert.equal(db.orders[0].amount_cents, 39900)
      assert.equal(stripe.sessions.get('cs_test_1').params.line_items[0].price_data.unit_amount, 39900)
    })

    it('does not mark anything as paid or lock the draft', async () => {
      await send(validBody())
      assert.equal(db.orders[0].status, 'pending')
      assert.equal(db.drafts[0].status, 'draft')
    })
  })

  describe('Business checkout', () => {
    const validBusinessData = {
      company: { name: 'Musterbetrieb' },
      contact: { email: 'hallo@example.de' },
    }

    beforeEach(() => {
      handler = createCheckoutHandler({
        getDb: () => db,
        getStripeClient: () => stripe,
        resolveSiteUrl: () => SITE_URL,
        storage,
        generators: defaultGenerators,
      })
    })

    it('uses the shared Business package definitions for both offers', async () => {
      const entries = [
        ['business-pure-code', BUSINESS_DRAFT_ID],
        ['business-rundum-sorglos', OTHER_BUSINESS_DRAFT_ID],
      ]

      for (const [packageCode, draftId] of entries) {
        const draftToken = addBusinessDraft(draftId, validBusinessData)
        const res = await send({
          builder: 'business',
          package: packageCode,
          draftId,
          draftToken,
        })

        assert.equal(res.statusCode, 200)
        const pkg = packages[packageCode]
        const order = db.orders.find((item) => item.draft_id === draftId)
        assert.equal(pkg.builderSlug, 'business')
        assert.equal(order.package_code, pkg.code)
        assert.equal(order.amount_cents, pkg.amountCents)
        const params = stripe.sessions.get(order.stripe_checkout_session_id).params
        assert.equal(params.line_items[0].price_data.unit_amount, pkg.amountCents)
        assert.equal(params.success_url, `${SITE_URL}/order/complete?checkout=success&builder=business`)
        assert.equal(params.cancel_url, `${SITE_URL}/order/complete?checkout=cancelled&builder=business`)
        assert.doesNotMatch(`${params.success_url}${params.cancel_url}`, new RegExp(draftToken))
        assert.doesNotMatch(`${params.success_url}${params.cancel_url}`, new RegExp(draftId))
      }
    })

    it('rejects missing company name or contact email before creating an order or Stripe session', async () => {
      const invalidDrafts = [
        { id: BUSINESS_DRAFT_ID, data: { company: { name: '   ' }, contact: { email: 'hallo@example.de' } }, message: 'Business company name is required' },
        { id: OTHER_BUSINESS_DRAFT_ID, data: { company: { name: 'Musterbetrieb' }, contact: { email: '' } }, message: 'Business contact email is required' },
      ]

      for (const item of invalidDrafts) {
        const draftToken = addBusinessDraft(item.id, item.data)
        const res = await send({
          builder: 'business',
          package: 'business-pure-code',
          draftId: item.id,
          draftToken,
        })
        assert.equal(res.statusCode, 422)
        assert.equal(res.body.error, item.message)
      }
      noWrites()
    })

    it('rejects an invalid stored contact email without creating an order or Stripe session', async () => {
      const draftToken = addBusinessDraft(BUSINESS_DRAFT_ID, {
        company: { name: 'Musterbetrieb' },
        contact: { email: 'not-an-email' },
      })
      const res = await send({
        builder: 'business',
        package: 'business-pure-code',
        draftId: BUSINESS_DRAFT_ID,
        draftToken,
      })

      assert.equal(res.statusCode, 409)
      noWrites()
    })
  })

  describe('input validation', () => {
    for (const [name, overrides] of [
      ['a client-supplied amount', { amount: 1 }],
      ['a client-supplied price field', { amountCents: 1 }],
      ['an unknown package', { package: 'does-not-exist' }],
      ['a prototype key as package', { package: '__proto__' }],
      ['a malformed builder', { builder: 'Artist Band!' }],
      ['a non-string package', { package: 5 }],
      ['an invalid draft id', { draftId: 'not-a-uuid' }],
      ['a malformed token', { draftToken: 'short' }],
      ['a missing token', { draftToken: undefined }],
    ]) {
      it(`rejects ${name} with 400 and writes nothing`, async () => {
        const res = await send(validBody(overrides))
        assert.equal(res.statusCode, 400)
        noWrites()
      })
    }

    it('rejects a package that belongs to another builder', async () => {
      const res = await send(validBody({ package: 'business-pure-code' }))
      assert.equal(res.statusCode, 400)
      noWrites()
    })

    it('rejects a builder that does not match the draft', async () => {
      const res = await send(validBody({ builder: 'business', package: 'business-pure-code' }))
      assert.equal(res.statusCode, 400)
      noWrites()
    })

    it('rejects invalid JSON, arrays and non-JSON content types', async () => {
      assert.equal((await send('{not json')).statusCode, 400)
      assert.equal((await send([])).statusCode, 400)
      assert.equal((await send(validBody(), { headers: { 'content-type': 'text/plain' } })).statusCode, 415)
      noWrites()
    })

    it('rejects oversized bodies with 413', async () => {
      const res = await send({ ...validBody(), padding: 'x'.repeat(8000) })
      assert.equal(res.statusCode, 413)
      noWrites()
    })

    it('rejects non-POST methods with 405', async () => {
      const res = await send(validBody(), { method: 'GET' })
      assert.equal(res.statusCode, 405)
      assert.equal(res.headers.Allow, 'POST')
    })
  })

  describe('authorization', () => {
    it('answers 404 for a wrong token', async () => {
      const res = await send(validBody({ draftToken: otherToken }))
      assert.equal(res.statusCode, 404)
      noWrites()
    })

    it('answers the same 404 for an unknown draft', async () => {
      const unknown = await send(validBody({ draftId: '55555555-5555-4555-8555-555555555555' }))
      const wrongToken = await send(validBody({ draftToken: otherToken }))
      assert.equal(unknown.statusCode, 404)
      assert.deepEqual(unknown.body, wrongToken.body)
      noWrites()
    })

    it("does not let the token of one draft buy another draft", async () => {
      const res = await send(validBody({ draftId: OTHER_DRAFT_ID }))
      assert.equal(res.statusCode, 404)
      noWrites()
    })

    it('rejects drafts without a stored token hash', async () => {
      db.drafts[0].access_token_hash = null
      assert.equal((await send(validBody())).statusCode, 404)
      noWrites()
    })

    it('rejects locked drafts', async () => {
      db.drafts[0].status = 'locked'
      assert.equal((await send(validBody())).statusCode, 409)
      noWrites()
    })

    it('rejects inactive builders', async () => {
      db.builders[0].active = false
      assert.equal((await send(validBody())).statusCode, 409)
      noWrites()
    })

    it('rejects a draft that already has a paid order', async () => {
      await send(validBody())
      db.orders[0].status = 'paid'
      db.orders[0].paid_at = new Date()
      const res = await send(validBody())
      assert.equal(res.statusCode, 409)
      assert.equal(db.orders.length, 1)
    })
  })

  describe('idempotency and reliability', () => {
    it('returns the same checkout for repeated requests without a second order', async () => {
      const first = await send(validBody())
      const second = await send(validBody())
      assert.equal(second.statusCode, 200)
      assert.equal(second.body.url, first.body.url)
      assert.equal(db.orders.length, 1)
      assert.equal(stripe.sessions.size, 1)
    })

    it('creates only one order and session for concurrent requests', async () => {
      const [a, b, c] = await Promise.all([send(validBody()), send(validBody()), send(validBody())])
      assert.deepEqual([a.statusCode, b.statusCode, c.statusCode], [200, 200, 200])
      assert.equal(a.body.url, b.body.url)
      assert.equal(a.body.url, c.body.url)
      assert.equal(db.orders.filter((o) => o.status === 'pending').length, 1)
      assert.equal(stripe.sessions.size, 1)
    })

    it('does not expose a checkout session if the draft is locked before session attachment', async () => {
      const createSession = stripe.checkout.sessions.create
      stripe.checkout.sessions.create = async (...args) => {
        const session = await createSession(...args)
        db.drafts[0].status = 'locked'
        return session
      }

      const res = await send(validBody())

      assert.equal(res.statusCode, 409)
      assert.equal(db.orders[0].status, 'failed')
      assert.equal(db.orders[0].stripe_checkout_session_id, null)
      assert.equal(stripe.sessions.get('cs_test_1').status, 'expired')
    })

    it('answers 502 when Stripe fails and reuses the same order on retry', async () => {
      stripe.failCreate = true
      const failed = await send(validBody())
      assert.equal(failed.statusCode, 502)
      assert.deepEqual(failed.body, { error: 'Payment provider unavailable' })
      assert.equal(db.orders.length, 1)
      assert.equal(db.orders[0].stripe_checkout_session_id, null)

      stripe.failCreate = false
      const retried = await send(validBody())
      assert.equal(retried.statusCode, 200)
      assert.equal(db.orders.length, 1)
      assert.equal(db.orders[0].stripe_checkout_session_id, 'cs_test_1')
    })

    it('replaces an abandoned (expired) checkout with a new order', async () => {
      const first = await send(validBody())
      stripe.sessions.get('cs_test_1').status = 'expired'

      const second = await send(validBody())
      assert.equal(second.statusCode, 200)
      assert.notEqual(second.body.url, first.body.url)
      assert.deepEqual(db.orders.map((o) => o.status), ['failed', 'pending'])
    })

    it('expires the old session and retires the old order when the package changes', async () => {
      await send(validBody())
      const second = await send(validBody({ package: 'artist-band-rundum-sorglos' }))
      assert.equal(second.statusCode, 200)
      assert.equal(stripe.sessions.get('cs_test_1').status, 'expired')
      assert.deepEqual(db.orders.map((o) => o.status), ['failed', 'pending'])
      assert.equal(db.orders[1].amount_cents, 39900)
    })

    it('keeps the order untouched when the old session cannot be expired', async () => {
      await send(validBody())
      stripe.failExpire = true
      const res = await send(validBody({ package: 'artist-band-rundum-sorglos' }))
      assert.equal(res.statusCode, 409)
      assert.equal(db.orders.length, 1)
      assert.equal(db.orders[0].status, 'pending')
    })

    it('never retires an order whose session is already complete', async () => {
      await send(validBody())
      stripe.sessions.get('cs_test_1').status = 'complete'
      const res = await send(validBody())
      assert.equal(res.statusCode, 409)
      assert.equal(db.orders.length, 1)
      assert.equal(db.orders[0].status, 'pending')
    })

    it('answers 500 without details on a database failure', async () => {
      db.failNextWrite = true
      const res = await send(validBody())
      assert.equal(res.statusCode, 500)
      assert.deepEqual(res.body, { error: 'Checkout failed' })
    })
  })

  describe('order snapshot', () => {
    const snapshotKeyOf = (order) => `orders/${order.id}/snapshot`

    it('stores the snapshot in R2 and references it from the order before the session exists', async () => {
      const res = await send(validBody())
      assert.equal(res.statusCode, 200)

      const [order] = db.orders
      assert.equal(order.snapshot_key, snapshotKeyOf(order))
      assert.equal(order.snapshot_sha256, sha256(HTML_V1))
      assert.equal(order.snapshot_size, HTML_V1.byteLength)
      assert.equal(order.snapshot_content_type, 'text/html')
      assert.deepEqual(storage.objects.get(order.snapshot_key).body, HTML_V1)
    })

    it('creates no payable session when the snapshot cannot be stored', async () => {
      storage.failPut = true
      const res = await send(validBody())
      assert.equal(res.statusCode, 502)
      assert.equal(stripe.createCalls, 0)
      assert.equal(db.orders[0].snapshot_key, null)
      assert.equal(db.orders[0].stripe_checkout_session_id, null)
    })

    it('recovers after a storage failure with the same order', async () => {
      storage.failPut = true
      await send(validBody())
      storage.failPut = false
      const res = await send(validBody())
      assert.equal(res.statusCode, 200)
      assert.equal(db.orders.length, 1)
      assert.equal(db.orders[0].snapshot_sha256, sha256(HTML_V1))
    })

    it('creates no session when the snapshot reference cannot be saved in the database', async () => {
      const original = db.query
      db.query = async (text, params) => {
        if (text.includes('SET snapshot_key')) throw new Error('simulated database failure')
        return original(text, params)
      }
      const res = await send(validBody())
      assert.equal(res.statusCode, 500)
      assert.equal(stripe.createCalls, 0)
      db.query = original
      assert.equal((await send(validBody())).statusCode, 200)
      assert.equal(db.orders.length, 1)
    })

    it('rejects drafts without saved content or with a foreign storage key', async () => {
      db.drafts[0].storage_key = null
      assert.equal((await send(validBody())).statusCode, 409)
      db.drafts[0].storage_key = `drafts/${OTHER_DRAFT_ID}/content`
      assert.equal((await send(validBody())).statusCode, 409)
      db.drafts[0].storage_key = DRAFT_KEY
      storage.objects.delete(DRAFT_KEY)
      assert.equal((await send(validBody())).statusCode, 409)
      noWrites()
    })

    it('answers 502 when the draft content cannot be read', async () => {
      storage.failGet = true
      assert.equal((await send(validBody())).statusCode, 502)
      noWrites()
    })

    it('keeps the snapshot unchanged when the draft is edited after checkout started', async () => {
      await send(validBody())
      const [order] = db.orders
      storage.objects.set(DRAFT_KEY, { body: CONTENT_V2, contentType: 'application/json' })

      assert.deepEqual(storage.objects.get(snapshotKeyOf(order)).body, HTML_V1)
      assert.equal(order.snapshot_sha256, sha256(HTML_V1))
    })

    it('never reuses an open session for outdated content: a new order gets a new snapshot', async () => {
      const first = await send(validBody())
      storage.objects.set(DRAFT_KEY, { body: CONTENT_V2, contentType: 'application/json' })

      const second = await send(validBody())
      assert.equal(second.statusCode, 200)
      assert.notEqual(second.body.url, first.body.url)
      assert.equal(stripe.sessions.get('cs_test_1').status, 'expired')
      assert.deepEqual(db.orders.map((o) => o.status), ['failed', 'pending'])
      assert.equal(db.orders[1].snapshot_sha256, sha256(HTML_V2))
      // The retired order keeps its own snapshot.
      assert.deepEqual(storage.objects.get(snapshotKeyOf(db.orders[0])).body, HTML_V1)
      assert.deepEqual(storage.objects.get(snapshotKeyOf(db.orders[1])).body, HTML_V2)
    })

    it('does not overwrite an existing snapshot object and binds the order to what is stored', async () => {
      const result = await send(validBody())
      assert.equal(result.statusCode, 200)
      const [order] = db.orders

      await assert.rejects(
        storage.putObject(snapshotKeyOf(order), HTML_V2, { overwrite: false }),
        (error) => error.code === 'OBJECT_EXISTS',
      )
      assert.deepEqual(storage.objects.get(snapshotKeyOf(order)).body, HTML_V1)
    })

    it('uses the first stored snapshot when a concurrent writer already wrote the object', async () => {
      const preparedId = '66666666-6666-4666-8666-666666666666'
      // Simulates a crash after the R2 write but before the database reference: the order exists without snapshot.
      db.orders.push({
        id: preparedId,
        draft_id: DRAFT_ID,
        package_code: 'artist-band-code-and-go',
        amount_cents: 24900,
        currency: 'EUR',
        status: 'pending',
        stripe_checkout_session_id: null,
        snapshot_key: null,
        snapshot_sha256: null,
        snapshot_size: null,
        snapshot_content_type: null,
        paid_at: null,
      })
      storage.objects.set(snapshotKeyOf({ id: preparedId }), { body: HTML_V2, contentType: 'application/json' })

      const res = await send(validBody())
      assert.equal(res.statusCode, 200)
      // The existing object differs from the current draft, so the order is retired and replaced.
      assert.equal(db.orders[0].status, 'failed')
      assert.equal(db.orders[0].snapshot_sha256, sha256(HTML_V2))
      assert.equal(db.orders[1].snapshot_sha256, sha256(HTML_V1))
      assert.equal(db.orders.length, 2)
    })

    it('creates exactly one snapshot and session for concurrent requests', async () => {
      const results = await Promise.all([send(validBody()), send(validBody()), send(validBody())])
      assert.deepEqual(results.map((r) => r.statusCode), [200, 200, 200])
      assert.equal(new Set(results.map((r) => r.body.url)).size, 1)
      assert.equal(db.orders.length, 1)
      assert.equal(stripe.sessions.size, 1)
      assert.equal([...storage.objects.keys()].filter((k) => k.startsWith('orders/')).length, 1)
    })

    it('recovers when the database save fails after the Stripe session was created', async () => {
      const original = db.query
      db.query = async (text, params) => {
        if (text.includes('SET stripe_checkout_session_id')) throw new Error('simulated database failure')
        return original(text, params)
      }
      assert.equal((await send(validBody())).statusCode, 500)
      assert.equal(stripe.sessions.size, 1)
      assert.equal(db.orders[0].stripe_checkout_session_id, null)

      db.query = original
      const retry = await send(validBody())
      assert.equal(retry.statusCode, 200)
      // The deterministic idempotency key returns the same session; no second payable session exists.
      assert.equal(stripe.sessions.size, 1)
      assert.equal(db.orders[0].stripe_checkout_session_id, 'cs_test_1')
    })

    it('never exposes storage keys or snapshot details in the response', async () => {
      const res = await send(validBody())
      assert.deepEqual(Object.keys(res.body), ['url'])
    })
  })

  describe('draft content interface', () => {
    const save = (overrides = {}) =>
      saveDraftContent({
        sql: db,
        put: storage.putObject,
        draftId: DRAFT_ID,
        draftToken: token,
        body: CONTENT_V2,
        contentType: 'application/json',
        ...overrides,
      })

    it('stores content under a server-generated key and records it on the draft', async () => {
      db.drafts[0].storage_key = null
      const { key } = await save()
      assert.match(key, new RegExp(`^drafts/${DRAFT_ID}/content-[0-9a-f-]{36}$`))
      assert.equal(db.drafts[0].storage_key, key)
      assert.deepEqual(storage.objects.get(key).body, CONTENT_V2)
    })

    it('requires the draft token', async () => {
      await assert.rejects(save({ draftToken: otherToken }), { statusCode: 404 })
      assert.equal(storage.putCalls, 0)
    })

    it('rejects locked drafts, empty bodies and unsupported content types', async () => {
      await assert.rejects(save({ body: Buffer.alloc(0) }), { statusCode: 400 })
      await assert.rejects(save({ contentType: 'text/html' }), { statusCode: 415 })
      db.drafts[0].status = 'locked'
      await assert.rejects(save(), { statusCode: 409 })
      assert.equal(storage.putCalls, 0)
    })

    it('does not replace published content when locking wins during an R2 write', async () => {
      db.drafts[0].storage_key = null
      let markWritten
      let finishWrite
      const written = new Promise((resolve) => {
        markWritten = resolve
      })
      const writeGate = new Promise((resolve) => {
        finishWrite = resolve
      })
      const put = async (key, body, options) => {
        await storage.putObject(key, body, options)
        markWritten()
        await writeGate
      }

      const pending = save({ put })
      await written
      db.drafts[0].status = 'locked'
      finishWrite()

      await assert.rejects(pending, { statusCode: 409 })
      assert.equal(db.drafts[0].storage_key, null)
      assert.equal([...storage.objects.keys()].filter((key) => key.startsWith(`drafts/${DRAFT_ID}/content-`)).length, 1)
    })

    it('isolates parallel saves in immutable objects and publishes a complete version', async () => {
      const firstBody = Buffer.from('{"version":1}')
      const secondBody = Buffer.from('{"version":2}')
      const [first, second] = await Promise.all([save({ body: firstBody }), save({ body: secondBody })])
      const current = storage.objects.get(db.drafts[0].storage_key).body

      assert.notEqual(first.key, second.key)
      assert.ok(current.equals(firstBody) || current.equals(secondBody))
      assert.deepEqual(storage.objects.get(first.key).body, firstBody)
      assert.deepEqual(storage.objects.get(second.key).body, secondBody)
    })
  })

  describe('configuration', () => {
    it('answers 500 without secrets when checkout is not configured', async () => {
      handler = createCheckoutHandler({
        getDb: () => db,
        getStripeClient: () => {
          throw new Error('Missing environment variable: STRIPE_SECRET_KEY sk_live_secret')
        },
        resolveSiteUrl: () => SITE_URL,
      })
      const res = await send(validBody())
      assert.equal(res.statusCode, 500)
      assert.equal(JSON.stringify(res.body).includes('sk_live'), false)
      noWrites()
    })

    it('derives the site url from configuration only and requires https', () => {
      assert.equal(getSiteUrl({ SITE_URL: 'https://leanwebsite.matthiasbrehm.de/' }), 'https://leanwebsite.matthiasbrehm.de')
      assert.equal(getSiteUrl({ SITE_URL: 'http://localhost:3000' }), 'http://localhost:3000')
      assert.throws(() => getSiteUrl({}), /SITE_URL/)
      assert.throws(() => getSiteUrl({ SITE_URL: 'http://example.com' }), /https/)
      assert.throws(() => getSiteUrl({ SITE_URL: 'not a url' }), /valid URL/)
    })
  })
})
