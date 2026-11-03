import Stripe from 'stripe'

// Server-side only. The secret key never leaves the API layer.
let client

export function getStripe() {
  if (!client) {
    const secretKey = process.env.STRIPE_SECRET_KEY?.trim()

    if (!secretKey) {
      throw new Error('Stripe is not configured. Missing environment variable: STRIPE_SECRET_KEY')
    }

    client = new Stripe(secretKey, { maxNetworkRetries: 2 })
  }

  return client
}

export function getWebhookSecret(env = process.env) {
  const secret = env.STRIPE_WEBHOOK_SECRET?.trim()

  if (!secret) {
    throw new Error('Stripe webhook is not configured. Missing environment variable: STRIPE_WEBHOOK_SECRET')
  }

  return secret
}

// Verifies the signature against the unmodified raw body; throws if invalid or outside the tolerance window.
export function constructWebhookEvent(rawBody, signature, webhookSecret) {
  return Stripe.webhooks.constructEvent(rawBody, signature, webhookSecret)
}
