import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it } from 'node:test'
import { describeError } from '../api/_lib/diagnostics.js'
import { createDraftsHandler } from '../api/drafts/index.js'
import { buildRequest, buildResponse } from './helpers/fakes.js'

const URL_WITH_SECRET = 'postgresql://user:hunter2pass@ep-cool-123.eu-central-1.aws.neon.tech/leanwebsite?sslmode=require'

describe('describeError', () => {
  it('shows name, code and message of driver errors', () => {
    const error = Object.assign(new Error('relation "drafts" does not exist'), { name: 'NeonDbError', code: '42P01', severity: 'ERROR' })
    const text = describeError(error, { NODE_ENV: 'production' })
    assert.match(text, /NeonDbError code=42P01 severity=ERROR message="relation \\?"drafts\\?" does not exist"/)
  })

  it('follows the cause chain (e.g. fetch failures)', () => {
    const error = new TypeError('fetch failed', { cause: Object.assign(new Error('getaddrinfo ENOTFOUND host'), { code: 'ENOTFOUND' }) })
    assert.match(describeError(error, { NODE_ENV: 'production' }), /TypeError message="fetch failed" <- caused by: Error code=ENOTFOUND/)
  })

  it('redacts connection strings, credentials, tokens and e-mail addresses', () => {
    const token = 'A'.repeat(43)
    const error = new Error(
      `connect failed for ${URL_WITH_SECRET} password=hunter2pass Bearer ${token} sk_test_abc123 mail me@example.com`,
    )
    const text = describeError(error, { NODE_ENV: 'production' })
    for (const secret of ['hunter2pass', 'neon.tech', token, 'sk_test_abc123', 'me@example.com']) {
      assert.ok(!text.includes(secret), `leaked ${secret}`)
    }
  })

  it('adds a short stack only outside production', () => {
    const error = new Error('boom')
    assert.match(describeError(error, {}), /\n {2}at /)
    assert.doesNotMatch(describeError(error, { VERCEL_ENV: 'production' }), /\n {2}at /)
    assert.ok(!describeError(error, {}).includes(process.cwd()))
  })

  it('handles non-error values and truncates long messages', () => {
    assert.match(describeError('plain', {}), /^string: plain/)
    assert.ok(describeError(new Error('x '.repeat(1000)), { NODE_ENV: 'production' }).length < 400)
  })
})

describe('POST /api/drafts failure handling', () => {
  let logged
  const original = console.error

  beforeEach(() => {
    logged = []
    console.error = (...args) => logged.push(args.join(' '))
  })
  afterEach(() => {
    console.error = original
  })

  it('logs the cause locally but returns only a generic message to the browser', async () => {
    const failing = {
      query: async () => {
        throw Object.assign(new Error(`password authentication failed for ${URL_WITH_SECRET}`), { name: 'NeonDbError', code: '28P01' })
      },
    }
    const handler = createDraftsHandler({ getDb: () => failing })
    const res = buildResponse()
    await handler(buildRequest({ builder: 'artist-band' }, { headers: { 'content-type': 'application/json' } }), res)

    assert.equal(res.statusCode, 500)
    assert.deepEqual(res.body, { error: 'Request failed' })
    assert.match(logged.join('\n'), /draft creation failed: NeonDbError code=28P01/)
    assert.ok(!logged.join('\n').includes('hunter2pass'))
  })

  it('names the missing configuration when the database cannot be created', async () => {
    const handler = createDraftsHandler({
      getDb: () => {
        throw new Error('DATABASE_URL is not configured')
      },
    })
    const res = buildResponse()
    await handler(buildRequest({ builder: 'artist-band' }, { headers: { 'content-type': 'application/json' } }), res)
    assert.equal(res.statusCode, 500)
    assert.match(logged.join('\n'), /DATABASE_URL is not configured/)
  })
})
