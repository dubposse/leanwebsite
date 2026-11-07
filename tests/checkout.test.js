import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { beforeEach, describe, it } from 'node:test'
import { createCheckoutHandler } from '../api/checkout.js'
import { getSiteUrl } from '../api/_lib/checkout.js'
import { packages } from '../api/_lib/packages.js'
import { defaultGenerators } from '../api/_lib/generators.js'
import { generateAccessToken } from '../api/_lib/tokens.js'
import { saveDraftContent } from '../api/_lib/drafts.js'
import { HOSTINGER_CONSENT_VERSION } from '../api/_lib/fulfillment.js'
import { PACKAGE_COPY } from '../shared/builder-copy.js'
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
const fulfillmentData = (overrides = {}) => ({
  firstName: 'Ada',
  lastName: 'Lovelace',
  billingStreet: '1 Musterstraße',
  billingPostalCode: '10115',
  billingCity: 'Berlin',
  billingCountryCode: 'DE',
  communicationEmail: 'ada@example.de',
  desiredDomain: 'ada-example.de',
  alternativeDomain: null,
  domainHolderDiffers: false,
  hostingerConsent: true,
  ...overrides,
})
const businessFulfillmentData = (overrides = {}) => ({
  customerType: 'company',
  companyName: 'Musterbetrieb GmbH',
  firstName: 'Ada',
  lastName: 'Lovelace',
  billingStreet: '1 Musterstraße',
  billingPostalCode: '10115',
  billingCity: 'Berlin',
  billingCountryCode: 'DE',
  communicationEmail: 'ada@example.de',
  desiredDomain: 'musterbetrieb.de',
  alternativeDomain: null,
  domainHolderDiffers: false,
  hostingerConsent: true,
  ...overrides,
})

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
      assert.equal(params.customer_creation, 'always')
      assert.deepEqual(params.name_collection, {
        individual: { enabled: true, optional: false },
        business: { enabled: true, optional: true },
      })
      assert.equal(params.submit_type, 'pay')
      assert.equal(params.client_reference_id, order.id)
      assert.equal(params.line_items[0].price_data.currency, 'eur')
      assert.equal(params.line_items[0].price_data.unit_amount, 3900)
      assert.equal(params.line_items[0].quantity, 1)
      assert.equal(params.line_items[0].price_data.product_data.name, 'Artist & Band – Code & Go')
      assert.equal(params.line_items[0].price_data.product_data.description, 'Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.')
      assert.equal('automatic_tax' in params, false)
      assert.equal(params.success_url, `${SITE_URL}/order/complete?checkout=success&builder=artist-band`)
      assert.equal(params.cancel_url, `${SITE_URL}/order/complete?checkout=cancelled&builder=artist-band`)
      assert.doesNotMatch(`${params.success_url}${params.cancel_url}`, /draftId|draftToken|33333333/)
      assert.match(options.idempotencyKey, new RegExp(order.id))
    })

    it('uses the configured price of the selected package', async () => {
      await send(validBody({
        package: 'artist-band-rundum-sorglos',
        fulfillmentData: fulfillmentData(),
      }))
      assert.equal(db.orders[0].amount_cents, 7900)
      const product = stripe.sessions.get('cs_test_1').params.line_items[0]
      assert.equal(product.price_data.unit_amount, 7900)
      assert.equal(product.price_data.product_data.name, 'Artist & Band – Rundum Sorglos')
    })

    it('does not mark anything as paid or lock the draft', async () => {
      await send(validBody())
      assert.equal(db.orders[0].status, 'pending')
      assert.equal(db.drafts[0].status, 'draft')
    })
  })

  describe('Rundum-Sorglos fulfillment', () => {
    const rundumBody = (overrides = {}) => validBody({
      package: 'artist-band-rundum-sorglos',
      fulfillmentData: fulfillmentData(),
      ...overrides,
    })

    it('stores authorized fulfillment data before creating a Stripe session', async () => {
      const createSession = stripe.checkout.sessions.create
      stripe.checkout.sessions.create = async (...args) => {
        assert.equal(db.fulfillments.size, 1)
        const [orderId, saved] = [...db.fulfillments.entries()][0]
        assert.equal(orderId, db.orders[0].id)
        assert.equal(saved.communication_email, 'ada@example.de')
        assert.equal(saved.hostinger_consent_version, HOSTINGER_CONSENT_VERSION)
        assert.ok(saved.hostinger_consented_at instanceof Date)
        assert.equal(saved.fulfillment_status, 'pending')
        return createSession(...args)
      }

      const res = await send(rundumBody())

      assert.equal(res.statusCode, 200)
      assert.equal(db.orders.length, 1)
      assert.equal(db.fulfillments.size, 1)
      assert.deepEqual(stripe.sessions.get('cs_test_1').params.metadata, { order_id: db.orders[0].id })
      assert.doesNotMatch(JSON.stringify(stripe.sessions.get('cs_test_1').params), /Ada|Lovelace|ada@example|ada-example/)
    })

    it('rejects missing or invalid fulfillment data without creating an order or session', async () => {
      const missing = await send(validBody({ package: 'artist-band-rundum-sorglos' }))
      const invalid = await send(rundumBody({
        fulfillmentData: fulfillmentData({ desiredDomain: 'invalid.com' }),
      }))
      assert.equal(missing.statusCode, 400)
      assert.equal(invalid.statusCode, 400)
      assert.equal(db.orders.length, 0)
      assert.equal(db.fulfillments.size, 0)
      assert.equal(stripe.createCalls, 0)
    })

    it('does not save data or start checkout with invalid draft authorization', async () => {
      const wrongToken = await send(rundumBody({ draftToken: otherToken }))
      const missingToken = await send(rundumBody({ draftToken: undefined }))
      assert.equal(wrongToken.statusCode, 404)
      assert.equal(missingToken.statusCode, 400)
      assert.equal(db.orders.length, 0)
      assert.equal(db.fulfillments.size, 0)
      assert.equal(stripe.createCalls, 0)
    })

    it('does not start a Stripe session when fulfillment storage fails', async () => {
      db.failFulfillmentWrite = true
      const res = await send(rundumBody())
      assert.equal(res.statusCode, 500)
      assert.deepEqual(res.body, { error: 'Checkout failed' })
      assert.equal(db.orders.length, 1)
      assert.equal(db.fulfillments.size, 0)
      assert.equal(db.orders[0].stripe_checkout_session_id, null)
      assert.equal(stripe.createCalls, 0)
    })

    it('reuses an open session for identical data without rewriting consent', async () => {
      const first = await send(rundumBody())
      const savedBefore = { ...db.fulfillments.get(db.orders[0].id) }
      const second = await send(rundumBody())
      assert.equal(first.statusCode, 200)
      assert.equal(second.statusCode, 200)
      assert.equal(second.body.url, first.body.url)
      assert.equal(db.orders.length, 1)
      assert.equal(stripe.sessions.size, 1)
      assert.deepEqual(db.fulfillments.get(db.orders[0].id), savedBefore)
    })

    it('expires the old open session and creates a new order for changed fulfillment data', async () => {
      const first = await send(rundumBody())
      const second = await send(rundumBody({
        fulfillmentData: fulfillmentData({ firstName: 'Augusta' }),
      }))
      assert.equal(first.statusCode, 200)
      assert.equal(second.statusCode, 200)
      assert.notEqual(second.body.url, first.body.url)
      assert.equal(stripe.sessions.get('cs_test_1').status, 'expired')
      assert.deepEqual(db.orders.map((order) => order.status), ['failed', 'pending'])
      assert.equal(db.fulfillments.get(db.orders[1].id).first_name, 'Augusta')
      assert.equal(db.orders[1].stripe_checkout_session_id, 'cs_test_2')
    })

    it('keeps an existing order and updates data if no Stripe session has been created yet', async () => {
      stripe.failCreate = true
      assert.equal((await send(rundumBody())).statusCode, 502)
      const orderId = db.orders[0].id
      stripe.failCreate = false

      const retry = await send(rundumBody({
        fulfillmentData: fulfillmentData({ firstName: 'Augusta' }),
      }))
      assert.equal(retry.statusCode, 200)
      assert.equal(db.orders.length, 1)
      assert.equal(db.orders[0].id, orderId)
      assert.equal(db.fulfillments.get(orderId).first_name, 'Augusta')
      assert.equal(stripe.sessions.size, 1)
    })

    it('leaves the old order and details untouched if its session cannot be expired', async () => {
      await send(rundumBody())
      stripe.failExpire = true
      const res = await send(rundumBody({
        fulfillmentData: fulfillmentData({ firstName: 'Augusta' }),
      }))
      assert.equal(res.statusCode, 409)
      assert.equal(db.orders.length, 1)
      assert.equal(db.orders[0].status, 'pending')
      assert.equal(db.fulfillments.get(db.orders[0].id).first_name, 'Ada')
      assert.equal(stripe.sessions.get('cs_test_1').status, 'open')
    })

    it('never changes paid or completed orders for changed fulfillment data', async () => {
      await send(rundumBody())
      const order = db.orders[0]
      const savedBefore = { ...db.fulfillments.get(order.id) }
      order.status = 'paid'
      db.drafts[0].status = 'locked'

      const res = await send(rundumBody({
        fulfillmentData: fulfillmentData({ firstName: 'Augusta' }),
      }))
      assert.equal(res.statusCode, 409)
      assert.deepEqual(db.fulfillments.get(order.id), savedBefore)
      assert.equal(stripe.sessions.size, 1)
    })

    it('does not replace a completed Stripe session', async () => {
      await send(rundumBody())
      stripe.sessions.get('cs_test_1').status = 'complete'
      const res = await send(rundumBody({
        fulfillmentData: fulfillmentData({ firstName: 'Augusta' }),
      }))
      assert.equal(res.statusCode, 409)
      assert.equal(db.orders.length, 1)
      assert.equal(db.orders[0].status, 'pending')
      assert.equal(db.fulfillments.get(db.orders[0].id).first_name, 'Ada')
      assert.equal(stripe.sessions.size, 1)
    })

    it('allows only the request matching the stored data to succeed when requests race', async () => {
      let release
      let waiting = 0
      const bothCreating = new Promise((resolve) => {
        release = resolve
      })
      const createSession = stripe.checkout.sessions.create
      stripe.checkout.sessions.create = async (...args) => {
        waiting += 1
        if (waiting === 2) release()
        await bothCreating
        return createSession(...args)
      }

      const [first, second] = await Promise.all([
        send(rundumBody()),
        send(rundumBody({ fulfillmentData: fulfillmentData({ firstName: 'Augusta' }) })),
      ])
      const responses = [first, second]
      assert.equal(responses.filter((response) => response.statusCode === 200).length, 1)
      assert.equal(responses.filter((response) => response.statusCode === 409).length, 1)
      assert.equal(db.orders.filter((order) => order.status === 'pending').length, 1)
      assert.equal(stripe.sessions.size, 1)
      assert.equal(stripe.sessions.get('cs_test_1').status, 'open')
      const winner = first.statusCode === 200 ? 'Ada' : 'Augusta'
      assert.equal(db.fulfillments.get(db.orders.find((order) => order.status === 'pending').id).first_name, winner)
    })

    it('rejects fulfillment data for the other packages', async () => {
      const res = await send(validBody({
        package: 'artist-band-code-and-go',
        fulfillmentData: fulfillmentData(),
      }))
      assert.equal(res.statusCode, 400)
      assert.equal(db.orders.length, 0)
      assert.equal(stripe.createCalls, 0)
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

    const businessRundumBody = (draftId = BUSINESS_DRAFT_ID, fulfillment = businessFulfillmentData()) => {
      const draftToken = addBusinessDraft(draftId, validBusinessData)
      return {
        builder: 'business',
        package: 'business-rundum-sorglos',
        draftId,
        draftToken,
        fulfillmentData: fulfillment,
      }
    }

    it('uses the shared Business package definitions for both offers', async () => {
      const entries = [
        ['business-pure-code', BUSINESS_DRAFT_ID, 29900],
        ['business-rundum-sorglos', OTHER_BUSINESS_DRAFT_ID, 47900],
      ]

      for (const [packageCode, draftId, expectedAmountCents] of entries) {
        const draftToken = addBusinessDraft(draftId, validBusinessData)
        const request = {
          builder: 'business',
          package: packageCode,
          draftId,
          draftToken,
          ...(packageCode === 'business-rundum-sorglos' && { fulfillmentData: businessFulfillmentData() }),
        }
        const res = await send(request)

        assert.equal(res.statusCode, 200)
        const pkg = packages[packageCode]
        const order = db.orders.find((item) => item.draft_id === draftId)
        assert.equal(pkg.builderSlug, 'business')
        assert.equal(pkg.amountCents, expectedAmountCents)
        assert.equal(order.package_code, pkg.code)
        assert.equal(order.amount_cents, pkg.amountCents)
        const params = stripe.sessions.get(order.stripe_checkout_session_id).params
        assert.equal(params.line_items[0].price_data.unit_amount, pkg.amountCents)
        assert.equal(params.line_items[0].price_data.product_data.name, `Business – ${PACKAGE_COPY[packageCode].title}`)
        assert.equal(params.submit_type, 'pay')
        assert.equal(params.success_url, `${SITE_URL}/order/complete?checkout=success&builder=business`)
        assert.equal(params.cancel_url, `${SITE_URL}/order/complete?checkout=cancelled&builder=business`)
        assert.doesNotMatch(`${params.success_url}${params.cancel_url}`, new RegExp(draftToken))
        assert.doesNotMatch(`${params.success_url}${params.cancel_url}`, new RegExp(draftId))
        if (packageCode === 'business-rundum-sorglos') {
          assert.equal(db.fulfillments.get(order.id).customer_type, 'company')
          assert.equal(db.fulfillments.get(order.id).company_name, 'Musterbetrieb GmbH')
        } else {
          assert.equal(db.fulfillments.has(order.id), false)
        }
      }
    })

    it('requires and validates Business Rundum-Sorglos fulfillment before order creation', async () => {
      const missingBody = businessRundumBody(OTHER_BUSINESS_DRAFT_ID)
      delete missingBody.fulfillmentData
      const missing = await send(missingBody)
      const invalid = await send(businessRundumBody(BUSINESS_DRAFT_ID, businessFulfillmentData({
        desiredDomain: 'not-a-de-domain.com',
      })))
      assert.equal(missing.statusCode, 400)
      assert.equal(invalid.statusCode, 400)
      assert.equal(db.orders.length, 0)
      assert.equal(db.fulfillments.size, 0)
      assert.equal(stripe.createCalls, 0)
    })

    it('stores Business fulfillment before creating the Stripe session and uses the configured price', async () => {
      const createSession = stripe.checkout.sessions.create
      stripe.checkout.sessions.create = async (...args) => {
        assert.equal(db.fulfillments.size, 1)
        const [orderId, saved] = [...db.fulfillments.entries()][0]
        assert.equal(orderId, db.orders[0].id)
        assert.equal(saved.customer_type, 'company')
        assert.equal(saved.company_name, 'Musterbetrieb GmbH')
        assert.equal(saved.communication_email, 'ada@example.de')
        assert.equal(saved.hostinger_consent_version, HOSTINGER_CONSENT_VERSION)
        return createSession(...args)
      }

      const res = await send(businessRundumBody())
      assert.equal(res.statusCode, 200)
      assert.equal(db.orders[0].amount_cents, 47900)
      assert.equal(stripe.sessions.get('cs_test_1').params.line_items[0].price_data.unit_amount, 47900)
      assert.doesNotMatch(JSON.stringify(stripe.sessions.get('cs_test_1').params), /Musterbetrieb|Ada|ada@example/)
    })

    it('reuses an open Business session when fulfillment data is unchanged', async () => {
      const body = businessRundumBody()
      const first = await send(body)
      const savedBefore = { ...db.fulfillments.get(db.orders[0].id) }
      const second = await send(body)
      assert.equal(first.statusCode, 200)
      assert.equal(second.statusCode, 200)
      assert.equal(second.body.url, first.body.url)
      assert.equal(db.orders.length, 1)
      assert.equal(stripe.sessions.size, 1)
      assert.deepEqual(db.fulfillments.get(db.orders[0].id), savedBefore)
    })

    it('expires the existing Business session when fulfillment data changes', async () => {
      const body = businessRundumBody()
      const first = await send(body)
      const second = await send({ ...body, fulfillmentData: businessFulfillmentData({
        companyName: 'Geänderter Betrieb GmbH',
      }) })
      assert.equal(first.statusCode, 200)
      assert.equal(second.statusCode, 200)
      assert.notEqual(second.body.url, first.body.url)
      assert.equal(stripe.sessions.get('cs_test_1').status, 'expired')
      assert.deepEqual(db.orders.map((order) => order.status), ['failed', 'pending'])
      assert.equal(db.fulfillments.get(db.orders[1].id).company_name, 'Geänderter Betrieb GmbH')
    })

    it('creates only one Business order and Stripe session for parallel identical requests', async () => {
      const body = businessRundumBody()
      const [first, second, third] = await Promise.all([send(body), send(body), send(body)])
      assert.deepEqual([first.statusCode, second.statusCode, third.statusCode], [200, 200, 200])
      assert.equal(first.body.url, second.body.url)
      assert.equal(first.body.url, third.body.url)
      assert.equal(db.orders.filter((order) => order.status === 'pending').length, 1)
      assert.equal(stripe.sessions.size, 1)
      assert.equal(db.fulfillments.size, 1)
    })

    it('rejects fulfillment data attached to Business Pure Code', async () => {
      const draftToken = addBusinessDraft(BUSINESS_DRAFT_ID, validBusinessData)
      const res = await send({
        builder: 'business',
        package: 'business-pure-code',
        draftId: BUSINESS_DRAFT_ID,
        draftToken,
        fulfillmentData: businessFulfillmentData(),
      })
      assert.equal(res.statusCode, 400)
      assert.equal(db.orders.length, 0)
      assert.equal(stripe.createCalls, 0)
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
      const second = await send(validBody({
        package: 'artist-band-rundum-sorglos',
        fulfillmentData: fulfillmentData(),
      }))
      assert.equal(second.statusCode, 200)
      assert.equal(stripe.sessions.get('cs_test_1').status, 'expired')
      assert.deepEqual(db.orders.map((o) => o.status), ['failed', 'pending'])
      assert.equal(db.orders[1].amount_cents, 7900)
    })

    it('keeps the order untouched when the old session cannot be expired', async () => {
      await send(validBody())
      stripe.failExpire = true
      const res = await send(validBody({
        package: 'artist-band-rundum-sorglos',
        fulfillmentData: fulfillmentData(),
      }))
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
        amount_cents: 3900,
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
