import { createHash } from 'node:crypto'
import { loadAuthorizedDraft, UUID_PATTERN } from './drafts.js'
import { HttpError } from './http.js'
import { getPackage } from './packages.js'
import { getSql } from './db.js'
import { assertValidKey, getObject, orderSnapshotKey } from './storage.js'

// The paid order of a draft is found via orders.draft_id after the draft credentials were verified.
// A paid order wins over older failed or pending ones; the status comes only from the webhook-written column.
const SELECT_DOWNLOAD_ORDER_SQL = `SELECT o.id, o.status, o.package_code, o.paid_at, o.snapshot_key,
    o.snapshot_sha256, o.snapshot_size, o.snapshot_content_type
  FROM orders o WHERE o.draft_id = $1
  ORDER BY (o.status = 'paid') DESC, o.created_at DESC
  LIMIT 1`

export const DOWNLOAD_FILE_NAME = 'website.html'

// Services that cannot be fulfilled by the file alone must not be presented as completed by the download.
const MANAGED_NOTICE =
  'Der Download enthält deine HTML-Website. Hosting und Betreuung aus „Rundum sorglos“ sind damit noch nicht eingerichtet; wir melden uns dazu separat.'
const DOWNLOAD_NOTICE = 'Dein Paket umfasst die HTML-Website als Download.'

export class DownloadError extends HttpError {
  constructor(statusCode, message, code) {
    super(statusCode, message)
    this.code = code
  }
}

function parseCredentials(body) {
  const draftId = typeof body?.draftId === 'string' ? body.draftId.toLowerCase() : ''
  const draftToken = body?.draftToken

  if (!UUID_PATTERN.test(draftId) || typeof draftToken !== 'string') {
    throw new HttpError(404, 'Order not found')
  }

  return { draftId, draftToken }
}

function describePackage(code) {
  const item = getPackage(code)

  if (!item) return null

  const managed = item.code.endsWith('-rundum-sorglos')
  return { code: item.code, name: item.name, notice: managed ? MANAGED_NOTICE : DOWNLOAD_NOTICE }
}

async function loadOrder(sql, body) {
  const { draftId, draftToken } = parseCredentials(body)
  const draft = await loadAuthorizedDraft(sql, { draftId, draftToken })
  const [order] = await sql.query(SELECT_DOWNLOAD_ORDER_SQL, [draft.id])

  return order ?? null
}

/** Order status for the completion page. Reveals neither storage keys nor checksums. */
export async function getOrderStatus({ sql = getSql(), body }) {
  const order = await loadOrder(sql, body)

  if (!order) return { status: 'none', downloadAvailable: false }

  const paid = order.status === 'paid' && Boolean(order.snapshot_key)

  return {
    status: order.status,
    downloadAvailable: paid,
    package: describePackage(order.package_code),
    ...(paid && order.paid_at && { paidAt: new Date(order.paid_at).toISOString() }),
  }
}

/** Returns { body, fileName, size, sha256 } of the verified snapshot or throws. */
export async function loadPaidSnapshot({ sql = getSql(), storage = { getObject }, body }) {
  const order = await loadOrder(sql, body)

  if (!order) throw new DownloadError(404, 'Order not found', 'order_not_found')
  if (order.status !== 'paid') throw new DownloadError(402, 'Payment is not confirmed', 'not_paid')

  // The key is never taken from the client and must be exactly the one derived from this order's id.
  let key

  try {
    key = assertValidKey(order.snapshot_key)
    if (key !== orderSnapshotKey(order.id)) throw new Error('foreign key')
  } catch {
    throw new DownloadError(409, 'Snapshot is not available', 'snapshot_unavailable')
  }

  if (!/^[0-9a-f]{64}$/.test(order.snapshot_sha256 ?? '') || !Number.isInteger(order.snapshot_size)) {
    throw new DownloadError(409, 'Snapshot is not available', 'snapshot_unavailable')
  }

  const object = await storage.getObject(key)

  if (!object) throw new DownloadError(409, 'Snapshot is not available', 'snapshot_unavailable')

  const content = Buffer.from(object.body)
  const sha256 = createHash('sha256').update(content).digest('hex')

  if (content.byteLength !== order.snapshot_size || sha256 !== order.snapshot_sha256) {
    throw new DownloadError(409, 'Snapshot failed the integrity check', 'snapshot_corrupt')
  }

  return { body: content, fileName: DOWNLOAD_FILE_NAME, size: content.byteLength, sha256 }
}
