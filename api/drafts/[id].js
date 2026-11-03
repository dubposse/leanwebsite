import { getSql } from '../_lib/db.js'
import { loadDraft, saveDraft } from '../_lib/drafts.js'
import { defaultGenerators, isPlainObject } from '../_lib/generators.js'
import { HttpError, readBearerToken, readJsonBody, sendError } from '../_lib/http.js'
import { sendJson } from '../_lib/json.js'
import { getObject, putObject } from '../_lib/storage.js'

// Stays below the 4.5 MB request limit of Vercel functions. Larger images need a dedicated upload route.
export const MAX_BODY_BYTES = 4 * 1024 * 1024

export const config = { api: { bodyParser: false } }

function draftIdOf(req) {
  const id = req.query?.id
  return typeof id === 'string' ? id : ''
}

// GET  /api/drafts/:id  (Authorization: Bearer <token>) -> { draftId, builder, status, updatedAt, data }
// PUT  /api/drafts/:id  (Authorization: Bearer <token>)  body { builder, data } -> { updatedAt }
// No CORS headers are sent: the endpoints are for the same-origin site only.
export function createDraftHandler({
  getDb = getSql,
  storage = { getObject, putObject },
  generators = defaultGenerators,
} = {}) {
  return async function draft(req, res) {
    res.setHeader('Cache-Control', 'no-store')

    if (req.method !== 'GET' && req.method !== 'PUT') {
      res.setHeader('Allow', 'GET, PUT')
      return sendJson(res, 405, { error: 'Method not allowed' })
    }

    try {
      const draftToken = readBearerToken(req)
      const draftId = draftIdOf(req)

      if (req.method === 'GET') {
        return sendJson(res, 200, await loadDraft({ sql: getDb(), get: storage.getObject, draftId, draftToken }))
      }

      const body = await readJsonBody(req, MAX_BODY_BYTES)

      if (!isPlainObject(body) || Object.keys(body).some((key) => key !== 'builder' && key !== 'data')) {
        throw new HttpError(400, 'Invalid request')
      }

      const saved = await saveDraft({
        sql: getDb(),
        put: storage.putObject,
        generators,
        draftId,
        draftToken,
        builderSlug: body.builder,
        data: body.data,
      })

      return sendJson(res, 200, saved)
    } catch (error) {
      return sendError(res, error, `draft ${req.method.toLowerCase()}`, sendJson)
    }
  }
}

export default createDraftHandler()
