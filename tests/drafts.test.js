import assert from 'node:assert/strict'
import { beforeEach, describe, it } from 'node:test'
import { createCheckoutHandler } from '../api/checkout.js'
import { createDraftsHandler } from '../api/drafts/index.js'
import { createDraftHandler, MAX_BODY_BYTES } from '../api/drafts/[id].js'
import { validateImageDataUrl } from '../api/_lib/generators.js'
import { hashToken } from '../api/_lib/tokens.js'
import {
  buildRequest,
  buildResponse,
  createFakeDb,
  createFakeStorage,
  createFakeStripe,
  createTestGenerators,
  htmlFor,
} from './helpers/fakes.js'

const JSON_HEADERS = { 'content-type': 'application/json' }

describe('draft API', () => {
  let db
  let storage
  let create
  let draft
  let checkout
  let stripe

  const call = async (handler, body, { method = 'POST', headers = JSON_HEADERS, query } = {}) => {
    const res = buildResponse()
    const req = buildRequest(body, { method, headers })
    if (query) req.query = query
    await handler(req, res)
    return res
  }

  const createDraftOk = async (builder = 'artist-band') => {
    const res = await call(create, { builder })
    assert.equal(res.statusCode, 201)
    return res.body
  }

  const auth = (token) => ({ ...JSON_HEADERS, authorization: `Bearer ${token}` })
  const put = (id, token, body) => call(draft, body, { method: 'PUT', headers: auth(token), query: { id } })
  const get = (id, token) => call(draft, '', { method: 'GET', headers: token ? auth(token) : {}, query: { id } })

  beforeEach(() => {
    db = createFakeDb()
    db.builders.push({ id: 'b2', slug: 'business', name: 'Business', active: true })
    storage = createFakeStorage()
    stripe = createFakeStripe()
    create = createDraftsHandler({ getDb: () => db })
    draft = createDraftHandler({ getDb: () => db, storage, generators: createTestGenerators() })
    checkout = (generators) =>
      createCheckoutHandler({ getDb: () => db, getStripeClient: () => stripe, resolveSiteUrl: () => 'https://x.example', storage, generators })
  })

  describe('POST /api/drafts', () => {
    it('creates a draft and stores only the token hash', async () => {
      const { draftId, draftToken } = await createDraftOk()
      assert.match(draftToken, /^[A-Za-z0-9_-]{43}$/)
      assert.equal(db.drafts[0].id, draftId)
      assert.equal(db.drafts[0].access_token_hash, hashToken(draftToken))
      assert.equal(JSON.stringify(db.drafts).includes(draftToken), false)
    })

    it('rejects unknown builders, inactive builders, extra fields and wrong methods', async () => {
      assert.equal((await call(create, { builder: 'other' })).statusCode, 400)
      assert.equal((await call(create, { builder: 'artist-band', extra: 1 })).statusCode, 400)
      assert.equal((await call(create, { builder: 5 })).statusCode, 400)
      assert.equal((await call(create, '{bad')).statusCode, 400)
      assert.equal((await call(create, { builder: 'business' }, { headers: {} })).statusCode, 415)
      assert.equal((await call(create, '', { method: 'GET' })).statusCode, 405)
      db.builders[0].active = false
      assert.equal((await call(create, { builder: 'artist-band' })).statusCode, 404)
      assert.equal(db.drafts.length, 0)
    })

    it('hides database errors and sends no CORS headers', async () => {
      db.failNextWrite = true
      const res = await call(create, { builder: 'artist-band' })
      assert.equal(res.statusCode, 500)
      assert.deepEqual(res.body, { error: 'Request failed' })
      assert.equal(Object.keys(res.headers).some((name) => name.toLowerCase().startsWith('access-control')), false)
    })
  })

  describe('PUT/GET /api/drafts/:id', () => {
    it('saves validated data and loads it back without internals', async () => {
      const { draftId, draftToken } = await createDraftOk()
      const saved = await put(draftId, draftToken, { builder: 'artist-band', data: { pages: ['home'], junk: 1 } })
      assert.equal(saved.statusCode, 200)
      const savedKey = db.drafts[0].storage_key
      assert.match(savedKey, new RegExp(`^drafts/${draftId}/content-[0-9a-f-]{36}$`))
      assert.deepEqual(storage.objects.get(savedKey).body, Buffer.from('{"pages":["home"]}'))

      const loaded = await get(draftId, draftToken)
      assert.equal(loaded.statusCode, 200)
      assert.deepEqual(Object.keys(loaded.body).sort(), ['builder', 'data', 'draftId', 'status', 'updatedAt'])
      assert.deepEqual(loaded.body.data, { pages: ['home'] })
      assert.equal(JSON.stringify(loaded.body).includes('drafts/'), false)
    })

    it('returns data null for a draft without content', async () => {
      const { draftId, draftToken } = await createDraftOk()
      assert.equal((await get(draftId, draftToken)).body.data, null)
    })

    it('requires a valid token for both methods and treats foreign drafts like unknown ones', async () => {
      const a = await createDraftOk()
      const b = await createDraftOk()
      assert.equal((await get(a.draftId)).statusCode, 401)
      assert.equal((await get(a.draftId, b.draftToken)).statusCode, 404)
      assert.equal((await put(a.draftId, b.draftToken, { builder: 'artist-band', data: { pages: [] } })).statusCode, 404)
      assert.equal((await get('44444444-4444-4444-8444-444444444444', a.draftToken)).statusCode, 404)
      assert.equal((await get('not-a-uuid', a.draftToken)).statusCode, 400)
      assert.equal(storage.putCalls, 0)
    })

    it('rejects invalid data, builder mismatch, unintegrated builders and oversized bodies without writing', async () => {
      const a = await createDraftOk()
      const biz = await createDraftOk('business')
      assert.equal((await put(a.draftId, a.draftToken, { builder: 'artist-band', data: { pages: 'x' } })).statusCode, 422)
      assert.equal((await put(a.draftId, a.draftToken, { builder: 'business', data: { pages: [] } })).statusCode, 400)
      assert.equal((await put(a.draftId, a.draftToken, { data: {} })).statusCode, 400)
      assert.equal((await put(a.draftId, a.draftToken, { builder: 'artist-band', data: {}, x: 1 })).statusCode, 400)
      assert.equal((await put(biz.draftId, biz.draftToken, { builder: 'business', data: {} })).statusCode, 409)
      const big = { builder: 'artist-band', data: { pages: ['x'.repeat(MAX_BODY_BYTES)] } }
      assert.equal((await put(a.draftId, a.draftToken, big)).statusCode, 413)
      assert.equal(storage.putCalls, 0)
    })

    it('rejects changes to locked drafts and storage failures stay opaque', async () => {
      const { draftId, draftToken } = await createDraftOk()
      const body = { builder: 'artist-band', data: { pages: ['home'] } }
      storage.failPut = true
      const failed = await put(draftId, draftToken, body)
      assert.equal(failed.statusCode, 500)
      assert.equal(JSON.stringify(failed.body).includes('simulated'), false)
      storage.failPut = false
      db.drafts[0].status = 'locked'
      assert.equal((await put(draftId, draftToken, body)).statusCode, 409)
      assert.equal(storage.objects.size, 0)
      assert.equal((await get(draftId, draftToken)).body.status, 'locked')
    })
  })

  describe('checkout compatibility', () => {
    const checkoutBody = (d) => ({ builder: 'artist-band', package: 'artist-band-code-and-go', ...d })

    it('snapshots the server-generated HTML of the saved draft', async () => {
      const d = await createDraftOk()
      await put(d.draftId, d.draftToken, { builder: 'artist-band', data: { pages: ['home'] } })
      const res = await call(checkout(createTestGenerators()), checkoutBody(d))
      assert.equal(res.statusCode, 200)
      const [order] = db.orders
      assert.equal(order.snapshot_content_type, 'text/html')
      assert.deepEqual(storage.objects.get(order.snapshot_key).body, htmlFor(['home']))
    })

    it('refuses checkout for builders that are not integrated', async () => {
      const d = await createDraftOk()
      storage.objects.set(`drafts/${d.draftId}/content`, { body: Buffer.from('{"pages":["home"]}'), contentType: 'application/json' })
      db.drafts[0].storage_key = `drafts/${d.draftId}/content`
      const res = await call(checkout(), checkoutBody({ draftId: d.draftId, draftToken: d.draftToken }))
      assert.equal(res.statusCode, 409)
      assert.equal(db.orders.length, 0)
      assert.equal(stripe.createCalls, 0)
    })

    it('refuses checkout for drafts without content or with invalid stored content', async () => {
      const d = await createDraftOk()
      assert.equal((await call(checkout(createTestGenerators()), checkoutBody(d))).statusCode, 409)
      db.drafts[0].storage_key = `drafts/${d.draftId}/content`
      storage.objects.set(db.drafts[0].storage_key, { body: Buffer.from('{"pages":5}'), contentType: 'application/json' })
      assert.equal((await call(checkout(createTestGenerators()), checkoutBody(d))).statusCode, 409)
      storage.objects.set(db.drafts[0].storage_key, { body: Buffer.from('<html>'), contentType: 'text/html' })
      assert.equal((await call(checkout(createTestGenerators()), checkoutBody(d))).statusCode, 409)
      assert.equal(db.orders.length, 0)
      assert.equal(stripe.createCalls, 0)
    })
  })

  describe('image helper', () => {
    it('accepts small raster images only', () => {
      const png = `data:image/png;base64,${Buffer.from('abc').toString('base64')}`
      assert.equal(validateImageDataUrl(png), 3)
      assert.throws(() => validateImageDataUrl('data:image/svg+xml;base64,AAAA'), { statusCode: 422 })
      assert.throws(() => validateImageDataUrl(png, { maxBytes: 2 }), { statusCode: 422 })
      assert.throws(() => validateImageDataUrl('https://x/y.png'), { statusCode: 422 })
    })
  })
})
