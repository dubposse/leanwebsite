import { createHash, randomUUID } from 'node:crypto'
import { draftContentKeyOf, loadAuthorizedDraft, UUID_PATTERN } from './drafts.js'
import { defaultGenerators, renderWebsite } from './generators.js'
import { logError } from './diagnostics.js'
import { HttpError } from './http.js'
import { CURRENCY, getPackage } from './packages.js'
import { getObject, orderSnapshotKey, putObject } from './storage.js'
import { isWellFormedToken } from './tokens.js'
import {
  FULFILLMENT_PACKAGE_CODE,
  fulfillmentDataMatches,
  loadOrderFulfillmentForOrder,
  saveOrderFulfillment,
  validateFulfillmentData,
} from './fulfillment.js'

export class CheckoutError extends HttpError {
  constructor(statusCode, message) {
    super(statusCode, message)
    this.name = 'CheckoutError'
  }
}

const ALLOWED_FIELDS = ['builder', 'package', 'draftId', 'draftToken', 'fulfillmentData']
const CODE_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/

const SELECT_OPEN_ORDERS_SQL = `SELECT id, status, package_code, amount_cents, currency, stripe_checkout_session_id, snapshot_key, snapshot_sha256
  FROM orders WHERE draft_id = $1 AND status IN ('pending', 'paid')`

const INSERT_ORDER_SQL = `INSERT INTO orders (id, draft_id, package_code, amount_cents, currency)
  SELECT $1, d.id, $3, $4, $5 FROM drafts d WHERE d.id = $2 AND d.status = 'draft' RETURNING id`

const FAIL_ORDER_SQL = `UPDATE orders SET status = 'failed' WHERE id = $1 AND status = 'pending' RETURNING id`

const SAVE_SESSION_SQL = `WITH candidate_order AS MATERIALIZED (
    SELECT id, draft_id FROM orders
    WHERE id = $1 AND status = 'pending' AND stripe_checkout_session_id IS NULL
    FOR UPDATE
  ), eligible_draft AS MATERIALIZED (
    SELECT d.id FROM drafts d
    JOIN candidate_order o ON o.draft_id = d.id
    WHERE d.status = 'draft'
    FOR UPDATE OF d
  )
  UPDATE orders SET stripe_checkout_session_id = $2
  WHERE id = $1 AND status = 'pending' AND stripe_checkout_session_id IS NULL
    AND EXISTS (SELECT 1 FROM candidate_order)
    AND EXISTS (SELECT 1 FROM eligible_draft)
  RETURNING id`

const SELECT_ORDER_STATE_SQL = `SELECT status, stripe_checkout_session_id, snapshot_key, snapshot_sha256 FROM orders WHERE id = $1`

// Written once: the immutability trigger and the snapshot_key IS NULL guard both prevent any later change.
const ATTACH_SNAPSHOT_SQL = `UPDATE orders
  SET snapshot_key = $2, snapshot_sha256 = $3, snapshot_size = $4, snapshot_content_type = $5
  WHERE id = $1 AND status = 'pending' AND snapshot_key IS NULL AND stripe_checkout_session_id IS NULL
  RETURNING id`

// Unknown fields (for example an "amount") are rejected instead of silently ignored.
export function parseCheckoutRequest(body) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new CheckoutError(400, 'Invalid request')
  }

  if (Object.keys(body).some((key) => !ALLOWED_FIELDS.includes(key))) {
    throw new CheckoutError(400, 'Invalid request')
  }

  const { builder, package: packageCode, draftId, draftToken } = body

  if (typeof builder !== 'string' || builder.length > 64 || !CODE_PATTERN.test(builder)) {
    throw new CheckoutError(400, 'Invalid builder')
  }

  if (typeof packageCode !== 'string' || packageCode.length > 64 || !CODE_PATTERN.test(packageCode)) {
    throw new CheckoutError(400, 'Invalid package')
  }

  if (typeof draftId !== 'string' || !UUID_PATTERN.test(draftId)) {
    throw new CheckoutError(400, 'Invalid draft reference')
  }

  if (!isWellFormedToken(draftToken)) {
    throw new CheckoutError(400, 'Invalid draft token')
  }

  return {
    builderSlug: builder,
    packageCode,
    draftId: draftId.toLowerCase(),
    draftToken,
    ...(Object.hasOwn(body, 'fulfillmentData') && { fulfillmentData: body.fulfillmentData }),
  }
}

// The base URL comes from configuration, never from request headers.
export function getSiteUrl(env = process.env) {
  const raw = env.SITE_URL?.trim()

  if (!raw) throw new Error('Checkout is not configured. Missing environment variable: SITE_URL')

  let url

  try {
    url = new URL(raw)
  } catch {
    throw new Error('SITE_URL is not a valid URL')
  }

  const isLocal = url.hostname === 'localhost' || url.hostname === '127.0.0.1'

  if (url.protocol !== 'https:' && !(isLocal && url.protocol === 'http:')) {
    throw new Error('SITE_URL must use https')
  }

  return url.origin
}

function resolvePackage(draft, request) {
  if (draft.builder_slug !== request.builderSlug) {
    throw new CheckoutError(400, 'Builder does not match the draft')
  }

  const pkg = getPackage(request.packageCode)

  if (!pkg || pkg.builderSlug !== draft.builder_slug) {
    throw new CheckoutError(400, 'Unknown package for this builder')
  }

  if (!draft.builder_active) throw new CheckoutError(409, 'This builder is currently not available')
  if (draft.status !== 'draft') throw new CheckoutError(409, 'This draft can no longer be purchased')

  return pkg
}

async function callStripe(operation) {
  try {
    return await operation()
  } catch (error) {
    logError('stripe api call', error)
    throw new CheckoutError(502, 'Payment provider unavailable')
  }
}

async function storageCall(operation) {
  try {
    return await operation()
  } catch (error) {
    if (error?.code === 'OBJECT_EXISTS') throw error
    logError('storage call', error)
    throw new CheckoutError(502, 'Storage unavailable')
  }
}

function describeContent({ body, contentType }) {
  return {
    body,
    contentType,
    size: body.byteLength,
    sha256: createHash('sha256').update(body).digest('hex'),
  }
}

function orderCompleteUrl(siteUrl, checkout, builderSlug) {
  const url = new URL('/order/complete', `${siteUrl}/`)
  url.searchParams.set('checkout', checkout)
  url.searchParams.set('builder', builderSlug)
  return url.toString()
}

// The purchasable content: the website HTML generated on the server from the validated draft data. The draft
// is read once; validation, generation and hashing all work on that single copy, so a concurrent save cannot
// slip in between. Browser-supplied HTML is never used.
async function readDraftContent({ storage, draft, generators, year }) {
  const key = draftContentKeyOf(draft)

  if (!key) throw new CheckoutError(409, 'This draft has no saved content yet')

  const object = await storageCall(() => storage.getObject(key))

  if (!object || object.contentType !== 'application/json') {
    throw new CheckoutError(409, 'This draft has no saved content yet')
  }

  let data
  try {
    data = JSON.parse(object.body.toString('utf8'))
  } catch {
    throw new CheckoutError(409, 'The saved draft content is invalid')
  }

  const html = renderWebsite(generators, draft.builder_slug, object.body, year)

  if (draft.builder_slug === 'business') {
    if (!data.company?.name?.trim()) {
      throw new CheckoutError(422, 'Business company name is required')
    }
    if (!data.contact?.email?.trim()) {
      throw new CheckoutError(422, 'Business contact email is required')
    }
  }

  return describeContent({ body: html, contentType: 'text/html' })
}

// Copies the draft content into the order's own immutable object. The conditional write never replaces an
// existing object, so the first writer wins; the database row then records what the object really contains.
// Returns the SHA-256 of the snapshot that is bound to the order.
async function ensureSnapshot({ sql, storage, content }, order) {
  const key = orderSnapshotKey(order.id)
  let stored = content

  try {
    await storageCall(() => storage.putObject(key, content.body, { contentType: content.contentType, overwrite: false }))
  } catch (error) {
    if (error?.code !== 'OBJECT_EXISTS') throw error

    const existing = await storageCall(() => storage.getObject(key))

    if (!existing) throw new CheckoutError(502, 'Storage unavailable')

    stored = describeContent(existing)
  }

  const attached = await sql.query(ATTACH_SNAPSHOT_SQL, [order.id, key, stored.sha256, stored.size, stored.contentType])

  if (attached.length > 0) return stored.sha256

  // A concurrent request attached the snapshot first.
  const [current] = await sql.query(SELECT_ORDER_STATE_SQL, [order.id])

  if (!current || current.status !== 'pending' || current.snapshot_key !== key) {
    throw new CheckoutError(409, 'Checkout was superseded, please try again')
  }

  return current.snapshot_sha256
}

async function failOrder(sql, orderId) {
  await sql.query(FAIL_ORDER_SQL, [orderId])
}

// Reuses, repairs or retires the draft's open order. Returns { url } for a live checkout,
// { order } for an order that still needs a Stripe session, or { order: null } when a new order is needed.
async function settlePendingOrder({ sql, stripe, pkg, content }, pending, { forceRetire = false } = {}) {
  // An order whose snapshot differs from the current draft content must not be reused: the customer
  // would pay for outdated content. An order without snapshot can only be reused while it has no session.
  const sameSnapshot = pending.snapshot_sha256
    ? pending.snapshot_sha256 === content.sha256
    : !pending.stripe_checkout_session_id
  const sameOffer =
    !forceRetire &&
    sameSnapshot &&
    pending.package_code === pkg.code &&
    pending.amount_cents === pkg.amountCents &&
    pending.currency.trim() === CURRENCY

  if (!pending.stripe_checkout_session_id) {
    if (sameOffer) return { order: pending }

    await failOrder(sql, pending.id)
    return { order: null }
  }

  const session = await callStripe(() => stripe.checkout.sessions.retrieve(pending.stripe_checkout_session_id))

  // A finished session may still be awaiting its webhook; the order must stay pending until then.
  if (session.status === 'complete') {
    throw new CheckoutError(409, 'A payment for this draft is already being processed')
  }

  if (session.status === 'open') {
    if (sameOffer && session.url) return { url: session.url }

    try {
      await stripe.checkout.sessions.expire(pending.stripe_checkout_session_id)
    } catch {
      // Most likely the customer just completed the payment; do not touch the order.
      throw new CheckoutError(409, 'A checkout for this draft is currently active, please try again shortly')
    }
  }

  await failOrder(sql, pending.id)
  return { order: null }
}

// The order id doubles as a deterministic Stripe idempotency key: retries after a crash or a failed
// API call return the same session instead of creating another one.
async function ensureSession({ sql, stripe, siteUrl, draft, pkg }, order) {
  const session = await callStripe(() =>
    stripe.checkout.sessions.create(
      {
        mode: 'payment',
        locale: 'de',
        client_reference_id: order.id,
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: CURRENCY.toLowerCase(),
              unit_amount: pkg.amountCents,
              product_data: { name: `${draft.builder_name} – ${pkg.name}` },
            },
          },
        ],
        metadata: { order_id: order.id },
        success_url: orderCompleteUrl(siteUrl, 'success', draft.builder_slug),
        cancel_url: orderCompleteUrl(siteUrl, 'cancelled', draft.builder_slug),
      },
      { idempotencyKey: `leanwebsite-checkout-${order.id}` },
    ),
  )

  if (!session?.id || !session.url) throw new CheckoutError(502, 'Payment provider unavailable')

  // If this write fails the URL is never handed out; a retry gets the same session via the idempotency key.
  const saved = await sql.query(SAVE_SESSION_SQL, [order.id, session.id])

  if (saved.length === 0) {
    const [current] = await sql.query(SELECT_ORDER_STATE_SQL, [order.id])

    if (current?.stripe_checkout_session_id !== session.id) {
      // The order was retired meanwhile; do not leave a payable session behind.
      await stripe.checkout.sessions.expire(session.id).catch(() => {})
      if (current?.status === 'pending' && !current.stripe_checkout_session_id) {
        await failOrder(sql, order.id)
      }
      throw new CheckoutError(409, 'Checkout was superseded, please try again')
    }
  }

  return session.url
}

export async function createCheckoutSession({
  sql,
  stripe,
  siteUrl,
  request,
  storage = { getObject, putObject },
  generators = defaultGenerators,
  year = new Date().getUTCFullYear(),
}) {
  const draft = await loadAuthorizedDraft(sql, request)
  const pkg = resolvePackage(draft, request)
  const requiresFulfillment = pkg.code === FULFILLMENT_PACKAGE_CODE
  if (!requiresFulfillment && Object.hasOwn(request, 'fulfillmentData')) {
    throw new CheckoutError(400, 'Fulfillment data is only accepted for Rundum-Sorglos orders')
  }
  const fulfillmentData = requiresFulfillment ? validateFulfillmentData(request.fulfillmentData) : null
  const content = await readDraftContent({ storage, draft, generators, year })
  const context = { sql, stripe, siteUrl, draft, pkg, storage, content }

  // Several attempts: a concurrent request may win the unique "one pending order per draft" index,
  // and an order bound to outdated content is retired and replaced.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const orders = await sql.query(SELECT_OPEN_ORDERS_SQL, [draft.id])

    if (orders.some((order) => order.status === 'paid')) {
      throw new CheckoutError(409, 'This draft has already been purchased')
    }

    const pending = orders.find((order) => order.status === 'pending')
    let order = null

    if (pending) {
      const savedFulfillment = requiresFulfillment
        ? await loadOrderFulfillmentForOrder({ sql, draftId: draft.id, draftToken: request.draftToken, orderId: pending.id })
        : null
      const fulfillmentMatches = requiresFulfillment
        ? savedFulfillment?.data && fulfillmentDataMatches(savedFulfillment.data, fulfillmentData)
        : true
      const settled = await settlePendingOrder(context, pending, {
        forceRetire: Boolean(requiresFulfillment && pending.stripe_checkout_session_id && !fulfillmentMatches),
      })

      if (settled.url) {
        if (requiresFulfillment) {
          const current = await loadOrderFulfillmentForOrder({
            sql,
            draftId: draft.id,
            draftToken: request.draftToken,
            orderId: pending.id,
          })
          if (!fulfillmentDataMatches(current?.data, fulfillmentData)) {
            throw new CheckoutError(409, 'Checkout was superseded, please try again')
          }
        }
        return { url: settled.url }
      }

      order = settled.order
    }

    if (!order) {
      try {
        const id = randomUUID()
        const [created] = await sql.query(INSERT_ORDER_SQL, [id, draft.id, pkg.code, pkg.amountCents, CURRENCY])
        if (!created) throw new CheckoutError(409, 'This draft can no longer be purchased')
        order = { id }
      } catch (error) {
        if (error?.code === '23505') continue
        throw error
      }
    }

    if (requiresFulfillment) {
      const saved = await saveOrderFulfillment({
        sql,
        draftId: draft.id,
        draftToken: request.draftToken,
        orderId: order.id,
        data: request.fulfillmentData,
        returnConflict: true,
      })
      if (!saved) continue
    }

    if (!order.snapshot_key) {
      const snapshotSha256 = await ensureSnapshot(context, order)

      if (snapshotSha256 !== content.sha256) {
        // Another request stored different (older) content for this order first; start over with a fresh order.
        await failOrder(sql, order.id)
        continue
      }
    }

    // The session is created only after the snapshot is stored and referenced by the order.
    const url = await ensureSession(context, order)
    if (requiresFulfillment) {
      const current = await loadOrderFulfillmentForOrder({
        sql,
        draftId: draft.id,
        draftToken: request.draftToken,
        orderId: order.id,
      })
      if (!fulfillmentDataMatches(current?.data, fulfillmentData)) {
        throw new CheckoutError(409, 'Checkout was superseded, please try again')
      }
    }
    return { url }
  }

  throw new CheckoutError(409, 'A checkout for this draft is already in progress')
}
