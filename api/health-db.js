import { checkDatabaseHealth } from './_lib/db.js'
import { sendJson } from './_lib/json.js'

export default async function healthDb(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    return sendJson(res, 405, { error: 'Method not allowed' })
  }

  const { ok } = await checkDatabaseHealth()

  return sendJson(res, ok ? 200 : 503, { status: ok ? 'ok' : 'unavailable', service: 'leanwebsite-db' })
}
