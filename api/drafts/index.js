import { getSql } from '../_lib/db.js'
import { createDraft } from '../_lib/drafts.js'
import { HttpError, readJsonBody, sendError } from '../_lib/http.js'
import { isPlainObject } from '../_lib/generators.js'
import { sendJson } from '../_lib/json.js'

const MAX_BODY_BYTES = 1024

export const config = { api: { bodyParser: false } }

// POST /api/drafts { builder } -> 201 { draftId, draftToken }. The token is shown exactly once.
// No CORS headers are sent: the endpoint is for the same-origin site only.
export function createDraftsHandler({ getDb = getSql } = {}) {
  return async function drafts(req, res) {
    res.setHeader('Cache-Control', 'no-store')

    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST')
      return sendJson(res, 405, { error: 'Method not allowed' })
    }

    try {
      const body = await readJsonBody(req, MAX_BODY_BYTES)

      if (!isPlainObject(body) || Object.keys(body).some((key) => key !== 'builder')) {
        throw new HttpError(400, 'Invalid request')
      }

      const created = await createDraft({ sql: getDb(), builderSlug: body.builder })

      return sendJson(res, 201, created)
    } catch (error) {
      return sendError(res, error, 'draft creation', sendJson)
    }
  }
}

export default createDraftsHandler()
