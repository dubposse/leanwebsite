import { createCheckoutSession, CheckoutError, getSiteUrl, parseCheckoutRequest } from './_lib/checkout.js'
import { getSql } from './_lib/db.js'
import { logError } from './_lib/diagnostics.js'
import { readRawBody, HttpError } from './_lib/http.js'
import { sendJson } from './_lib/json.js'
import { getStripe } from './_lib/stripe.js'

const MAX_BODY_BYTES = 4 * 1024

// The body is read and size-limited manually.
export const config = { api: { bodyParser: false } }

export function createCheckoutHandler({
  getDb = getSql,
  getStripeClient = getStripe,
  resolveSiteUrl = getSiteUrl,
  storage,
  generators,
} = {}) {
  return async function checkout(req, res) {
    res.setHeader('Cache-Control', 'no-store')

    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST')
      return sendJson(res, 405, { error: 'Method not allowed' })
    }

    if (!String(req.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) {
      return sendJson(res, 415, { error: 'Content-Type must be application/json' })
    }

    try {
      let body

      try {
        body = JSON.parse((await readRawBody(req, MAX_BODY_BYTES)).toString('utf8'))
      } catch (error) {
        if (error instanceof HttpError) throw error
        throw new CheckoutError(400, 'Invalid JSON body')
      }

      const request = parseCheckoutRequest(body)

      let dependencies
      let failedStep = 'getDb'

      try {
        const sql = getDb()
        failedStep = 'getStripeClient'
        const stripe = getStripeClient()
        failedStep = 'resolveSiteUrl'
        const siteUrl = resolveSiteUrl()
        dependencies = { sql, stripe, siteUrl }
      } catch {
        console.error(`checkout is not configured: ${failedStep} failed`)
        throw new CheckoutError(500, 'Checkout is not available')
      }

      const { url } = await createCheckoutSession({ ...dependencies, request, ...(storage && { storage }), ...(generators && { generators }) })

      return sendJson(res, 200, { url })
    } catch (error) {
      if (error instanceof HttpError) {
        return sendJson(res, error.statusCode, { error: error.message })
      }

      logError('checkout', error)
      return sendJson(res, 500, { error: 'Checkout failed' })
    }
  }
}

export default createCheckoutHandler()
