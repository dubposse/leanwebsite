import { getSql } from './_lib/db.js'
import { logError } from './_lib/diagnostics.js'
import { readRawBody } from './_lib/http.js'
import { sendJson } from './_lib/json.js'
import { constructWebhookEvent, getWebhookSecret } from './_lib/stripe.js'
import { HANDLED_EVENT_TYPES, processStripeEvent } from './_lib/stripe-events.js'

const MAX_BODY_BYTES = 1024 * 1024

// Signature verification needs the exact bytes Stripe sent, so Vercel's body parser must stay off.
export const config = { api: { bodyParser: false } }

export function createStripeWebhookHandler({ getSecret = getWebhookSecret, getDb = getSql } = {}) {
  return async function stripeWebhook(req, res) {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST')
      return sendJson(res, 405, { error: 'Method not allowed' })
    }

    let webhookSecret

    try {
      webhookSecret = getSecret()
    } catch {
      console.error('Stripe webhook secret is not configured')
      return sendJson(res, 500, { error: 'Webhook is not configured' })
    }

    const signature = req.headers['stripe-signature']

    if (typeof signature !== 'string' || signature.length === 0) {
      return sendJson(res, 400, { error: 'Missing signature' })
    }

    let rawBody

    try {
      rawBody = await readRawBody(req, MAX_BODY_BYTES)
    } catch {
      return sendJson(res, 400, { error: 'Invalid request body' })
    }

    let event

    try {
      event = constructWebhookEvent(rawBody, signature, webhookSecret)
    } catch {
      return sendJson(res, 400, { error: 'Invalid signature' })
    }

    if (!HANDLED_EVENT_TYPES.includes(event.type)) {
      return sendJson(res, 200, { received: true })
    }

    try {
      const result = await processStripeEvent(event, getDb())

      // Only identifiers and fixed reason codes are logged, never payloads or customer data.
      console.info(`stripe event ${event.id} (${event.type}): ${result.outcome}`)

      if (result.reviewReason) {
        console.error(
          `stripe event ${event.id} needs review: ${result.reviewReason}${result.orderId ? ` (order ${result.orderId})` : ''}`,
        )
      }

      return sendJson(res, 200, { received: true })
    } catch (error) {
      logError(`stripe event ${event.id} (${event.type})`, error)
      return sendJson(res, 500, { error: 'Processing failed' })
    }
  }
}

export default createStripeWebhookHandler()
