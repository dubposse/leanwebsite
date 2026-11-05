import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  createArtistBandCheckoutPayload,
  HOSTINGER_CONSENT_TEXT,
  HOSTINGER_CONSENT_VERSION,
  packageRequiresFulfillment,
  validateArtistBandFulfillment,
} from '../src/artist-band-fulfillment.js'

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

describe('Artist & Band fulfillment UI data', () => {
  it('requires fulfillment only for Rundum sorglos', () => {
    assert.equal(packageRequiresFulfillment('artist-band-rundum-sorglos'), true)
    assert.equal(packageRequiresFulfillment('artist-band-code-and-go'), false)
    assert.equal(packageRequiresFulfillment('business-rundum-sorglos'), false)
  })

  it('sends normalized fulfillment fields only for Rundum sorglos', () => {
    const formData = validateArtistBandFulfillment(validData())
    assert.deepEqual(formData, {
      firstName: 'Ada',
      lastName: 'Lovelace',
      billingStreet: '1 Musterstraße',
      billingPostalCode: '10115',
      billingCity: 'Berlin',
      billingCountryCode: 'DE',
      communicationEmail: 'ada@example.de',
      desiredDomain: 'example.de',
      alternativeDomain: null,
      domainHolderDiffers: false,
      hostingerConsent: true,
    })

    const credentials = { draftId: 'draft-id', draftToken: 'secret-token' }
    assert.deepEqual(
      createArtistBandCheckoutPayload({
        packageCode: 'artist-band-rundum-sorglos',
        ...credentials,
        fulfillmentData: formData,
      }),
      {
        builder: 'artist-band',
        package: 'artist-band-rundum-sorglos',
        ...credentials,
        fulfillmentData: formData,
      },
    )
    assert.deepEqual(createArtistBandCheckoutPayload({
      packageCode: 'artist-band-code-and-go',
      ...credentials,
      fulfillmentData: formData,
    }), {
      builder: 'artist-band',
      package: 'artist-band-code-and-go',
      ...credentials,
    })
  })

  it('validates required fields, email, domains, and explicit consent', () => {
    for (const overrides of [
      { firstName: ' ' },
      { billingStreet: '' },
      { communicationEmail: 'invalid' },
      { desiredDomain: 'existing.com' },
      { desiredDomain: 'www.example.de' },
      { desiredDomain: 'same.de', alternativeDomain: 'SAME.de' },
      { hostingerConsent: false },
    ]) {
      assert.throws(() => validateArtistBandFulfillment(validData(overrides)))
    }

    assert.throws(
      () => validateArtistBandFulfillment(validData({ domainHolderDiffers: true })),
      /Vornamen des Domaininhabers/,
    )
  })

  it('requires complete data for a different domain holder and normalizes it', () => {
    const result = validateArtistBandFulfillment(validData({
      domainHolderDiffers: true,
      domainHolderFirstName: ' Grace ',
      domainHolderLastName: ' Hopper ',
      domainHolderStreet: ' 2 Another Street ',
      domainHolderPostalCode: ' 20095 ',
      domainHolderCity: ' Hamburg ',
      domainHolderCountryCode: 'de',
      domainHolderEmail: ' GRACE@EXAMPLE.DE ',
    }))
    assert.equal(result.domainHolderFirstName, 'Grace')
    assert.equal(result.domainHolderCountryCode, 'DE')
    assert.equal(result.domainHolderEmail, 'grace@example.de')
  })

  it('uses the consent wording associated with the existing server version', () => {
    assert.equal(HOSTINGER_CONSENT_VERSION, 'hostinger-setup-v1')
    assert.match(HOSTINGER_CONSENT_TEXT, /ersten Hostingmonat und das erste Jahr der Domainregistrierung/)
    assert.match(HOSTINGER_CONSENT_TEXT, /keine E-Mail-Postfächer eingerichtet/)
    assert.match(HOSTINGER_CONSENT_TEXT, /fünf Werktagen/)
  })
})
