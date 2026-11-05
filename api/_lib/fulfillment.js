import { loadAuthorizedDraft, UUID_PATTERN } from './drafts.js'
import { HttpError } from './http.js'
import { isWellFormedToken } from './tokens.js'
import { HOSTINGER_CONSENT_VERSION } from '../../shared/hostinger-consent.js'

// Checkout currently creates orders together with a Stripe session; these helpers require that pending order.
export const FULFILLMENT_PACKAGE_CODE = 'artist-band-rundum-sorglos'
export { HOSTINGER_CONSENT_VERSION }

const DOMAIN_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.de$/
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u
const ALLOWED_FIELDS = new Set([
  'firstName',
  'lastName',
  'billingStreet',
  'billingPostalCode',
  'billingCity',
  'billingCountryCode',
  'communicationEmail',
  'desiredDomain',
  'alternativeDomain',
  'domainHolderDiffers',
  'domainHolderFirstName',
  'domainHolderLastName',
  'domainHolderStreet',
  'domainHolderPostalCode',
  'domainHolderCity',
  'domainHolderCountryCode',
  'domainHolderEmail',
  'hostingerConsent',
])

const SELECT_FULFILLMENT_SQL = `SELECT o.id AS order_id, f.first_name, f.last_name,
    f.billing_street, f.billing_postal_code, f.billing_city, f.billing_country_code,
    f.communication_email, f.desired_domain, f.alternative_domain, f.domain_holder_differs,
    f.domain_holder_first_name, f.domain_holder_last_name, f.domain_holder_street,
    f.domain_holder_postal_code, f.domain_holder_city, f.domain_holder_country_code,
    f.domain_holder_email
  FROM orders o
  LEFT JOIN order_fulfillment f ON f.order_id = o.id
  WHERE o.draft_id = $1 AND o.package_code = $2 AND o.status = 'pending'
  ORDER BY o.created_at DESC
  LIMIT 1`

const SELECT_FULFILLMENT_FOR_ORDER_SQL = `SELECT o.id AS order_id, f.first_name, f.last_name,
    f.billing_street, f.billing_postal_code, f.billing_city, f.billing_country_code,
    f.communication_email, f.desired_domain, f.alternative_domain, f.domain_holder_differs,
    f.domain_holder_first_name, f.domain_holder_last_name, f.domain_holder_street,
    f.domain_holder_postal_code, f.domain_holder_city, f.domain_holder_country_code,
    f.domain_holder_email
  FROM orders o
  LEFT JOIN order_fulfillment f ON f.order_id = o.id
  WHERE o.id = $1 AND o.draft_id = $2 AND o.package_code = $3 AND o.status = 'pending'`

const UPSERT_FULFILLMENT_SQL = `WITH editable_order AS MATERIALIZED (
    SELECT id FROM orders
    WHERE draft_id = $1 AND package_code = $2 AND status = 'pending'
      AND stripe_checkout_session_id IS NULL
      AND ($3::uuid IS NULL OR id = $3)
    ORDER BY created_at DESC
    LIMIT 1
    FOR UPDATE
  )
  INSERT INTO order_fulfillment (
    order_id, first_name, last_name, billing_street, billing_postal_code, billing_city,
    billing_country_code, communication_email, desired_domain, alternative_domain,
    domain_holder_differs, domain_holder_first_name, domain_holder_last_name,
    domain_holder_street, domain_holder_postal_code, domain_holder_city,
    domain_holder_country_code, domain_holder_email, hostinger_consent_version,
    hostinger_consented_at
  )
  SELECT id, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18,
    $19, $20, $21, $22
  FROM editable_order
  WHERE true
  ON CONFLICT (order_id) DO UPDATE SET
    first_name = EXCLUDED.first_name,
    last_name = EXCLUDED.last_name,
    billing_street = EXCLUDED.billing_street,
    billing_postal_code = EXCLUDED.billing_postal_code,
    billing_city = EXCLUDED.billing_city,
    billing_country_code = EXCLUDED.billing_country_code,
    communication_email = EXCLUDED.communication_email,
    desired_domain = EXCLUDED.desired_domain,
    alternative_domain = EXCLUDED.alternative_domain,
    domain_holder_differs = EXCLUDED.domain_holder_differs,
    domain_holder_first_name = EXCLUDED.domain_holder_first_name,
    domain_holder_last_name = EXCLUDED.domain_holder_last_name,
    domain_holder_street = EXCLUDED.domain_holder_street,
    domain_holder_postal_code = EXCLUDED.domain_holder_postal_code,
    domain_holder_city = EXCLUDED.domain_holder_city,
    domain_holder_country_code = EXCLUDED.domain_holder_country_code,
    domain_holder_email = EXCLUDED.domain_holder_email,
    hostinger_consent_version = EXCLUDED.hostinger_consent_version,
    hostinger_consented_at = EXCLUDED.hostinger_consented_at
  WHERE EXISTS (SELECT 1 FROM editable_order)
  RETURNING order_id`

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
}

function normalizedText(value, field, maxLength, { optional = false } = {}) {
  if (optional && (value === undefined || value === null || value === '')) return null
  if (typeof value !== 'string') throw new HttpError(400, `Invalid ${field}`)

  const unicodeNormalized = value.normalize('NFC')
  if (/[\u0000-\u001f\u007f]/u.test(unicodeNormalized)) throw new HttpError(400, `Invalid ${field}`)

  const normalized = unicodeNormalized.trim()
  if (!normalized && optional) return null
  if (!normalized || Array.from(normalized).length > maxLength) {
    throw new HttpError(400, `Invalid ${field}`)
  }

  return normalized
}

function normalizeCountryCode(value, field) {
  const countryCode = normalizedText(value, field, 2).toUpperCase()
  if (!/^[A-Z]{2}$/.test(countryCode)) throw new HttpError(400, `Invalid ${field}`)
  return countryCode
}

function normalizeEmail(value, field) {
  const email = normalizedText(value, field, 254).toLowerCase()
  if (!EMAIL_PATTERN.test(email)) throw new HttpError(400, `Invalid ${field}`)
  return email
}

function normalizeDomain(value, field, { optional = false } = {}) {
  const domain = normalizedText(value, field, 253, { optional })
  if (domain === null) return null

  const normalized = domain.toLowerCase()
  if (!DOMAIN_PATTERN.test(normalized)) throw new HttpError(400, `Invalid ${field}`)
  return normalized
}

/** Validates and normalizes customer-controlled fields; consent metadata is always server-owned. */
export function validateFulfillmentData(data) {
  if (!isRecord(data) || Object.keys(data).some((key) => !ALLOWED_FIELDS.has(key))) {
    throw new HttpError(400, 'Invalid fulfillment data')
  }

  if (data.hostingerConsent !== true) throw new HttpError(400, 'Hostinger setup consent is required')
  if (typeof data.domainHolderDiffers !== 'boolean') throw new HttpError(400, 'Invalid domain holder details')

  const desiredDomain = normalizeDomain(data.desiredDomain, 'desired domain')
  const alternativeDomain = normalizeDomain(data.alternativeDomain, 'alternative domain', { optional: true })

  if (alternativeDomain === desiredDomain) throw new HttpError(400, 'Alternative domain must differ from desired domain')

  const normalized = {
    first_name: normalizedText(data.firstName, 'first name', 100),
    last_name: normalizedText(data.lastName, 'last name', 100),
    billing_street: normalizedText(data.billingStreet, 'billing street', 200),
    billing_postal_code: normalizedText(data.billingPostalCode, 'billing postal code', 20),
    billing_city: normalizedText(data.billingCity, 'billing city', 100),
    billing_country_code: normalizeCountryCode(data.billingCountryCode, 'billing country code'),
    communication_email: normalizeEmail(data.communicationEmail, 'email address'),
    desired_domain: desiredDomain,
    alternative_domain: alternativeDomain,
    domain_holder_differs: data.domainHolderDiffers,
  }

  const holderFields = [
    ['domain_holder_first_name', 'domainHolderFirstName', 'domain holder first name', 100],
    ['domain_holder_last_name', 'domainHolderLastName', 'domain holder last name', 100],
    ['domain_holder_street', 'domainHolderStreet', 'domain holder street', 200],
    ['domain_holder_postal_code', 'domainHolderPostalCode', 'domain holder postal code', 20],
    ['domain_holder_city', 'domainHolderCity', 'domain holder city', 100],
  ]

  if (data.domainHolderDiffers) {
    for (const [column, field, label, maxLength] of holderFields) {
      normalized[column] = normalizedText(data[field], label, maxLength)
    }

    normalized.domain_holder_country_code = normalizeCountryCode(
      data.domainHolderCountryCode,
      'domain holder country code',
    )
    normalized.domain_holder_email = normalizeEmail(data.domainHolderEmail, 'domain holder email')
  } else {
    const holderInputKeys = [
      'domainHolderFirstName',
      'domainHolderLastName',
      'domainHolderStreet',
      'domainHolderPostalCode',
      'domainHolderCity',
      'domainHolderCountryCode',
      'domainHolderEmail',
    ]
    if (holderInputKeys.some((key) => normalizedText(data[key], key, 254, { optional: true }) !== null)) {
      throw new HttpError(400, 'Domain holder details must be omitted when the holder is not different')
    }

    for (const [column] of holderFields) normalized[column] = null
    normalized.domain_holder_country_code = null
    normalized.domain_holder_email = null
  }

  return normalized
}

async function loadEditableDraft(sql, { draftId, draftToken }) {
  if (typeof draftId !== 'string' || !UUID_PATTERN.test(draftId)) {
    throw new HttpError(400, 'Invalid draft reference')
  }
  if (!isWellFormedToken(draftToken)) throw new HttpError(400, 'Invalid draft token')

  const draft = await loadAuthorizedDraft(sql, { draftId: draftId.toLowerCase(), draftToken })

  if (draft.builder_slug !== 'artist-band') throw new HttpError(404, 'Draft not found')
  if (draft.status !== 'draft') throw new HttpError(409, 'This order is no longer editable')

  return draft
}

function toCustomerData(row) {
  if (!row.first_name) return null

  return {
    firstName: row.first_name,
    lastName: row.last_name,
    billingStreet: row.billing_street,
    billingPostalCode: row.billing_postal_code,
    billingCity: row.billing_city,
    billingCountryCode: row.billing_country_code,
    communicationEmail: row.communication_email,
    desiredDomain: row.desired_domain,
    alternativeDomain: row.alternative_domain,
    domainHolderDiffers: row.domain_holder_differs,
    domainHolderFirstName: row.domain_holder_first_name,
    domainHolderLastName: row.domain_holder_last_name,
    domainHolderStreet: row.domain_holder_street,
    domainHolderPostalCode: row.domain_holder_postal_code,
    domainHolderCity: row.domain_holder_city,
    domainHolderCountryCode: row.domain_holder_country_code,
    domainHolderEmail: row.domain_holder_email,
    hostingerConsent: true,
  }
}

function toFulfillmentColumns(data) {
  return {
    first_name: data.firstName,
    last_name: data.lastName,
    billing_street: data.billingStreet,
    billing_postal_code: data.billingPostalCode,
    billing_city: data.billingCity,
    billing_country_code: data.billingCountryCode,
    communication_email: data.communicationEmail,
    desired_domain: data.desiredDomain,
    alternative_domain: data.alternativeDomain,
    domain_holder_differs: data.domainHolderDiffers,
    domain_holder_first_name: data.domainHolderFirstName ?? null,
    domain_holder_last_name: data.domainHolderLastName ?? null,
    domain_holder_street: data.domainHolderStreet ?? null,
    domain_holder_postal_code: data.domainHolderPostalCode ?? null,
    domain_holder_city: data.domainHolderCity ?? null,
    domain_holder_country_code: data.domainHolderCountryCode ?? null,
    domain_holder_email: data.domainHolderEmail ?? null,
  }
}

/** Loads only an authorized draft's pending Rundum-Sorglos order. */
export async function loadOrderFulfillment({ sql, draftId, draftToken }) {
  const draft = await loadEditableDraft(sql, { draftId, draftToken })
  const [row] = await sql.query(SELECT_FULFILLMENT_SQL, [draft.id, FULFILLMENT_PACKAGE_CODE])

  if (!row) return { data: null }

  return { data: toCustomerData(row) }
}

/** Loads saved customer fields for one authorized pending order, without consent metadata. */
export async function loadOrderFulfillmentForOrder({ sql, draftId, draftToken, orderId }) {
  const draft = await loadEditableDraft(sql, { draftId, draftToken })

  if (typeof orderId !== 'string' || !UUID_PATTERN.test(orderId)) {
    throw new HttpError(400, 'Invalid order reference')
  }

  const [row] = await sql.query(SELECT_FULFILLMENT_FOR_ORDER_SQL, [
    orderId.toLowerCase(),
    draft.id,
    FULFILLMENT_PACKAGE_CODE,
  ])
  return row ? { orderId: row.order_id, data: toCustomerData(row) } : null
}

export function fulfillmentDataMatches(existingData, normalizedData) {
  if (!existingData) return false

  const stored = toFulfillmentColumns(existingData)
  return Object.entries(stored).every(([column, value]) => value === normalizedData[column])
}

/** Inserts or updates fulfillment data only while its authorized order is still pending. */
export async function saveOrderFulfillment({
  sql,
  draftId,
  draftToken,
  data,
  orderId = null,
  returnConflict = false,
}) {
  const draft = await loadEditableDraft(sql, { draftId, draftToken })
  const normalized = validateFulfillmentData(data)
  if (orderId !== null && (typeof orderId !== 'string' || !UUID_PATTERN.test(orderId))) {
    throw new HttpError(400, 'Invalid order reference')
  }
  const values = [
    draft.id,
    FULFILLMENT_PACKAGE_CODE,
    orderId?.toLowerCase() ?? null,
    normalized.first_name,
    normalized.last_name,
    normalized.billing_street,
    normalized.billing_postal_code,
    normalized.billing_city,
    normalized.billing_country_code,
    normalized.communication_email,
    normalized.desired_domain,
    normalized.alternative_domain,
    normalized.domain_holder_differs,
    normalized.domain_holder_first_name,
    normalized.domain_holder_last_name,
    normalized.domain_holder_street,
    normalized.domain_holder_postal_code,
    normalized.domain_holder_city,
    normalized.domain_holder_country_code,
    normalized.domain_holder_email,
    HOSTINGER_CONSENT_VERSION,
    new Date(),
  ]
  let result
  try {
    result = await sql.query(UPSERT_FULFILLMENT_SQL, values)
  } catch {
    throw new Error('Fulfillment storage failed')
  }
  const [saved] = result

  if (!saved) {
    if (returnConflict) return null
    throw new HttpError(409, 'Editable fulfillment order not found')
  }

  return { orderId: saved.order_id }
}
