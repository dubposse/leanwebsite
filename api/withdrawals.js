import { getSql } from './_lib/db.js'
import { HttpError, readJsonBody } from './_lib/http.js'
import { sendJson } from './_lib/json.js'

const MAX_BODY_BYTES = 8 * 1024
const ALLOWED_FIELDS = new Set(['customerName', 'customerEmail', 'orderReference', 'message', 'website'])
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export const config = { api: { bodyParser: false } }

export function validateWithdrawalInput(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.getPrototypeOf(body) !== Object.prototype) {
    throw new HttpError(400, 'Invalid request')
  }
  if (Object.keys(body).some((key) => !ALLOWED_FIELDS.has(key))) {
    throw new HttpError(400, 'Invalid request')
  }
  if (body.website !== undefined && (typeof body.website !== 'string' || body.website.trim())) {
    throw new HttpError(400, 'Invalid request')
  }

  const normalize = (value, { required = false, maxLength, field }) => {
    if (value === undefined || value === null) {
      if (required) throw new HttpError(400, `Bitte gib ${field} ein.`)
      return null
    }
    if (typeof value !== 'string') throw new HttpError(400, 'Invalid request')

    const trimmed = value.trim()
    if ((required && !trimmed) || trimmed.length > maxLength || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(trimmed)) {
      throw new HttpError(400, `Bitte prüfe ${field}.`)
    }
    return trimmed || null
  }

  const customerName = normalize(body.customerName, { required: true, maxLength: 200, field: 'your name' })
  const customerEmail = normalize(body.customerEmail, { required: true, maxLength: 254, field: 'your email address' })
  const orderReference = normalize(body.orderReference, { maxLength: 200, field: 'order reference' })
  const message = normalize(body.message, { maxLength: 5000, field: 'additional information' })

  if (!EMAIL_PATTERN.test(customerEmail)) throw new HttpError(400, 'Bitte gib eine gültige E-Mail-Adresse ein.')

  return { customerName, customerEmail, orderReference, message }
}

function isSameOriginRequest(req) {
  const fetchSite = String(req.headers['sec-fetch-site'] ?? '').toLowerCase()
  if (fetchSite === 'cross-site') return false

  const origin = req.headers.origin
  if (!origin) return true

  const host = req.headers.host
  if (!host) return false

  try {
    return new URL(origin).host.toLowerCase() === String(host).toLowerCase()
  } catch {
    return false
  }
}

export function createWithdrawalsHandler({ getDb = getSql } = {}) {
  return async function withdrawals(req, res) {
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('X-Content-Type-Options', 'nosniff')

    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST')
      return sendJson(res, 405, { error: 'Method not allowed' })
    }

    if (!isSameOriginRequest(req)) {
      return sendJson(res, 403, { error: 'Request not allowed' })
    }

    try {
      if (!/^application\/json(?:\s*;|$)/i.test(String(req.headers['content-type'] ?? ''))) {
        return sendJson(res, 415, { error: 'Content-Type must be application/json' })
      }

      const body = await readJsonBody(req, MAX_BODY_BYTES)
      const input = validateWithdrawalInput(body)
      const [row] = await getDb()`INSERT INTO withdrawals (
        customer_name, customer_email, order_reference, message
      ) VALUES (
        ${input.customerName}, ${input.customerEmail}, ${input.orderReference}, ${input.message}
      ) RETURNING id, received_at`

      if (!row?.id || !row?.received_at) throw new Error('Withdrawal insert returned no record')

      const receivedAt = new Date(row.received_at)
      if (Number.isNaN(receivedAt.getTime())) throw new Error('Withdrawal insert returned an invalid timestamp')

      return sendJson(res, 201, {
        withdrawalId: row.id,
        receivedAt: receivedAt.toISOString(),
      })
    } catch (error) {
      if (error instanceof HttpError) {
        return sendJson(res, error.statusCode, { error: error.message })
      }

      console.error('withdrawal submission failed')
      return sendJson(res, 500, { error: 'Deine Widerrufserklärung konnte nicht übermittelt werden. Bitte versuche es später erneut.' })
    }
  }
}

export default createWithdrawalsHandler()
