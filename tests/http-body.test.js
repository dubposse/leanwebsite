import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PassThrough, Readable } from 'node:stream'
import { describe, it } from 'node:test'
import Stripe from 'stripe'
import { HttpError, readJsonBody, readRawBody } from '../api/_lib/http.js'

// Mirrors @vercel/node's dev server: the original stream is already consumed and only
// read/on/addListener are redirected to a replica; async iteration still hits the empty original.
function vercelDevRequest(body, headers = { 'content-type': 'application/json' }) {
  const req = Object.assign(Readable.from([]), { method: 'POST', headers })
  const replica = new PassThrough()
  const on = replica.on.bind(replica)
  const originalOn = req.on.bind(req)
  req.read = replica.read.bind(replica)
  req.on = req.addListener = (name, cb) => (name === 'data' || name === 'end' ? on(name, cb) : originalOn(name, cb))
  req.removeListener = (name, cb) => replica.removeListener(name, cb)
  replica.write(body)
  replica.end()
  return req
}

const plainRequest = (chunks, headers = { 'content-type': 'application/json' }) =>
  Object.assign(Readable.from(chunks), { method: 'POST', headers })

describe('readRawBody', () => {
  it('reads the body when the runtime re-emits it only through events (vercel dev)', async () => {
    const body = await readJsonBody(vercelDevRequest('{"builder":"artist-band"}'), 1024)
    assert.deepEqual(body, { builder: 'artist-band' })
  })

  it('reads a normal Node stream in several chunks', async () => {
    const raw = await readRawBody(plainRequest([Buffer.from('{"a":'), Buffer.from('1}')]), 1024)
    assert.equal(raw.toString(), '{"a":1}')
  })

  it('keeps the raw bytes unchanged so Stripe signatures still verify', async () => {
    const secret = 'whsec_test_dummy_secret'
    const payload = JSON.stringify({ id: 'evt_1', object: 'event', note: 'Größe – 😀' })
    const header = Stripe.webhooks.generateTestHeaderString({ payload, secret })
    const bytes = Buffer.from(payload)

    // Split inside a multi-byte character to prove nothing is decoded on the way.
    const split = [bytes.subarray(0, bytes.length - 7), bytes.subarray(bytes.length - 7)]

    for (const req of [plainRequest(split), vercelDevRequest(bytes)]) {
      const raw = await readRawBody(req, 4096)
      assert.ok(raw.equals(bytes))
      assert.equal(Stripe.webhooks.constructEvent(raw, header, secret).id, 'evt_1')
    }
  })

  it('rejects bodies over the limit with 413 on both stream kinds', async () => {
    for (const req of [plainRequest([Buffer.alloc(600), Buffer.alloc(600)]), vercelDevRequest(Buffer.alloc(1200))]) {
      await assert.rejects(readRawBody(req, 1024), (error) => error instanceof HttpError && error.statusCode === 413)
    }
  })

  it('accepts a body of exactly the limit', async () => {
    assert.equal((await readRawBody(plainRequest([Buffer.alloc(1024)]), 1024)).length, 1024)
  })

  it('maps invalid JSON and wrong content types to 400 and 415', async () => {
    await assert.rejects(readJsonBody(vercelDevRequest('{nope'), 1024), (e) => e.statusCode === 400)
    await assert.rejects(readJsonBody(vercelDevRequest('{}', {}), 1024), (e) => e.statusCode === 415)
  })

  it('propagates stream errors', async () => {
    const req = new PassThrough()
    const pending = readRawBody(req, 1024)
    req.destroy(new Error('boom'))
    await assert.rejects(pending, /boom/)
  })
})

describe('API endpoints share readRawBody', () => {
  const files = (dir) =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
      entry.isDirectory() ? files(join(dir, entry.name)) : entry.name.endsWith('.js') ? [join(dir, entry.name)] : [],
    )

  it('no API module reads the request stream on its own', () => {
    for (const file of files('api')) {
      assert.doesNotMatch(readFileSync(file, 'utf8'), /for await\s*\(|req\.body|Symbol\.asyncIterator/, file)
    }
  })

  it('every body-reading endpoint goes through readRawBody or readJsonBody', () => {
    for (const file of ['api/checkout.js', 'api/stripe-webhook.js', 'api/drafts/index.js', 'api/drafts/[id].js', 'api/orders/status.js', 'api/orders/download.js']) {
      assert.match(readFileSync(file, 'utf8'), /readRawBody|readJsonBody/, file)
    }
  })
})
