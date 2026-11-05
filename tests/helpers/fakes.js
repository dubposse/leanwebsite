import { Readable } from 'node:stream'
import { BuilderValidationError, escapeHtml } from '../../api/_lib/generators.js'

// In-memory stand-ins for the Neon client and the Stripe SDK. The fake DB recognises the application's
// statements by distinctive fragments and mirrors the constraints the migrations add.
export const BUILDER = { id: 'b1', slug: 'artist-band', name: 'Artist & Band', active: true }

export function createFakeDb() {
  const db = {
    builders: [{ ...BUILDER }],
    drafts: [],
    orders: [],
    fulfillments: new Map(),
    events: new Map(),
    failNextWrite: false,
    failFulfillmentWrite: false,
    queries: [],
  }

  const failIfRequested = () => {
    if (db.failNextWrite) {
      db.failNextWrite = false
      throw new Error('simulated database failure')
    }
  }

  db.query = async (text, params = []) => {
    db.queries.push(text)

    if (text.includes('WITH paid AS')) {
      failIfRequested()
      const [id, amount, currency, intent, email, eventId, eventType] = params
      const order = db.orders.find(
        (o) =>
          o.id === id && o.status === 'pending' && o.amount_cents === amount && o.currency === currency && o.snapshot_key,
      )

      if (order) {
        order.status = 'paid'
        order.paid_at = new Date()
        order.stripe_payment_intent_id ??= intent
        order.customer_email ??= email
        const draft = db.drafts.find((d) => d.id === order.draft_id)
        if (draft?.status === 'draft') draft.status = 'locked'
      }

      if (db.events.has(eventId)) return []

      const outcome = order ? 'paid' : 'unchanged'
      db.events.set(eventId, {
        type: eventType,
        order_id: id,
        outcome,
        review_reason: order ? null : 'order_changed_concurrently',
        processed_at: new Date(),
      })
      return [{ outcome }]
    }

    if (text.includes('INSERT INTO stripe_events')) {
      failIfRequested()
      const [id, type, orderId, outcome, reviewReason] = params

      if (!db.events.has(id)) {
        db.events.set(id, { type, order_id: orderId, outcome, review_reason: reviewReason, processed_at: new Date() })
      }

      return []
    }

    if (text.includes('FROM stripe_events WHERE id')) {
      const event = db.events.get(params[0])
      return event ? [{ processed_at: event.processed_at }] : []
    }

    if (text.includes('FROM orders WHERE stripe_checkout_session_id')) {
      return db.orders.filter((o) => o.stripe_checkout_session_id === params[0]).map((o) => ({ ...o }))
    }

    if (text.includes('WITH editable_order AS MATERIALIZED')) {
      if (db.failFulfillmentWrite) {
        db.failFulfillmentWrite = false
        throw new Error('simulated fulfillment failure')
      }

      const [draftId, packageCode, orderId] = params
      const order = db.orders.find(
        (o) =>
          o.draft_id === draftId &&
          o.package_code === packageCode &&
          o.status === 'pending' &&
          !o.stripe_checkout_session_id &&
          (!orderId || o.id === orderId),
      )
      if (!order) return []

      const fulfillment = {}
      const columns = [
        'first_name',
        'last_name',
        'billing_street',
        'billing_postal_code',
        'billing_city',
        'billing_country_code',
        'communication_email',
        'desired_domain',
        'alternative_domain',
        'domain_holder_differs',
        'domain_holder_first_name',
        'domain_holder_last_name',
        'domain_holder_street',
        'domain_holder_postal_code',
        'domain_holder_city',
        'domain_holder_country_code',
        'domain_holder_email',
        'customer_type',
        'company_name',
        'domain_holder_type',
        'domain_holder_organization_name',
        'hostinger_consent_version',
        'hostinger_consented_at',
      ]
      columns.forEach((column, index) => {
        fulfillment[column] = params[index + 3]
      })
      fulfillment.fulfillment_status = db.fulfillments.get(order.id)?.fulfillment_status ?? 'pending'
      db.fulfillments.set(order.id, fulfillment)
      return [{ order_id: order.id }]
    }

    if (text.includes('LEFT JOIN order_fulfillment')) {
      const explicitOrder = text.includes('WHERE o.id = $1')
      const [first, second, packageCode] = params
      const order = explicitOrder
        ? db.orders.find(
            (o) =>
              o.id === first &&
              o.draft_id === second &&
              o.package_code === packageCode &&
              o.status === 'pending',
          )
        : db.orders
            .filter((o) => o.draft_id === first && o.package_code === second && o.status === 'pending')
            .sort((a, b) => b.created_at - a.created_at)[0]
      if (!order) return []

      return [{ order_id: order.id, ...(db.fulfillments.get(order.id) ?? {}) }]
    }

    if (text.includes('FROM order_fulfillment WHERE order_id')) {
      const fulfillment = db.fulfillments.get(params[0])
      return fulfillment ? [{ ...fulfillment }] : []
    }

    if (text.includes('FROM drafts d JOIN builders')) {
      const draft = db.drafts.find((d) => d.id === params[0])
      const builder = draft && db.builders.find((b) => b.id === draft.builder_id)

      return draft
        ? [
            {
              id: draft.id,
              status: draft.status,
              storage_key: draft.storage_key ?? null,
              updated_at: draft.updated_at ?? new Date('2026-01-01T00:00:00Z'),
              access_token_hash: draft.access_token_hash,
              builder_slug: builder.slug,
              builder_name: builder.name,
              builder_active: builder.active,
            },
          ]
        : []
    }

    if (text.includes('FROM orders o WHERE o.draft_id')) {
      const own = db.orders.filter((o) => o.draft_id === params[0])
      const ranked = [...own.filter((o) => o.status === 'paid'), ...own.filter((o) => o.status !== 'paid').reverse()]

      return ranked.slice(0, 1).map((o) => ({ ...o }))
    }

    if (text.includes('FROM orders WHERE draft_id')) {
      return db.orders.filter((o) => o.draft_id === params[0] && ['pending', 'paid'].includes(o.status)).map((o) => ({ ...o }))
    }

    if (text.includes('INSERT INTO orders')) {
      failIfRequested()
      const [id, draftId, packageCode, amountCents, currency] = params
      const draft = db.drafts.find((item) => item.id === draftId && item.status === 'draft')

      if (!draft) return []
      if (db.orders.some((o) => o.draft_id === draftId && o.status === 'pending')) {
        throw Object.assign(new Error('duplicate key value violates unique constraint'), { code: '23505' })
      }

      db.orders.push({
        id,
        draft_id: draftId,
        package_code: packageCode,
        amount_cents: amountCents,
        currency,
        status: 'pending',
        stripe_checkout_session_id: null,
        snapshot_key: null,
        snapshot_sha256: null,
        snapshot_size: null,
        snapshot_content_type: null,
        stripe_payment_intent_id: null,
        customer_email: null,
        paid_at: null,
      })
      return [{ id }]
    }

    if (text.includes('INSERT INTO drafts')) {
      failIfRequested()
      const builder = db.builders.find((b) => b.slug === params[0] && b.active)

      if (!builder) return []

      const id = `00000000-0000-4000-8000-${String(db.drafts.length + 1).padStart(12, '0')}`
      db.drafts.push({ id, builder_id: builder.id, status: 'draft', access_token_hash: params[1], storage_key: null })
      return [{ id }]
    }

    if (text.includes('UPDATE drafts SET storage_key')) {
      const draft = db.drafts.find((d) => d.id === params[0] && d.status === 'draft')

      if (!draft) return []

      draft.storage_key = params[1]
      return [{ id: draft.id }]
    }

    if (text.includes('SET snapshot_key')) {
      failIfRequested()
      const order = db.orders.find(
        (o) => o.id === params[0] && o.status === 'pending' && !o.snapshot_key && !o.stripe_checkout_session_id,
      )

      if (!order) return []

      ;[, order.snapshot_key, order.snapshot_sha256, order.snapshot_size, order.snapshot_content_type] = params
      return [{ id: order.id }]
    }

    if (text.includes('SET stripe_checkout_session_id')) {
      const order = db.orders.find((o) => o.id === params[0] && o.status === 'pending' && !o.stripe_checkout_session_id)
      const draft = order && db.drafts.find((d) => d.id === order.draft_id && d.status === 'draft')

      if (!order || !draft) return []

      // Mirrors orders_session_requires_snapshot.
      if (!order.snapshot_key) throw new Error('violates check constraint orders_session_requires_snapshot')
      failIfRequested()

      order.stripe_checkout_session_id = params[1]
      return [{ id: order.id }]
    }

    if (text.includes("SET status = 'failed'")) {
      const order = db.orders.find((o) => o.id === params[0] && o.status === 'pending')

      if (!order) return []

      order.status = 'failed'
      return [{ id: order.id }]
    }

    if (text.includes('SELECT status, stripe_checkout_session_id')) {
      const order = db.orders.find((o) => o.id === params[0])
      return order ? [{ ...order }] : []
    }

    throw new Error(`unexpected statement: ${text.slice(0, 60)}`)
  }

  return db
}

export function createFakeStripe() {
  const sessions = new Map()
  const byIdempotencyKey = new Map()
  const stripe = {
    sessions,
    createCalls: 0,
    failCreate: false,
    failExpire: false,
    checkout: {
      sessions: {
        async create(params, options) {
          stripe.createCalls += 1

          if (stripe.failCreate) throw Object.assign(new Error('stripe down'), { type: 'StripeConnectionError' })

          const existing = byIdempotencyKey.get(options.idempotencyKey)

          if (existing) {
            if (JSON.stringify(existing.params) !== JSON.stringify(params)) throw new Error('idempotency mismatch')
            return existing.session
          }

          const id = `cs_test_${sessions.size + 1}`
          const session = { id, url: `https://checkout.stripe.com/c/pay/${id}`, status: 'open', params, options }
          sessions.set(id, session)
          byIdempotencyKey.set(options.idempotencyKey, { params, session })
          return session
        },
        async retrieve(id) {
          return sessions.get(id)
        },
        async expire(id) {
          if (stripe.failExpire) throw new Error('cannot expire')
          sessions.get(id).status = 'expired'
          return sessions.get(id)
        },
      },
    },
  }

  return stripe
}

export function buildRequest(body, { method = 'POST', headers = {} } = {}) {
  const raw = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body)
  return Object.assign(Readable.from([Buffer.from(raw)]), { method, headers })
}

export function buildResponse() {
  return {
    statusCode: 0,
    headers: {},
    body: null,
    setHeader(name, value) {
      this.headers[name] = value
    },
    status(code) {
      this.statusCode = code
      return this
    },
    json(payload) {
      this.body = payload
      return this
    },
    send(payload) {
      this.body = payload
      return this
    },
  }
}

// In-memory R2 stand-in. Honours the conditional write (overwrite: false) like the real bucket.
export function createFakeStorage() {
  const objects = new Map()
  const storage = {
    objects,
    putCalls: 0,
    failPut: false,
    failGet: false,
    async putObject(key, body, { contentType = 'application/octet-stream', overwrite = true } = {}) {
      storage.putCalls += 1

      if (storage.failPut) throw new Error('simulated storage failure')

      if (!overwrite && objects.has(key)) throw Object.assign(new Error('Object already exists'), { code: 'OBJECT_EXISTS' })

      objects.set(key, { body: Buffer.from(body), contentType })
      return { key }
    },
    async getObject(key) {
      if (storage.failGet) throw new Error('simulated storage failure')

      const object = objects.get(key)
      return object ? { key, body: Buffer.from(object.body), contentType: object.contentType } : null
    },
  }

  return storage
}

// Deterministic test builder; real builders are integrated separately.
export function createTestGenerators() {
  const generator = {
    validate(input) {
      if (!input || !Array.isArray(input.pages) || input.pages.some((page) => typeof page !== 'string' || page.length > 20)) {
        throw new BuilderValidationError('Invalid pages')
      }

      return { pages: input.pages }
    },
    generateHtml: (data) => `<!doctype html><title>${escapeHtml(data.pages.join(','))}</title>`,
  }

  return { 'artist-band': generator }
}

export const htmlFor = (pages) => Buffer.from(createTestGenerators()['artist-band'].generateHtml({ pages }))
