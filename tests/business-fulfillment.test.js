import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  BUSINESS_FULFILLMENT_PACKAGE_CODE,
  collectBusinessFulfillment,
  createBusinessCheckoutPayload,
  HOSTINGER_CONSENT_TEXT,
  HOSTINGER_CONSENT_VERSION,
  resetBusinessFulfillment,
  restoreBusinessFulfillment,
  validateBusinessFulfillment,
} from '../src/business-fulfillment.js'

const validData = (overrides = {}) => ({
  customerType: 'company',
  companyName: ' Musterbetrieb GmbH ',
  firstName: ' Ada ',
  lastName: ' Lovelace ',
  billingStreet: ' 1 Musterstraße ',
  billingPostalCode: ' 10115 ',
  billingCity: ' Berlin ',
  billingCountryCode: ' de ',
  communicationEmail: ' ADA@EXAMPLE.DE ',
  desiredDomain: ' NEU.DE ',
  alternativeDomain: '',
  domainHolderDiffers: false,
  hostingerConsent: true,
  ...overrides,
})

function fakeForm(data = {}) {
  const defaults = {
    customerType: 'company',
    companyName: '',
    firstName: '',
    lastName: '',
    billingStreet: '',
    billingPostalCode: '',
    billingCity: '',
    billingCountryCode: '',
    communicationEmail: '',
    desiredDomain: '',
    alternativeDomain: '',
    domainHolderDiffers: 'false',
    domainHolderType: 'person',
    domainHolderOrganizationName: '',
    domainHolderFirstName: '',
    domainHolderLastName: '',
    domainHolderStreet: '',
    domainHolderPostalCode: '',
    domainHolderCity: '',
    domainHolderCountryCode: '',
    domainHolderEmail: '',
  }
  const elements = Object.fromEntries(
    Object.entries({ ...defaults, ...data }).map(([name, value]) => [
      name,
      { value, checked: name === 'hostingerConsent' ? value : undefined },
    ]),
  )
  elements.hostingerConsent ??= { checked: false }
  return {
    elements,
    reset() {
      for (const [name, value] of Object.entries(defaults)) elements[name].value = value
      elements.hostingerConsent.checked = false
    },
  }
}

describe('Business Rundum-Sorglos fulfillment form', () => {
  it('validates and normalizes company and self-employed customer data', () => {
    const company = validateBusinessFulfillment(validData())
    assert.equal(company.companyName, 'Musterbetrieb GmbH')
    assert.equal(company.firstName, 'Ada')
    assert.equal(company.billingCountryCode, 'DE')
    assert.equal(company.communicationEmail, 'ada@example.de')
    assert.equal(company.desiredDomain, 'neu.de')
    assert.equal(company.alternativeDomain, null)
    assert.equal(company.hostingerConsent, true)

    const selfEmployed = validateBusinessFulfillment(validData({
      customerType: 'self_employed',
      companyName: '',
    }))
    assert.equal(selfEmployed.customerType, 'self_employed')
    assert.equal(selfEmployed.companyName, null)
  })

  it('validates person and organization domain holders', () => {
    const shared = {
      domainHolderDiffers: true,
      domainHolderStreet: ' 2 Holder Straße ',
      domainHolderPostalCode: ' 20095 ',
      domainHolderCity: ' Hamburg ',
      domainHolderCountryCode: 'de',
      domainHolderEmail: ' INFO@EXAMPLE.DE ',
    }
    const person = validateBusinessFulfillment(validData({
      ...shared,
      domainHolderType: 'person',
      domainHolderFirstName: ' Grace ',
      domainHolderLastName: ' Hopper ',
    }))
    assert.equal(person.domainHolderType, 'person')
    assert.equal(person.domainHolderFirstName, 'Grace')
    assert.equal(person.domainHolderEmail, 'info@example.de')

    const organization = validateBusinessFulfillment(validData({
      ...shared,
      domainHolderType: 'organization',
      domainHolderOrganizationName: ' Beispiel e.V. ',
    }))
    assert.equal(organization.domainHolderType, 'organization')
    assert.equal(organization.domainHolderOrganizationName, 'Beispiel e.V.')
    assert.equal('domainHolderFirstName' in organization, false)
  })

  it('rejects missing, invalid, oversized, or conflicting required data', () => {
    for (const overrides of [
      { customerType: '' },
      { companyName: ' ' },
      { companyName: 'x'.repeat(201) },
      { customerType: 'self_employed', companyName: 'Nicht zulässig GmbH' },
      { firstName: '' },
      { lastName: 'x'.repeat(101) },
      { billingStreet: '' },
      { billingPostalCode: 'x'.repeat(21) },
      { billingCity: '' },
      { billingCountryCode: 'DEU' },
      { communicationEmail: 'invalid' },
      { desiredDomain: 'bestehend.com' },
      { desiredDomain: 'www.neu.de' },
      { desiredDomain: 'same.de', alternativeDomain: 'SAME.de' },
      { hostingerConsent: false },
      { domainHolderDiffers: true, domainHolderType: 'organization' },
      { domainHolderDiffers: true, domainHolderType: 'organization', domainHolderOrganizationName: 'Verein' },
      { ...validData(), domainHolderDiffers: true, domainHolderType: 'person' },
    ]) {
      assert.throws(() => validateBusinessFulfillment(validData(overrides)))
    }

    assert.throws(() => validateBusinessFulfillment(validData({
      domainHolderDiffers: true,
      domainHolderType: 'organization',
      domainHolderOrganizationName: 'Verein',
      domainHolderStreet: '1 Straße',
      domainHolderPostalCode: '12345',
      domainHolderCity: 'Berlin',
      domainHolderCountryCode: 'DE',
      domainHolderEmail: 'bad',
    })))
  })

  it('collects and restores order data without relying on website builder data', () => {
    const form = fakeForm({
      customerType: 'company',
      companyName: 'Firma GmbH',
      firstName: 'Ada',
      lastName: 'Lovelace',
      billingStreet: '1 Musterstraße',
      billingPostalCode: '10115',
      billingCity: 'Berlin',
      billingCountryCode: 'DE',
      communicationEmail: 'ada@example.de',
      desiredDomain: 'neu.de',
      alternativeDomain: '',
      domainHolderDiffers: 'false',
    })
    form.elements.hostingerConsent.checked = true
    const collected = collectBusinessFulfillment(form)
    assert.equal(collected.desiredDomain, 'neu.de')

    const restored = fakeForm()
    restoreBusinessFulfillment(restored, {
      ...collected,
      domainHolderDiffers: true,
      domainHolderType: 'organization',
      domainHolderOrganizationName: 'Beispiel e.V.',
      domainHolderStreet: '2 Vereinsweg',
      domainHolderPostalCode: '20095',
      domainHolderCity: 'Hamburg',
      domainHolderCountryCode: 'DE',
      domainHolderEmail: 'info@example.de',
      hostingerConsent: true,
    })
    assert.equal(restored.elements.customerType.value, 'company')
    assert.equal(restored.elements.domainHolderDiffers.value, 'true')
    assert.equal(restored.elements.domainHolderType.value, 'organization')
    assert.equal(restored.elements.domainHolderOrganizationName.value, 'Beispiel e.V.')
    assert.equal(restored.elements.hostingerConsent.checked, true)
  })

  it('resets private order fields and consent when starting a new server draft', () => {
    const form = fakeForm({
      customerType: 'self_employed',
      companyName: '',
      communicationEmail: 'ada@example.de',
      desiredDomain: 'neu.de',
      domainHolderDiffers: 'true',
      domainHolderType: 'organization',
      domainHolderOrganizationName: 'Beispiel e.V.',
      domainHolderStreet: '2 Vereinsweg',
    })
    form.elements.hostingerConsent.checked = true
    resetBusinessFulfillment(form)
    assert.equal(form.elements.customerType.value, 'company')
    assert.equal(form.elements.communicationEmail.value, '')
    assert.equal(form.elements.desiredDomain.value, '')
    assert.equal(form.elements.domainHolderDiffers.value, 'false')
    assert.equal(form.elements.domainHolderOrganizationName.value, '')
    assert.equal(form.elements.hostingerConsent.checked, false)
  })

  it('includes fulfillment data only for Business Rundum Sorglos and uses the existing consent version', () => {
    const credentials = { draftId: 'draft-id', draftToken: 'secret-token' }
    const data = validateBusinessFulfillment(validData())
    assert.deepEqual(
      createBusinessCheckoutPayload({
        packageCode: BUSINESS_FULFILLMENT_PACKAGE_CODE,
        ...credentials,
        fulfillmentData: data,
      }),
      {
        builder: 'business',
        package: BUSINESS_FULFILLMENT_PACKAGE_CODE,
        ...credentials,
        fulfillmentData: data,
      },
    )
    assert.deepEqual(
      createBusinessCheckoutPayload({
        packageCode: 'business-pure-code',
        ...credentials,
        fulfillmentData: data,
      }),
      { builder: 'business', package: 'business-pure-code', ...credentials },
    )
    assert.equal(HOSTINGER_CONSENT_VERSION, 'hostinger-setup-v1')
    assert.match(HOSTINGER_CONSENT_TEXT, /neue, verfügbare \.de-Domain/)
  })
})
