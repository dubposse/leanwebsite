import { HOSTINGER_CONSENT_TEXT, HOSTINGER_CONSENT_VERSION } from '../shared/hostinger-consent.js'

export const BUSINESS_FULFILLMENT_PACKAGE_CODE = 'business-rundum-sorglos'
export { HOSTINGER_CONSENT_TEXT, HOSTINGER_CONSENT_VERSION }

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const DOMAIN_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.de$/

const FIELDS = [
  ['customerType', 'customerType'],
  ['companyName', 'companyName'],
  ['firstName', 'firstName'],
  ['lastName', 'lastName'],
  ['billingStreet', 'billingStreet'],
  ['billingPostalCode', 'billingPostalCode'],
  ['billingCity', 'billingCity'],
  ['billingCountryCode', 'billingCountryCode'],
  ['communicationEmail', 'communicationEmail'],
  ['desiredDomain', 'desiredDomain'],
  ['alternativeDomain', 'alternativeDomain'],
  ['domainHolderDiffers', 'domainHolderDiffers'],
  ['domainHolderType', 'domainHolderType'],
  ['domainHolderOrganizationName', 'domainHolderOrganizationName'],
  ['domainHolderFirstName', 'domainHolderFirstName'],
  ['domainHolderLastName', 'domainHolderLastName'],
  ['domainHolderStreet', 'domainHolderStreet'],
  ['domainHolderPostalCode', 'domainHolderPostalCode'],
  ['domainHolderCity', 'domainHolderCity'],
  ['domainHolderCountryCode', 'domainHolderCountryCode'],
  ['domainHolderEmail', 'domainHolderEmail'],
]

export class BusinessFulfillmentValidationError extends Error {
  constructor(field, message) {
    super(message)
    this.name = 'BusinessFulfillmentValidationError'
    this.field = field
  }
}

function requiredText(value, field, label, maxLength) {
  if (typeof value !== 'string') {
    throw new BusinessFulfillmentValidationError(field, `Bitte gib ${label} ein.`)
  }
  const normalized = value.normalize('NFC').trim()
  if (!normalized || /[\u0000-\u001f\u007f]/u.test(normalized) || Array.from(normalized).length > maxLength) {
    throw new BusinessFulfillmentValidationError(field, `Bitte prüfe ${label}.`)
  }
  return normalized
}

function optionalText(value, field, label, maxLength) {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'string') {
    throw new BusinessFulfillmentValidationError(field, `Bitte prüfe ${label}.`)
  }
  const normalized = value.normalize('NFC').trim()
  if (!normalized) return null
  if (/[\u0000-\u001f\u007f]/u.test(normalized) || Array.from(normalized).length > maxLength) {
    throw new BusinessFulfillmentValidationError(field, `Bitte prüfe ${label}.`)
  }
  return normalized
}

function countryCode(value, field, label) {
  const normalized = requiredText(value, field, label, 2).toUpperCase()
  if (!/^[A-Z]{2}$/.test(normalized)) {
    throw new BusinessFulfillmentValidationError(field, `Bitte gib einen gültigen zweistelligen Ländercode für ${label} ein, zum Beispiel DE.`)
  }
  return normalized
}

function emailAddress(value, field, label) {
  const normalized = requiredText(value, field, label, 254).toLowerCase()
  if (!EMAIL_PATTERN.test(normalized)) {
    throw new BusinessFulfillmentValidationError(field, `Bitte gib eine gültige E-Mail-Adresse für ${label} ein.`)
  }
  return normalized
}

function domain(value, field, label, { optional = false } = {}) {
  const normalized = optional
    ? optionalText(value, field, label, 253)?.toLowerCase() ?? null
    : requiredText(value, field, label, 253).toLowerCase()
  if (normalized !== null && !DOMAIN_PATTERN.test(normalized)) {
    throw new BusinessFulfillmentValidationError(field, `${label} muss eine gültige neue .de-Domain ohne www oder Pfad sein.`)
  }
  return normalized
}

export function validateBusinessFulfillment(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new BusinessFulfillmentValidationError('customerType', 'Bitte prüfe die Auftragsangaben.')
  }
  if (data.customerType !== 'company' && data.customerType !== 'self_employed') {
    throw new BusinessFulfillmentValidationError('customerType', 'Bitte wähle Unternehmen oder selbstständige Person.')
  }
  if (data.domainHolderDiffers !== true && data.domainHolderDiffers !== false) {
    throw new BusinessFulfillmentValidationError('domainHolderDiffers', 'Bitte wähle den Domaininhaber aus.')
  }
  if (data.hostingerConsent !== true) {
    throw new BusinessFulfillmentValidationError('hostingerConsent', 'Bitte bestätige die Zustimmung zu den Hostinger-Bedingungen.')
  }

  const companyName = data.customerType === 'company'
    ? requiredText(data.companyName, 'companyName', 'den Firmennamen', 200)
    : optionalText(data.companyName, 'companyName', 'den Firmennamen', 200)
  if (data.customerType === 'self_employed' && companyName !== null) {
    throw new BusinessFulfillmentValidationError('companyName', 'Als selbstständige Person ist kein Firmenname vorgesehen.')
  }

  const desiredDomain = domain(data.desiredDomain, 'desiredDomain', 'Die gewünschte Domain')
  const alternativeDomain = domain(data.alternativeDomain, 'alternativeDomain', 'Die alternative Domain', { optional: true })
  if (alternativeDomain === desiredDomain) {
    throw new BusinessFulfillmentValidationError('alternativeDomain', 'Wunschdomain und alternative Domain müssen verschieden sein.')
  }

  const validated = {
    customerType: data.customerType,
    companyName,
    firstName: requiredText(data.firstName, 'firstName', 'den Vornamen', 100),
    lastName: requiredText(data.lastName, 'lastName', 'den Nachnamen', 100),
    billingStreet: requiredText(data.billingStreet, 'billingStreet', 'Straße und Hausnummer', 200),
    billingPostalCode: requiredText(data.billingPostalCode, 'billingPostalCode', 'die Postleitzahl', 20),
    billingCity: requiredText(data.billingCity, 'billingCity', 'den Ort', 100),
    billingCountryCode: countryCode(data.billingCountryCode, 'billingCountryCode', 'das Rechnungsland'),
    communicationEmail: emailAddress(data.communicationEmail, 'communicationEmail', 'die Auftragskommunikation'),
    desiredDomain,
    alternativeDomain,
    domainHolderDiffers: data.domainHolderDiffers,
    hostingerConsent: true,
  }

  if (validated.domainHolderDiffers) {
    if (data.domainHolderType !== 'person' && data.domainHolderType !== 'organization') {
      throw new BusinessFulfillmentValidationError('domainHolderType', 'Bitte wähle eine Person oder Organisation als Domaininhaber.')
    }

    validated.domainHolderType = data.domainHolderType
    if (data.domainHolderType === 'organization') {
      validated.domainHolderOrganizationName = requiredText(
        data.domainHolderOrganizationName,
        'domainHolderOrganizationName',
        'den Namen der Organisation',
        200,
      )
    } else {
      validated.domainHolderFirstName = requiredText(data.domainHolderFirstName, 'domainHolderFirstName', 'den Vornamen des Domaininhabers', 100)
      validated.domainHolderLastName = requiredText(data.domainHolderLastName, 'domainHolderLastName', 'den Nachnamen des Domaininhabers', 100)
    }
    validated.domainHolderStreet = requiredText(data.domainHolderStreet, 'domainHolderStreet', 'die Straße des Domaininhabers', 200)
    validated.domainHolderPostalCode = requiredText(data.domainHolderPostalCode, 'domainHolderPostalCode', 'die Postleitzahl des Domaininhabers', 20)
    validated.domainHolderCity = requiredText(data.domainHolderCity, 'domainHolderCity', 'den Ort des Domaininhabers', 100)
    validated.domainHolderCountryCode = countryCode(data.domainHolderCountryCode, 'domainHolderCountryCode', 'das Land des Domaininhabers')
    validated.domainHolderEmail = emailAddress(data.domainHolderEmail, 'domainHolderEmail', 'den Domaininhaber')
  }

  return validated
}

export function collectBusinessFulfillment(form) {
  const value = (name) => form.elements[name].value
  return validateBusinessFulfillment({
    customerType: value('customerType'),
    companyName: value('companyName'),
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
    domainHolderType: value('domainHolderType'),
    domainHolderOrganizationName: value('domainHolderOrganizationName'),
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

export function createBusinessCheckoutPayload({ packageCode, draftId, draftToken, fulfillmentData }) {
  return {
    builder: 'business',
    package: packageCode,
    draftId,
    draftToken,
    ...(packageCode === BUSINESS_FULFILLMENT_PACKAGE_CODE && { fulfillmentData }),
  }
}

export function restoreBusinessFulfillment(form, data) {
  if (!data) return
  for (const [field, key] of FIELDS) {
    if (field === 'domainHolderDiffers') continue
    form.elements[field].value = data[key] ?? ''
  }
  form.elements.domainHolderDiffers.value = String(data.domainHolderDiffers === true)
  form.elements.hostingerConsent.checked = data.hostingerConsent === true
}

export function resetBusinessFulfillment(form) {
  form.reset()
  form.elements.customerType.value = 'company'
  form.elements.domainHolderDiffers.value = 'false'
  form.elements.domainHolderType.value = 'person'
  form.elements.hostingerConsent.checked = false
  for (const [, field] of FIELDS) {
    if (['customerType', 'domainHolderDiffers', 'domainHolderType'].includes(field)) continue
    if (field === 'hostingerConsent') continue
    form.elements[field].value = ''
  }
}
