import { logError } from './diagnostics.js'

export class HttpError extends Error {
  constructor(statusCode, message) {
    super(message)
    this.name = 'HttpError'
    this.statusCode = statusCode
  }
}

// Reads the unmodified request body; handlers using this must disable Vercel's body parser.
// Event based on purpose: `vercel dev` pre-reads the body and re-emits it only through on('data'/'end'),
// so async iteration over the request would see an empty stream there.
export function readRawBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0

    const cleanup = () => {
      req.removeListener('data', onData)
      req.removeListener('end', onEnd)
      req.removeListener('error', onError)
    }
    const onData = (chunk) => {
      const buffer = Buffer.from(chunk)
      size += buffer.length

      if (size > maxBytes) {
        cleanup()
        req.pause?.()
        reject(new HttpError(413, 'Payload too large'))
        return
      }

      chunks.push(buffer)
    }
    const onEnd = () => {
      cleanup()
      resolve(Buffer.concat(chunks))
    }
    const onError = (error) => {
      cleanup()
      reject(error)
    }

    req.on('data', onData)
    req.on('end', onEnd)
    req.on('error', onError)
  })
}

// Shared by the draft endpoints. Tokens travel in the Authorization header, never in URLs (which get logged).
export function readBearerToken(req) {
  const match = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(String(req.headers.authorization ?? ''))

  if (!match) throw new HttpError(401, 'Missing or invalid draft token')

  return match[1]
}

export async function readJsonBody(req, maxBytes) {
  if (!String(req.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) {
    throw new HttpError(415, 'Content-Type must be application/json')
  }

  const raw = await readRawBody(req, maxBytes)

  try {
    return JSON.parse(raw.toString('utf8'))
  } catch {
    throw new HttpError(400, 'Invalid JSON body')
  }
}

// Only the status and message of expected errors reach the client; everything else is logged by name only.
export function sendError(res, error, label, sendJson) {
  if (error instanceof HttpError) return sendJson(res, error.statusCode, { error: error.message })

  logError(label, error)
  return sendJson(res, 500, { error: 'Request failed' })
}
