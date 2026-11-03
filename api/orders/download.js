import { loadPaidSnapshot } from '../_lib/downloads.js'
import { getSql } from '../_lib/db.js'
import { HttpError, readJsonBody, sendError } from '../_lib/http.js'
import { sendJson } from '../_lib/json.js'
import { getObject } from '../_lib/storage.js'

export const config = { api: { bodyParser: false } }

export function createOrderDownloadHandler({ getDb = getSql, storage = { getObject } } = {}) {
  return async function orderDownload(req, res) {
    res.setHeader('Cache-Control', 'no-store')

    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST')
      return sendJson(res, 405, { error: 'Method not allowed' })
    }

    try {
      const body = await readJsonBody(req, 4 * 1024)
      const file = await loadPaidSnapshot({ sql: getDb(), storage, body })

      res.setHeader('Content-Type', 'text/html; charset=utf-8')
      res.setHeader('Content-Disposition', `attachment; filename="${file.fileName}"`)
      res.setHeader('Content-Length', String(file.size))
      res.setHeader('X-Content-Type-Options', 'nosniff')
      // Defence in depth: should the file ever be opened inline, it is inert.
      res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'; img-src data:; style-src 'unsafe-inline'")
      return res.status(200).send(file.body)
    } catch (error) {
      if (error instanceof HttpError && error.code) {
        return sendJson(res, error.statusCode, { error: error.message, code: error.code })
      }

      return sendError(res, error, 'order download', sendJson)
    }
  }
}

export default createOrderDownloadHandler()
