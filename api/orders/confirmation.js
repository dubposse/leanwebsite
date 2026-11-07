import { loadPaidOrderConfirmation } from '../_lib/downloads.js'
import { getSql } from '../_lib/db.js'
import { HttpError, readJsonBody, sendError } from '../_lib/http.js'
import { sendJson } from '../_lib/json.js'
import { getObject } from '../_lib/storage.js'
import { getStripe } from '../_lib/stripe.js'

export const config = { api: { bodyParser: false } }

export function createOrderConfirmationHandler({
  getDb = getSql,
  storage = { getObject },
  getStripeClient = getStripe,
  siteUrl = process.env.SITE_URL,
} = {}) {
  return async function orderConfirmation(req, res) {
    res.setHeader('Cache-Control', 'private, no-store, max-age=0')
    res.setHeader('Pragma', 'no-cache')
    res.setHeader('Expires', '0')

    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST')
      return sendJson(res, 405, { error: 'Method not allowed' })
    }

    try {
      const body = await readJsonBody(req, 4 * 1024)
      const file = await loadPaidOrderConfirmation({
        sql: getDb(),
        storage,
        stripe: getStripeClient(),
        siteUrl,
        body,
      })

      res.setHeader('Content-Type', 'application/pdf')
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${file.fileName}"; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
      )
      res.setHeader('Content-Length', String(file.size))
      res.setHeader('X-Content-Type-Options', 'nosniff')
      res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'")
      return res.status(200).send(file.body)
    } catch (error) {
      if (error instanceof HttpError && error.code) {
        return sendJson(res, error.statusCode, { error: error.message, code: error.code })
      }

      return sendError(res, error, 'order confirmation', sendJson)
    }
  }
}

export default createOrderConfirmationHandler()
