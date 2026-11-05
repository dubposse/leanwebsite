import { HOSTINGER_CONSENT_TEXT, HOSTINGER_CONSENT_VERSION } from '../shared/hostinger-consent.js'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const DOMAIN_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.de$/
export const FULFILLMENT_PACKAGE_CODE = 'artist-band-rundum-sorglos'

export { HOSTINGER_CONSENT_TEXT, HOSTINGER_CONSENT_VERSION }

export function packageRequiresFulfillment(packageCode) {
  return packageCode === FULFILLMENT_PACKAGE_CODE
}

export function createArtistBandCheckoutPayload({ packageCode, draftId, draftToken, fulfillmentData }) {
  return {
    builder: 'artist-band',
    package: packageCode,
    draftId,
    draftToken,
    ...(packageRequiresFulfillment(packageCode) && { fulfillmentData }),
  }
}

function requiredText(value, label) {
  const normalized = value.trim().normalize('NFC')
  if (!normalized) throw new Error(`Bitte gib ${label} ein.`)
  return normalized
}

function normalizeDomain(value, label, { optional = false } = {}) {
  const normalized = value.trim().toLowerCase()
  if (!normalized && optional) return null
  if (!DOMAIN_PATTERN.test(normalized)) {
    throw new Error(`${label} muss eine gültige neue .de-Domain ohne www oder Pfad sein.`)
  }
  return normalized
}

export function validateArtistBandFulfillment(data) {
  const email = requiredText(data.communicationEmail, 'eine Auftrags-E-Mail-Adresse')
  if (email.length > 254 || !EMAIL_PATTERN.test(email)) {
    throw new Error('Bitte gib eine gültige E-Mail-Adresse für die Auftragskommunikation ein.')
  }

  const countryCode = requiredText(data.billingCountryCode, 'ein Land').toUpperCase()
  if (!/^[A-Z]{2}$/.test(countryCode)) throw new Error('Bitte gib einen gültigen zweistelligen Ländercode ein, zum Beispiel DE.')

  const desiredDomain = normalizeDomain(data.desiredDomain, 'Die Wunschdomain')
  const alternativeDomain = normalizeDomain(data.alternativeDomain, 'Die alternative Domain', { optional: true })
  if (alternativeDomain === desiredDomain) throw new Error('Wunschdomain und alternative Domain müssen verschieden sein.')

  if (!data.hostingerConsent) throw new Error('Bitte bestätige ausdrücklich die Zustimmung zur Hostinger-Einrichtung.')

  const validated = {
    firstName: requiredText(data.firstName, 'deinen Vornamen'),
    lastName: requiredText(data.lastName, 'deinen Nachnamen'),
    billingStreet: requiredText(data.billingStreet, 'Straße und Hausnummer'),
    billingPostalCode: requiredText(data.billingPostalCode, 'die Postleitzahl'),
    billingCity: requiredText(data.billingCity, 'den Ort'),
    billingCountryCode: countryCode,
    communicationEmail: email.toLowerCase(),
    desiredDomain,
    alternativeDomain,
    domainHolderDiffers: data.domainHolderDiffers === true,
    hostingerConsent: true,
  }

  if (validated.domainHolderDiffers) {
    validated.domainHolderFirstName = requiredText(data.domainHolderFirstName ?? '', 'den Vornamen des Domaininhabers')
    validated.domainHolderLastName = requiredText(data.domainHolderLastName ?? '', 'den Nachnamen des Domaininhabers')
    validated.domainHolderStreet = requiredText(data.domainHolderStreet ?? '', 'die Straße des Domaininhabers')
    validated.domainHolderPostalCode = requiredText(data.domainHolderPostalCode ?? '', 'die Postleitzahl des Domaininhabers')
    validated.domainHolderCity = requiredText(data.domainHolderCity ?? '', 'den Ort des Domaininhabers')
    validated.domainHolderCountryCode = requiredText(data.domainHolderCountryCode ?? '', 'das Land des Domaininhabers').toUpperCase()
    if (!/^[A-Z]{2}$/.test(validated.domainHolderCountryCode)) {
      throw new Error('Bitte gib einen gültigen zweistelligen Ländercode für den Domaininhaber ein.')
    }
    const holderEmail = requiredText(data.domainHolderEmail ?? '', 'die E-Mail-Adresse des Domaininhabers')
    if (holderEmail.length > 254 || !EMAIL_PATTERN.test(holderEmail)) {
      throw new Error('Bitte gib eine gültige E-Mail-Adresse des Domaininhabers ein.')
    }
    validated.domainHolderEmail = holderEmail.toLowerCase()
  }

  return validated
}

export function collectArtistBandFulfillment(form) {
  const value = (name) => form.elements[name].value
  return validateArtistBandFulfillment({
    firstName: value('firstName'),
    lastName: value('lastName'),
    billingStreet: value('billingStreet'),
    billingPostalCode: value('billingPostalCode'),
    billingCity: value('billingCity'),
    billingCountryCode: value('billingCountryCode'),
    communicationEmail: value('communicationEmail'),
    desiredDomain: value('desiredDomain'),
    alternativeDomain: value('alternativeDomain'),
    domainHolderDiffers: value('domainHolderDiffers') === 'true',
    domainHolderFirstName: value('domainHolderFirstName'),
    domainHolderLastName: value('domainHolderLastName'),
    domainHolderStreet: value('domainHolderStreet'),
    domainHolderPostalCode: value('domainHolderPostalCode'),
    domainHolderCity: value('domainHolderCity'),
    domainHolderCountryCode: value('domainHolderCountryCode'),
    domainHolderEmail: value('domainHolderEmail'),
    hostingerConsent: form.elements.hostingerConsent.checked,
  })
}
