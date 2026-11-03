import { randomUUID } from 'node:crypto'
import { BUILDER_SLUGS, defaultGenerators, renderWebsite, validateBuilderData } from './generators.js'
import { HttpError } from './http.js'
import { draftObjectKey, getObject, MAX_OBJECT_SIZE_BYTES, putObject } from './storage.js'
import { generateAccessToken, isWellFormedToken, verifyToken } from './tokens.js'

// Server-side interface for drafts. The working copy of a draft is ONE object in the private bucket: the
// builder data after server-side validation (JSON). The website HTML is always generated from it on the server.

export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
export const DRAFT_CONTENT_FILE = 'content'
export const DRAFT_CONTENT_TYPES = Object.freeze(['application/zip', 'application/json'])

const SELECT_DRAFT_SQL = `SELECT d.id, d.status, d.storage_key, d.updated_at, d.access_token_hash,
    b.slug AS builder_slug, b.name AS builder_name, b.active AS builder_active
  FROM drafts d JOIN builders b ON b.id = d.builder_id
  WHERE d.id = $1`

const CREATE_DRAFT_SQL = `INSERT INTO drafts (builder_id, access_token_hash)
  SELECT id, $2 FROM builders WHERE slug = $1 AND active RETURNING id`

const SAVE_CONTENT_SQL = `UPDATE drafts SET storage_key = $2 WHERE id = $1 AND status = 'draft' RETURNING id`

// Unknown draft and wrong token are indistinguishable to the caller.
export async function loadAuthorizedDraft(sql, { draftId, draftToken }) {
  const [draft] = await sql.query(SELECT_DRAFT_SQL, [draftId])

  if (!draft || !verifyToken(draftToken, draft.access_token_hash)) {
    throw new HttpError(404, 'Draft not found')
  }

  return draft
}

// The stored key must be this draft's own content key; a manipulated row can never point at foreign objects.
export function draftContentKeyOf(draft) {
  const legacyKey = draftObjectKey(draft.id, DRAFT_CONTENT_FILE)
  const versionedKey = new RegExp(
    `^${legacyKey}-[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`,
    'i',
  )

  return draft.storage_key === legacyKey || versionedKey.test(draft.storage_key ?? '') ? draft.storage_key : null
}

/**
 * Stores the working copy of a draft. A draft that is locked (paid) can no longer be changed.
 * The key is generated here from the draft id; no client-supplied path is used.
 */
export async function saveDraftContent({ sql, put = putObject, draftId, draftToken, body, contentType }) {
  if (typeof draftId !== 'string' || !UUID_PATTERN.test(draftId)) throw new HttpError(400, 'Invalid draft reference')
  if (!isWellFormedToken(draftToken)) throw new HttpError(400, 'Invalid draft token')
  if (!DRAFT_CONTENT_TYPES.includes(contentType)) throw new HttpError(415, 'Unsupported content type')
  if (!Buffer.isBuffer(body) || body.byteLength === 0) throw new HttpError(400, 'Draft content must not be empty')
  if (body.byteLength > MAX_OBJECT_SIZE_BYTES) throw new HttpError(413, 'Draft content is too large')

  const draft = await loadAuthorizedDraft(sql, { draftId: draftId.toLowerCase(), draftToken })

  if (draft.status !== 'draft') throw new HttpError(409, 'This draft is locked')

  const key = draftObjectKey(draft.id, `${DRAFT_CONTENT_FILE}-${randomUUID()}`)
  await put(key, body, { contentType, overwrite: false })

  // The immutable object is published by one conditional database update. A lock and a save therefore
  // serialize on the draft row; whichever wins defines the visible state without changing old snapshots.
  const saved = await sql.query(SAVE_CONTENT_SQL, [draft.id, key])

  if (saved.length === 0) throw new HttpError(409, 'This draft is locked')

  return { key }
}

/** Creates an empty draft. The token is returned once; only its hash is stored. */
export async function createDraft({ sql, builderSlug }) {
  if (typeof builderSlug !== 'string' || !BUILDER_SLUGS.includes(builderSlug)) throw new HttpError(400, 'Invalid builder')

  const { token, hash } = generateAccessToken()
  const [created] = await sql.query(CREATE_DRAFT_SQL, [builderSlug, hash])

  if (!created) throw new HttpError(404, 'Builder not found')

  return { draftId: created.id, draftToken: token }
}

/**
 * Validates the builder data with the builder's own validator, proves that a complete website can be generated
 * from it, and only then stores the normalized data. Nothing the browser sends is stored unvalidated.
 */
export async function saveDraft({
  sql,
  put = putObject,
  generators = defaultGenerators,
  draftId,
  draftToken,
  builderSlug,
  data,
}) {
  if (typeof draftId !== 'string' || !UUID_PATTERN.test(draftId)) throw new HttpError(400, 'Invalid draft reference')
  if (!isWellFormedToken(draftToken)) throw new HttpError(400, 'Invalid draft token')

  const draft = await loadAuthorizedDraft(sql, { draftId: draftId.toLowerCase(), draftToken })

  if (draft.status !== 'draft') throw new HttpError(409, 'This draft is locked')
  if (!draft.builder_active) throw new HttpError(409, 'This builder is currently not available')
  if (draft.builder_slug !== builderSlug) throw new HttpError(400, 'Builder does not match the draft')

  const { json } = validateBuilderData(generators, draft.builder_slug, data)

  // Generation must succeed before anything is stored, so a saved draft is always purchasable content.
  renderWebsite(generators, draft.builder_slug, json, 2000)

  await saveDraftContent({ sql, put, draftId: draft.id, draftToken, body: json, contentType: 'application/json' })

  return { updatedAt: new Date().toISOString() }
}

/** Returns the stored builder data for the owner. No storage keys or internal columns leave this function. */
export async function loadDraft({ sql, get = getObject, draftId, draftToken }) {
  if (typeof draftId !== 'string' || !UUID_PATTERN.test(draftId)) throw new HttpError(400, 'Invalid draft reference')
  if (!isWellFormedToken(draftToken)) throw new HttpError(400, 'Invalid draft token')

  const draft = await loadAuthorizedDraft(sql, { draftId: draftId.toLowerCase(), draftToken })
  const key = draftContentKeyOf(draft)
  const object = key ? await get(key) : null

  if (key && object && object.contentType !== 'application/json') throw new Error('Unexpected draft content type')

  return {
    draftId: draft.id,
    builder: draft.builder_slug,
    status: draft.status,
    updatedAt: draft.updated_at ? new Date(draft.updated_at).toISOString() : null,
    data: object ? JSON.parse(object.body.toString('utf8')) : null,
  }
}
