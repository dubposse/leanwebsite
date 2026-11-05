import assert from 'node:assert/strict'
import { inflateSync } from 'node:zlib'
import { beforeEach, describe, it } from 'node:test'
import { PDFDocument } from 'pdf-lib'
import { createOrderConfirmationPdf } from '../api/_lib/order-confirmation-pdf.js'
import { createOrderConfirmationHandler } from '../api/orders/confirmation.js'
import { generateAccessToken } from '../api/_lib/tokens.js'
import { buildRequest, buildResponse, createFakeDb, createFakeStorage } from './helpers/fakes.js'

const DRAFT_ID = '33333333-3333-4333-8333-333333333333'
const OTHER_DRAFT_ID = '44444444-4444-4444-8444-444444444444'
const ORDER_ID = '11111111-1111-4111-8111-111111111111'
const CONTENT_KEY = `drafts/${DRAFT_ID}/content`
const JSON_HEADERS = { 'content-type': 'application/json' }

const fulfillment = {
  first_name: 'Ada',
  last_name: 'Beispiel',
  billing_street: 'Musterstraße 1',
  billing_postal_code: '10115',
  billing_city: 'Berlin',
  billing_country_code: 'DE',
  communication_email: 'ada@example.de',
  desired_domain: 'ada-band.de',
  alternative_domain: 'ada-music.de',
  domain_holder_differs: true,
  domain_holder_first_name: 'Grace',
  domain_holder_last_name: 'Lovelace',
  domain_holder_street: 'Beispielweg 2',
  domain_holder_postal_code: '10117',
  domain_holder_city: 'Berlin',
  domain_holder_country_code: 'DE',
  domain_holder_email: 'grace@example.de',
  hostinger_consent_version: 'hostinger-setup-v1',
  hostinger_consented_at: new Date('2026-10-25T10:30:00.000Z'),
}

function paidOrder(overrides = {}) {
  return {
    id: ORDER_ID,
    draft_id: DRAFT_ID,
    package_code: 'artist-band-rundum-sorglos',
    amount_cents: 7900,
    currency: 'EUR',
    status: 'paid',
    created_at: new Date('2026-10-24T09:00:00.000Z'),
    paid_at: new Date('2026-10-25T10:00:00.000Z'),
    ...overrides,
  }
}

function decodedText(pdf) {
  const source = pdf.toString('latin1')
  const contents = []
  for (const match of source.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
    try {
      contents.push(inflateSync(Buffer.from(match[1], 'latin1')).toString('latin1'))
    } catch {
      contents.push(match[1])
    }
  }
  return contents.join('\n')
    .match(/<([0-9A-F]+)> Tj/g)
    ?.map((value) => Buffer.from(value.slice(1, -3), 'hex').toString('latin1'))
    .join(' ') ?? ''
}

describe('POST /api/orders/confirmation', () => {
  let db
  let storage
  let handler
  let draftToken
  let otherToken

  const send = async (body, { headers = JSON_HEADERS, method = 'POST' } = {}) => {
    const res = buildResponse()
    await handler(buildRequest(body, { headers, method }), res)
    return res
  }

  const credentials = (overrides = {}) => ({ draftId: DRAFT_ID, draftToken, ...overrides })

  beforeEach(() => {
    db = createFakeDb()
    storage = createFakeStorage()
    const owner = generateAccessToken()
    const other = generateAccessToken()
    draftToken = owner.token
    otherToken = other.token
    db.drafts.push(
      { id: DRAFT_ID, builder_id: 'b1', status: 'locked', access_token_hash: owner.hash, storage_key: CONTENT_KEY },
      { id: OTHER_DRAFT_ID, builder_id: 'b1', status: 'locked', access_token_hash: other.hash },
    )
    storage.objects.set(CONTENT_KEY, {
      body: Buffer.from(JSON.stringify({ name: 'Ada & Die Beispiele' })),
      contentType: 'application/json',
    })
    db.orders.push(paidOrder())
    db.fulfillments.set(ORDER_ID, { ...fulfillment })
    handler = createOrderConfirmationHandler({ getDb: () => db, storage })
  })

  it('serves a paid Rundum-Sorglos PDF with the stored order and fulfillment information', async () => {
    db.orders[0].amount_cents = 8123
    const response = await send(credentials())

    assert.equal(response.statusCode, 200)
    assert.equal(response.headers['Content-Type'], 'application/pdf')
    assert.match(response.headers['Content-Disposition'], /attachment; filename="auftragsbestaetigung-rundum-sorglos\.pdf"/)
    assert.equal(response.headers['Cache-Control'], 'private, no-store, max-age=0')
    assert.equal(response.headers.Pragma, 'no-cache')
    assert.equal(response.headers.Expires, '0')
    assert.equal(response.headers['X-Content-Type-Options'], 'nosniff')
    assert.match(response.body.toString('ascii', 0, 8), /^%PDF-1\./)
    assert.equal((await PDFDocument.load(response.body)).getPageCount(), 1)

    const content = decodedText(response.body)
    for (const expected of [
      'LeanWebsite Studio',
      'Auftragsbestätigung',
      '11111111-1111-4111-8111-111111111111',
      'Ada & Die Beispiele',
      'Ada Beispiel',
      'Musterstraße 1',
      'ada@example.de',
      'ada-band.de',
      'ada-music.de',
      'Grace Lovelace',
      '81,23',
      'Bezahlt',
      'hostinger-setup-v1',
      '25. Oktober 2026',
      'Einrichtung einer statischen Website bei Hostinger.',
      'ersten Hostingmonat und das erste Domainjahr',
      'zweiten Hostingmonat trägt der Kunde die Hostingkosten.',
      'zweiten Jahr trägt der Kunde die Kosten der Domainverlängerung.',
      'Es wird kein E-Mail-Postfach eingerichtet.',
      'Bestehende Domains werden nicht übernommen.',
      'fünf Werktagen',
    ]) {
      assert.ok(content.includes(expected), `PDF should contain ${expected}`)
    }
    assert.equal(content.includes(draftToken), false)
    assert.doesNotMatch(content, /password|secret|payment_intent/i)
    assert.equal(storage.putCalls, 0)
    assert.equal(db.queries.some((query) => query.includes('UPDATE order_fulfillment')), false)
  })

  it('uses clean additional pages instead of clipping unusually long stored fields', async () => {
    const long = (length) => 'L'.repeat(length)
    const pdf = await createOrderConfirmationPdf({
      order: paidOrder(),
      amountCents: 7900,
      artistName: long(100),
      fulfillment: {
        ...fulfillment,
        first_name: long(100),
        last_name: long(100),
        billing_street: long(200),
        billing_postal_code: long(20),
        billing_city: long(100),
        communication_email: `${long(230)}@example.de`,
        desired_domain: `${long(60)}.de`,
        alternative_domain: `${long(60)}-alternative.de`,
        domain_holder_first_name: long(100),
        domain_holder_last_name: long(100),
        domain_holder_street: long(200),
        domain_holder_postal_code: long(20),
        domain_holder_city: long(100),
        domain_holder_email: `${long(230)}@example.de`,
      },
    })

    assert.ok((await PDFDocument.load(pdf)).getPageCount() > 1)
  })

  it('does not disclose fulfillment for an unpaid order', async () => {
    db.orders[0].status = 'pending'
    const response = await send(credentials())
    assert.equal(response.statusCode, 402)
    assert.equal(response.body.code, 'not_paid')
    assert.doesNotMatch(JSON.stringify(response.body), /ada@example|Musterstraße/)
    assert.equal(db.queries.some((query) => query.includes('FROM order_fulfillment WHERE order_id')), false)
  })

  it('rejects an incorrect draft token before reading fulfillment', async () => {
    const response = await send(credentials({ draftToken: otherToken }))
    assert.equal(response.statusCode, 404)
    assert.equal(db.queries.some((query) => query.includes('FROM order_fulfillment WHERE order_id')), false)
  })

  it('does not find an order belonging to another draft', async () => {
    db.orders[0].draft_id = OTHER_DRAFT_ID
    const response = await send(credentials())
    assert.equal(response.statusCode, 404)
    assert.equal(db.queries.some((query) => query.includes('FROM order_fulfillment WHERE order_id')), false)
  })

  it('rejects a paid order without its fulfillment record', async () => {
    db.fulfillments.clear()
    const response = await send(credentials())
    assert.equal(response.statusCode, 409)
    assert.equal(response.body.code, 'confirmation_unavailable')
    assert.doesNotMatch(JSON.stringify(response.body), /ada@example|Musterstraße/)
  })

  it('does not provide this document for other packages', async () => {
    db.orders[0].package_code = 'artist-band-code-and-go'
    const response = await send(credentials())
    assert.equal(response.statusCode, 404)
    assert.equal(db.queries.some((query) => query.includes('FROM order_fulfillment WHERE order_id')), false)
  })

  it('accepts credentials only in the POST body and does not log customer fields', async () => {
    const originalError = console.error
    const logs = []
    console.error = (...values) => logs.push(values.join(' '))
    try {
      const response = await send(credentials())
      assert.equal(response.statusCode, 200)
      assert.equal(logs.length, 0)
      assert.equal(db.queries.some((query) => query.includes('ada@example.de')), false)
    } finally {
      console.error = originalError
    }
  })
})
