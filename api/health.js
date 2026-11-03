import { sendJson } from './_lib/json.js'

export default function health(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    return sendJson(res, 405, { error: 'Method not allowed' })
  }

  return sendJson(res, 200, { status: 'ok', service: 'leanwebsite' })
}
