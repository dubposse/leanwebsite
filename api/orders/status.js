import { getOrderStatus } from '../_lib/downloads.js'
import { getSql } from '../_lib/db.js'
import { readJsonBody, sendError } from '../_lib/http.js'
import { sendJson } from '../_lib/json.js'

export const config = { api: { bodyParser: false } }

// Credentials travel in the POST body, never in the URL.
export function createOrderStatusHandler({ getDb = getSql } = {}) {
  return async function orderStatus(req, res) {
    res.setHeader('Cache-Control', 'no-store')

    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST')
      return sendJson(res, 405, { error: 'Method not allowed' })
    }

    try {
      const body = await readJsonBody(req, 4 * 1024)
      return sendJson(res, 200, await getOrderStatus({ sql: getDb(), body }))
    } catch (error) {
      return sendError(res, error, 'order status', sendJson)
    }
  }
}

export default createOrderStatusHandler()
