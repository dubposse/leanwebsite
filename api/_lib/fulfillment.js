import { loadAuthorizedDraft, UUID_PATTERN } from './drafts.js'
import { HttpError } from './http.js'
import { isWellFormedToken } from './tokens.js'
import { HOSTINGER_CONSENT_VERSION } from '../../shared/hostinger-consent.js'

// Checkout currently creates orders together with a Stripe session; these helpers require that pending order.
export const FULFILLMENT_PACKAGE_CODE = 'artist-band-rundum-sorglos'
export const BUSINESS_FULFILLMENT_PACKAGE_CODE = 'business-rundum-sorglos'
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
  'customerType',
  'companyName',
  'domainHolderType',
  'domainHolderOrganizationName',
  'hostingerConsent',
])

const SELECT_FULFILLMENT_SQL = `SELECT o.id AS order_id, f.first_name, f.last_name,
    f.billing_street, f.billing_postal_code, f.billing_city, f.billing_country_code,
    f.communication_email, f.desired_domain, f.alternative_domain, f.domain_holder_differs,
    f.domain_holder_first_name, f.domain_holder_last_name, f.domain_holder_street,
    f.domain_holder_postal_code, f.domain_holder_city, f.domain_holder_country_code,
    f.domain_holder_email, f.customer_type, f.company_name, f.domain_holder_type,
    f.domain_holder_organization_name
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
    f.domain_holder_email, f.customer_type, f.company_name, f.domain_holder_type,
    f.domain_holder_organization_name
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
    domain_holder_country_code, domain_holder_email, customer_type, company_name,
    domain_holder_type, domain_holder_organization_name, hostinger_consent_version,
    hostinger_consented_at
  )
  SELECT id, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18,
    $19, $20, $21, $22, $23, $24, $25, $26
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
    customer_type = EXCLUDED.customer_type,
    company_name = EXCLUDED.company_name,
    domain_holder_type = EXCLUDED.domain_holder_type,
    domain_holder_organization_name = EXCLUDED.domain_holder_organization_name,
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
export function validateFulfillmentData(data, packageCode = FULFILLMENT_PACKAGE_CODE) {
  if (!isRecord(data) || Object.keys(data).some((key) => !ALLOWED_FIELDS.has(key))) {
    throw new HttpError(400, 'Invalid fulfillment data')
  }

  if (packageCode !== FULFILLMENT_PACKAGE_CODE && packageCode !== BUSINESS_FULFILLMENT_PACKAGE_CODE) {
    throw new HttpError(400, 'Invalid fulfillment package')
  }

  const isBusiness = packageCode === BUSINESS_FULFILLMENT_PACKAGE_CODE
  if (data.hostingerConsent !== true) throw new HttpError(400, 'Hostinger setup consent is required')
  if (typeof data.domainHolderDiffers !== 'boolean') throw new HttpError(400, 'Invalid domain holder details')

  let customerType = null
  let companyName = null
  if (isBusiness) {
    if (data.customerType !== 'company' && data.customerType !== 'self_employed') {
      throw new HttpError(400, 'Invalid customer type')
    }
    customerType = data.customerType
    companyName = normalizedText(data.companyName, 'company name', 200, { optional: true })
    if (customerType === 'company' && companyName === null) {
      throw new HttpError(400, 'Company name is required')
    }
    if (customerType === 'self_employed' && companyName !== null) {
      throw new HttpError(400, 'Company name is not allowed for self-employed customers')
    }
  } else if (
    data.customerType !== undefined
    || data.companyName !== undefined
    || data.domainHolderType !== undefined
    || data.domainHolderOrganizationName !== undefined
  ) {
    throw new HttpError(400, 'Business fulfillment fields are not allowed for this package')
  }

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
  if (isBusiness) {
    normalized.customer_type = customerType
    normalized.company_name = companyName
  }

  const holderFields = [
    ['domain_holder_first_name', 'domainHolderFirstName', 'domain holder first name', 100],
    ['domain_holder_last_name', 'domainHolderLastName', 'domain holder last name', 100],
    ['domain_holder_street', 'domainHolderStreet', 'domain holder street', 200],
    ['domain_holder_postal_code', 'domainHolderPostalCode', 'domain holder postal code', 20],
    ['domain_holder_city', 'domainHolderCity', 'domain holder city', 100],
  ]

  if (data.domainHolderDiffers) {
    if (isBusiness) {
      if (data.domainHolderType !== 'person' && data.domainHolderType !== 'organization') {
        throw new HttpError(400, 'Invalid domain holder type')
      }
      normalized.domain_holder_type = data.domainHolderType
      normalized.domain_holder_organization_name = data.domainHolderType === 'organization'
        ? normalizedText(data.domainHolderOrganizationName, 'domain holder organization name', 200)
        : null
      if (data.domainHolderType === 'person' && normalizedText(
        data.domainHolderOrganizationName,
        'domain holder organization name',
        200,
        { optional: true },
      ) !== null) {
        throw new HttpError(400, 'Organization name is not allowed for a person domain holder')
      }
    }

    for (const [column, field, label, maxLength] of holderFields) {
      if (isBusiness && data.domainHolderType === 'organization'
        && (column === 'domain_holder_first_name' || column === 'domain_holder_last_name')) {
        normalized[column] = null
        if (normalizedText(data[field], label, maxLength, { optional: true }) !== null) {
          throw new HttpError(400, 'Person name is not allowed for an organization domain holder')
        }
      } else {
        normalized[column] = normalizedText(data[field], label, maxLength)
      }
    }

    normalized.domain_holder_country_code = normalizeCountryCode(
      data.domainHolderCountryCode,
      'domain holder country code',
    )
    normalized.domain_holder_email = normalizeEmail(data.domainHolderEmail, 'domain holder email')
  } else {
    const holderInputKeys = [
      'domainHolderType',
      'domainHolderOrganizationName',
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
    if (isBusiness) {
      normalized.domain_holder_type = null
      normalized.domain_holder_organization_name = null
    }
  }

  return normalized
}

async function loadEditableDraft(sql, { draftId, draftToken }) {
  if (typeof draftId !== 'string' || !UUID_PATTERN.test(draftId)) {
    throw new HttpError(400, 'Invalid draft reference')
  }
  if (!isWellFormedToken(draftToken)) throw new HttpError(400, 'Invalid draft token')

  const draft = await loadAuthorizedDraft(sql, { draftId: draftId.toLowerCase(), draftToken })

  if (draft.builder_slug !== 'artist-band' && draft.builder_slug !== 'business') {
    throw new HttpError(404, 'Draft not found')
  }
  if (draft.status !== 'draft') throw new HttpError(409, 'This order is no longer editable')

  return draft
}

function fulfillmentPackageForDraft(draft) {
  return draft.builder_slug === 'business'
    ? BUSINESS_FULFILLMENT_PACKAGE_CODE
    : FULFILLMENT_PACKAGE_CODE
}

function toCustomerData(row) {
  if (!row.first_name) return null

  const data = {
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
  if (row.customer_type !== null && row.customer_type !== undefined) {
    data.customerType = row.customer_type
    data.companyName = row.company_name
    data.domainHolderType = row.domain_holder_type
    data.domainHolderOrganizationName = row.domain_holder_organization_name
  }
  return data
}

function toFulfillmentColumns(data) {
  return {
    customer_type: data.customerType ?? null,
    company_name: data.companyName ?? null,
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
    domain_holder_type: data.domainHolderType ?? null,
    domain_holder_organization_name: data.domainHolderOrganizationName ?? null,
  }
}

/** Loads only an authorized draft's pending Rundum-Sorglos order. */
export async function loadOrderFulfillment({ sql, draftId, draftToken }) {
  const draft = await loadEditableDraft(sql, { draftId, draftToken })
  const [row] = await sql.query(SELECT_FULFILLMENT_SQL, [draft.id, fulfillmentPackageForDraft(draft)])

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
    fulfillmentPackageForDraft(draft),
  ])
  return row ? { orderId: row.order_id, data: toCustomerData(row) } : null
}

export function fulfillmentDataMatches(existingData, normalizedData) {
  if (!existingData) return false

  const stored = toFulfillmentColumns(existingData)
  return Object.entries(stored).every(([column, value]) => value === (normalizedData[column] ?? null))
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
  const packageCode = fulfillmentPackageForDraft(draft)
  const normalized = validateFulfillmentData(data, packageCode)
  if (orderId !== null && (typeof orderId !== 'string' || !UUID_PATTERN.test(orderId))) {
    throw new HttpError(400, 'Invalid order reference')
  }
  const values = [
    draft.id,
    packageCode,
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
    normalized.customer_type ?? null,
    normalized.company_name ?? null,
    normalized.domain_holder_type ?? null,
    normalized.domain_holder_organization_name ?? null,
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
