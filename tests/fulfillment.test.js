import assert from 'node:assert/strict'
import { beforeEach, describe, it } from 'node:test'
import {
  BUSINESS_FULFILLMENT_PACKAGE_CODE,
  FULFILLMENT_PACKAGE_CODE,
  HOSTINGER_CONSENT_VERSION,
  loadOrderFulfillment,
  saveOrderFulfillment,
  validateFulfillmentData,
} from '../api/_lib/fulfillment.js'
import { generateAccessToken } from '../api/_lib/tokens.js'
import { createFakeDb } from './helpers/fakes.js'

const DRAFT_ID = '33333333-3333-4333-8333-333333333333'
const ORDER_ID = '77777777-7777-4777-8777-777777777777'

const validData = (overrides = {}) => ({
  firstName: ' Ada ',
  lastName: ' Lovelace ',
  billingStreet: ' 1 Musterstraße ',
  billingPostalCode: ' 10115 ',
  billingCity: ' Berlin ',
  billingCountryCode: ' de ',
  communicationEmail: ' ADA@EXAMPLE.DE ',
  desiredDomain: ' EXAMPLE.de ',
  alternativeDomain: '',
  domainHolderDiffers: false,
  hostingerConsent: true,
  ...overrides,
})

function createFulfillmentDb() {
  const db = createFakeDb()
  const access = generateAccessToken()
  db.drafts.push({
    id: DRAFT_ID,
    builder_id: 'b1',
    status: 'draft',
    access_token_hash: access.hash,
  })
  db.orders.push({
    id: ORDER_ID,
    draft_id: DRAFT_ID,
    package_code: FULFILLMENT_PACKAGE_CODE,
    status: 'pending',
    created_at: new Date('2026-01-01T00:00:00.000Z'),
  })

  const fulfillment = new Map()
  const sql = {
    queries: [],
    async query(text, params = []) {
      this.queries.push({ text, params })

      if (text.includes('FROM drafts d JOIN builders')) return db.query(text, params)

      if (text.includes('WITH editable_order AS MATERIALIZED')) {
        const [draftId, packageCode] = params
        const order = db.orders.find(
          (item) => item.draft_id === draftId && item.package_code === packageCode && item.status === 'pending',
        )
        if (!order) return []

        const columns = [
          'first_name',
          'last_name',
          'billing_street',
          'billing_postal_code',
          'billing_city',
          'billing_country_code',
          'communication_email',
          'desired_domain',
          'alternative_domain',
          'domain_holder_differs',
          'domain_holder_first_name',
          'domain_holder_last_name',
          'domain_holder_street',
          'domain_holder_postal_code',
          'domain_holder_city',
          'domain_holder_country_code',
          'domain_holder_email',
          'customer_type',
          'company_name',
          'domain_holder_type',
          'domain_holder_organization_name',
          'hostinger_consent_version',
          'hostinger_consented_at',
        ]
        const row = { order_id: order.id, fulfillment_status: 'pending' }
        columns.forEach((column, index) => {
          row[column] = params[index + 3]
        })
        fulfillment.set(order.id, row)
        return [{ order_id: order.id }]
      }

      if (text.includes('LEFT JOIN order_fulfillment')) {
        const explicitOrder = text.includes('WHERE o.id = $1')
        const [first, second, packageCode] = params
        const order = explicitOrder
          ? db.orders.find(
              (item) =>
                item.id === first &&
                item.draft_id === second &&
                item.package_code === packageCode &&
                item.status === 'pending',
            )
          : db.orders
              .filter((item) => item.draft_id === first && item.package_code === second && item.status === 'pending')
              .sort((a, b) => b.created_at - a.created_at)[0]
        if (!order) return []

        return [{ order_id: order.id, ...fulfillment.get(order.id) }]
      }

      throw new Error(`unexpected fulfillment query: ${text.slice(0, 60)}`)
    },
  }

  return { db, sql, token: access.token, fulfillment }
}

function businessData(overrides = {}) {
  return validData({
    customerType: 'company',
    companyName: ' Example GmbH ',
    ...overrides,
  })
}

function createBusinessFulfillmentDb() {
  const fixture = createFulfillmentDb()
  fixture.db.builders[0].slug = 'business'
  fixture.db.builders[0].name = 'Business'
  fixture.db.orders[0].package_code = BUSINESS_FULFILLMENT_PACKAGE_CODE
  return fixture
}

describe('fulfillment data validation', () => {
  it('normalizes valid customer data and keeps consent metadata server-owned', () => {
    assert.deepEqual(validateFulfillmentData(validData()), {
      first_name: 'Ada',
      last_name: 'Lovelace',
      billing_street: '1 Musterstraße',
      billing_postal_code: '10115',
      billing_city: 'Berlin',
      billing_country_code: 'DE',
      communication_email: 'ada@example.de',
      desired_domain: 'example.de',
      alternative_domain: null,
      domain_holder_differs: false,
      domain_holder_first_name: null,
      domain_holder_last_name: null,
      domain_holder_street: null,
      domain_holder_postal_code: null,
      domain_holder_city: null,
      domain_holder_country_code: null,
      domain_holder_email: null,
    })
  })

  it('requires explicit Hostinger consent', () => {
    assert.throws(() => validateFulfillmentData(validData({ hostingerConsent: false })), {
      statusCode: 400,
      message: 'Hostinger setup consent is required',
    })
    assert.throws(() => validateFulfillmentData(validData({ hostingerConsent: undefined })), { statusCode: 400 })
  })

  it('rejects invalid names, billing fields, and email addresses', () => {
    for (const overrides of [
      { firstName: '   ' },
      { lastName: 'x'.repeat(101) },
      { billingStreet: '' },
      { billingPostalCode: 'x'.repeat(21) },
      { billingCity: 'Berlin\n' },
      { billingCountryCode: 'DEU' },
      { communicationEmail: 'not-an-email' },
    ]) {
      assert.throws(() => validateFulfillmentData(validData(overrides)), { statusCode: 400 })
    }
  })

  it('rejects invalid desired and alternative domains', () => {
    for (const desiredDomain of ['example.com', 'foo.bar.de', '-bad.de', 'bad-.de', 'domain .de']) {
      assert.throws(() => validateFulfillmentData(validData({ desiredDomain })), { statusCode: 400 })
    }

    assert.throws(() => validateFulfillmentData(validData({
      desiredDomain: 'same.de',
      alternativeDomain: 'same.de',
    })), { statusCode: 400 })
    assert.throws(() => validateFulfillmentData(validData({ alternativeDomain: 'example.org' })), { statusCode: 400 })
  })

  it('requires complete alternate domain holder data when the holder differs', () => {
    assert.throws(() => validateFulfillmentData(validData({ domainHolderDiffers: true })), { statusCode: 400 })

    const data = validateFulfillmentData(validData({
      domainHolderDiffers: true,
      domainHolderFirstName: ' Grace ',
      domainHolderLastName: ' Hopper ',
      domainHolderStreet: ' 2 Another Street ',
      domainHolderPostalCode: ' 20095 ',
      domainHolderCity: ' Hamburg ',
      domainHolderCountryCode: 'de',
      domainHolderEmail: ' GRACE@EXAMPLE.DE ',
    }))
    assert.equal(data.domain_holder_first_name, 'Grace')
    assert.equal(data.domain_holder_country_code, 'DE')
    assert.equal(data.domain_holder_email, 'grace@example.de')
  })

  it('rejects client-controlled consent metadata and fulfillment status', () => {
    assert.throws(() => validateFulfillmentData(validData({
      hostingerConsentVersion: 'client-version',
    })), { statusCode: 400 })
    assert.throws(() => validateFulfillmentData(validData({
      fulfillmentStatus: 'completed',
    })), { statusCode: 400 })
  })

  it('validates and normalizes Business company and self-employed data', () => {
    assert.deepEqual(validateFulfillmentData(businessData(), BUSINESS_FULFILLMENT_PACKAGE_CODE), {
      customer_type: 'company',
      company_name: 'Example GmbH',
      first_name: 'Ada',
      last_name: 'Lovelace',
      billing_street: '1 Musterstraße',
      billing_postal_code: '10115',
      billing_city: 'Berlin',
      billing_country_code: 'DE',
      communication_email: 'ada@example.de',
      desired_domain: 'example.de',
      alternative_domain: null,
      domain_holder_differs: false,
      domain_holder_first_name: null,
      domain_holder_last_name: null,
      domain_holder_street: null,
      domain_holder_postal_code: null,
      domain_holder_city: null,
      domain_holder_country_code: null,
      domain_holder_email: null,
      domain_holder_type: null,
      domain_holder_organization_name: null,
    })

    const selfEmployed = validateFulfillmentData(
      businessData({ customerType: 'self_employed', companyName: '' }),
      BUSINESS_FULFILLMENT_PACKAGE_CODE,
    )
    assert.equal(selfEmployed.customer_type, 'self_employed')
    assert.equal(selfEmployed.company_name, null)
  })

  it('validates person and organization domain holders for Business', () => {
    const person = validateFulfillmentData(businessData({
      domainHolderDiffers: true,
      domainHolderType: 'person',
      domainHolderFirstName: ' Grace ',
      domainHolderLastName: ' Hopper ',
      domainHolderStreet: ' 2 Another Street ',
      domainHolderPostalCode: ' 20095 ',
      domainHolderCity: ' Hamburg ',
      domainHolderCountryCode: 'de',
      domainHolderEmail: ' GRACE@EXAMPLE.DE ',
    }), BUSINESS_FULFILLMENT_PACKAGE_CODE)
    assert.equal(person.domain_holder_type, 'person')
    assert.equal(person.domain_holder_first_name, 'Grace')
    assert.equal(person.domain_holder_organization_name, null)

    const organization = validateFulfillmentData(businessData({
      domainHolderDiffers: true,
      domainHolderType: 'organization',
      domainHolderOrganizationName: ' Example e.V. ',
      domainHolderStreet: ' 2 Another Street ',
      domainHolderPostalCode: ' 20095 ',
      domainHolderCity: ' Hamburg ',
      domainHolderCountryCode: 'de',
      domainHolderEmail: ' INFO@EXAMPLE.DE ',
    }), BUSINESS_FULFILLMENT_PACKAGE_CODE)
    assert.equal(organization.domain_holder_type, 'organization')
    assert.equal(organization.domain_holder_organization_name, 'Example e.V.')
    assert.equal(organization.domain_holder_first_name, null)
  })

  it('rejects incomplete or conflicting Business fields', () => {
    for (const overrides of [
      { customerType: undefined },
      { companyName: '' },
      { companyName: 'x'.repeat(201) },
      { customerType: 'self_employed', companyName: 'Not allowed Ltd' },
      { desiredDomain: '' },
      { domainHolderDiffers: true, domainHolderType: 'organization' },
      { domainHolderDiffers: true, domainHolderType: 'organization', domainHolderOrganizationName: 'Org' },
      { domainHolderDiffers: true, domainHolderType: 'organization', domainHolderOrganizationName: 'Org', domainHolderFirstName: 'Ada' },
      { domainHolderDiffers: true, domainHolderType: 'company' },
    ]) {
      assert.throws(
        () => validateFulfillmentData(businessData(overrides), BUSINESS_FULFILLMENT_PACKAGE_CODE),
        { statusCode: 400 },
      )
    }

    assert.throws(() => validateFulfillmentData(businessData(), FULFILLMENT_PACKAGE_CODE), { statusCode: 400 })
    assert.throws(() => validateFulfillmentData(validData(), BUSINESS_FULFILLMENT_PACKAGE_CODE), { statusCode: 400 })
  })
})

describe('authorized fulfillment helpers', () => {
  let db
  let sql
  let token
  let fulfillment

  beforeEach(() => {
    ;({ db, sql, token, fulfillment } = createFulfillmentDb())
  })

  it('loads the authorized pending order form, including an empty form before first save', async () => {
    assert.deepEqual(await loadOrderFulfillment({ sql, draftId: DRAFT_ID, draftToken: token }), { data: null })
  })

  it('saves and reloads normalized data with server-owned consent metadata', async () => {
    const saved = await saveOrderFulfillment({ sql, draftId: DRAFT_ID, draftToken: token, data: validData() })
    assert.deepEqual(saved, { orderId: ORDER_ID })
    const row = fulfillment.get(ORDER_ID)
    assert.equal(row.hostinger_consent_version, HOSTINGER_CONSENT_VERSION)
    assert.ok(row.hostinger_consented_at instanceof Date)
    assert.equal(row.fulfillment_status, 'pending')

    const loaded = await loadOrderFulfillment({ sql, draftId: DRAFT_ID, draftToken: token })
    assert.equal(loaded.data.communicationEmail, 'ada@example.de')
    assert.equal(loaded.data.hostingerConsent, true)
    assert.equal('fulfillmentStatus' in loaded.data, false)
  })

  it('updates existing details only while the order remains pending', async () => {
    await saveOrderFulfillment({ sql, draftId: DRAFT_ID, draftToken: token, data: validData() })
    await saveOrderFulfillment({
      sql,
      draftId: DRAFT_ID,
      draftToken: token,
      data: validData({ firstName: 'Augusta' }),
    })
    assert.equal(fulfillment.get(ORDER_ID).first_name, 'Augusta')

    db.orders[0].status = 'paid'
    await assert.rejects(
      saveOrderFulfillment({ sql, draftId: DRAFT_ID, draftToken: token, data: validData({ firstName: 'Changed' }) }),
      { statusCode: 409 },
    )
    assert.equal(fulfillment.get(ORDER_ID).first_name, 'Augusta')
  })

  it('rejects a wrong draft token without attempting to read or write fulfillment data', async () => {
    await assert.rejects(
      loadOrderFulfillment({ sql, draftId: DRAFT_ID, draftToken: generateAccessToken().token }),
      { statusCode: 404 },
    )
    await assert.rejects(
      saveOrderFulfillment({ sql, draftId: DRAFT_ID, draftToken: generateAccessToken().token, data: validData() }),
      { statusCode: 404 },
    )
    assert.equal(sql.queries.some(({ text }) => text.includes('order_fulfillment')), false)
  })

  it('rejects other packages and returns no Business data without a matching order', async () => {
    db.orders[0].package_code = 'artist-band-code-and-go'
    assert.deepEqual(await loadOrderFulfillment({ sql, draftId: DRAFT_ID, draftToken: token }), { data: null })

    const business = generateAccessToken()
    db.builders.push({ id: 'b2', slug: 'business', name: 'Business', active: true })
    db.drafts.push({
      id: '55555555-5555-4555-8555-555555555555',
      builder_id: 'b2',
      status: 'draft',
      access_token_hash: business.hash,
    })
    assert.deepEqual(await loadOrderFulfillment({
      sql,
      draftId: '55555555-5555-4555-8555-555555555555',
      draftToken: business.token,
    }), { data: null })
    await assert.rejects(
      saveOrderFulfillment({
        sql,
        draftId: '55555555-5555-4555-8555-555555555555',
        draftToken: business.token,
        data: businessData(),
      }),
      { statusCode: 409 },
    )
  })

  it('does not create fulfillment data without an existing pending order', async () => {
    db.orders.length = 0
    await assert.rejects(
      saveOrderFulfillment({ sql, draftId: DRAFT_ID, draftToken: token, data: validData() }),
      { statusCode: 409 },
    )
    assert.equal(fulfillment.size, 0)
  })

  it('saves and restores Business fulfillment with an organization domain holder', async () => {
    ;({ db, sql, token, fulfillment } = createBusinessFulfillmentDb())
    const data = businessData({
      domainHolderDiffers: true,
      domainHolderType: 'organization',
      domainHolderOrganizationName: ' Example e.V. ',
      domainHolderStreet: ' 2 Another Street ',
      domainHolderPostalCode: ' 20095 ',
      domainHolderCity: ' Hamburg ',
      domainHolderCountryCode: 'de',
      domainHolderEmail: ' INFO@EXAMPLE.DE ',
    })

    assert.deepEqual(await saveOrderFulfillment({ sql, draftId: DRAFT_ID, draftToken: token, data }), {
      orderId: ORDER_ID,
    })
    const stored = fulfillment.get(ORDER_ID)
    assert.equal(stored.customer_type, 'company')
    assert.equal(stored.company_name, 'Example GmbH')
    assert.equal(stored.domain_holder_type, 'organization')
    assert.equal(stored.domain_holder_organization_name, 'Example e.V.')
    assert.equal(stored.domain_holder_first_name, null)

    const loaded = await loadOrderFulfillment({ sql, draftId: DRAFT_ID, draftToken: token })
    assert.equal(loaded.data.customerType, 'company')
    assert.equal(loaded.data.companyName, 'Example GmbH')
    assert.equal(loaded.data.domainHolderType, 'organization')
    assert.equal(loaded.data.domainHolderOrganizationName, 'Example e.V.')
  })

  it('saves and restores self-employed data with a person domain holder', async () => {
    ;({ db, sql, token, fulfillment } = createBusinessFulfillmentDb())
    const data = businessData({
      customerType: 'self_employed',
      companyName: '',
      domainHolderDiffers: true,
      domainHolderType: 'person',
      domainHolderFirstName: ' Grace ',
      domainHolderLastName: ' Hopper ',
      domainHolderStreet: ' 2 Another Street ',
      domainHolderPostalCode: ' 20095 ',
      domainHolderCity: ' Hamburg ',
      domainHolderCountryCode: 'de',
      domainHolderEmail: ' GRACE@EXAMPLE.DE ',
    })
    await saveOrderFulfillment({ sql, draftId: DRAFT_ID, draftToken: token, data })

    const loaded = await loadOrderFulfillment({ sql, draftId: DRAFT_ID, draftToken: token })
    assert.equal(loaded.data.customerType, 'self_employed')
    assert.equal(loaded.data.companyName, null)
    assert.equal(loaded.data.domainHolderType, 'person')
    assert.equal(loaded.data.domainHolderFirstName, 'Grace')
  })

  it('does not expose Business fulfillment to another token or package', async () => {
    ;({ db, sql, token, fulfillment } = createBusinessFulfillmentDb())
    await saveOrderFulfillment({ sql, draftId: DRAFT_ID, draftToken: token, data: businessData() })
    await assert.rejects(
      loadOrderFulfillment({ sql, draftId: DRAFT_ID, draftToken: generateAccessToken().token }),
      { statusCode: 404 },
    )

    db.orders[0].package_code = 'business-pure-code'
    assert.deepEqual(await loadOrderFulfillment({ sql, draftId: DRAFT_ID, draftToken: token }), { data: null })
    db.orders[0].package_code = FULFILLMENT_PACKAGE_CODE
    await assert.rejects(
      saveOrderFulfillment({ sql, draftId: DRAFT_ID, draftToken: token, data: businessData() }),
      { statusCode: 409 },
    )
  })

  it('keeps Business fulfillment immutable after payment', async () => {
    ;({ db, sql, token, fulfillment } = createBusinessFulfillmentDb())
    await saveOrderFulfillment({ sql, draftId: DRAFT_ID, draftToken: token, data: businessData() })
    db.orders[0].status = 'paid'
    await assert.rejects(
      saveOrderFulfillment({
        sql,
        draftId: DRAFT_ID,
        draftToken: token,
        data: businessData({ companyName: 'Changed GmbH' }),
      }),
      { statusCode: 409 },
    )
    assert.equal(fulfillment.get(ORDER_ID).company_name, 'Example GmbH')
  })
})
