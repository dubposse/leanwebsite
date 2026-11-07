import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { createWithdrawalsHandler, validateWithdrawalInput } from '../api/withdrawals.js'
import { buildRequest, buildResponse } from './helpers/fakes.js'

const ID = 'd83a4cb2-4c0c-4a60-b952-cb2519598aa2'
const RECEIVED_AT = new Date('2026-11-07T10:00:00.000Z')
const validInput = {
  customerName: 'Ada Lovelace',
  customerEmail: 'ada@example.com',
  orderReference: '',
  message: '',
  website: '',
}
const JSON_HEADERS = { 'content-type': 'application/json' }

function fakeSql({ fail = false } = {}) {
  const calls = []
  const sql = async (strings, ...values) => {
    calls.push({ text: strings.join('?'), values })
    if (fail) throw new Error('database error containing ada@example.com')
    return [{ id: ID, received_at: RECEIVED_AT }]
  }
  return { calls, getDb: () => sql }
}

async function call(handler, body, { method = 'POST', headers = JSON_HEADERS } = {}) {
  const req = buildRequest(body, { method, headers })
  const res = buildResponse()
  await handler(req, res)
  return res
}

describe('electronic withdrawal endpoint', () => {
  it('stores a declaration without an order number and returns the database timestamp', async () => {
    const fake = fakeSql()
    const handler = createWithdrawalsHandler({ getDb: fake.getDb })
    const response = await call(handler, validInput)

    assert.equal(response.statusCode, 201)
    assert.deepEqual(response.body, {
      withdrawalId: ID,
      receivedAt: RECEIVED_AT.toISOString(),
    })
    assert.deepEqual(fake.calls[0].values, ['Ada Lovelace', 'ada@example.com', null, null])
    assert.match(fake.calls[0].text, /INSERT INTO withdrawals/)
    assert.match(fake.calls[0].text, /RETURNING id, received_at/)
    assert.equal(response.headers['Cache-Control'], 'no-store')
    assert.equal(response.headers['X-Content-Type-Options'], 'nosniff')
  })

  it('validates required fields, optional values, bounds, and the honeypot', () => {
    assert.deepEqual(validateWithdrawalInput({
      customerName: '  Ada Lovelace  ',
      customerEmail: ' ada@example.com ',
    }), {
      customerName: 'Ada Lovelace',
      customerEmail: 'ada@example.com',
      orderReference: null,
      message: null,
    })

    for (const invalid of [
      {},
      { ...validInput, customerName: ' ' },
      { ...validInput, customerEmail: '' },
      { ...validInput, customerEmail: 'not-an-email' },
      { ...validInput, customerName: 'a'.repeat(201) },
      { ...validInput, orderReference: 42 },
      { ...validInput, message: 'x'.repeat(5001) },
      { ...validInput, unexpected: 'field' },
      { ...validInput, website: 'bot-filled-this' },
      null,
      ['not', 'an', 'object'],
    ]) {
      assert.throws(() => validateWithdrawalInput(invalid))
    }
  })

  it('accepts only POST JSON requests and limits request size', async () => {
    const fake = fakeSql()
    const handler = createWithdrawalsHandler({ getDb: fake.getDb })
    assert.equal((await call(handler, validInput, { method: 'GET' })).statusCode, 405)
    assert.equal((await call(handler, validInput, { headers: {} })).statusCode, 415)
    assert.equal((await call(handler, '{invalid')).statusCode, 400)
    assert.equal((await call(handler, { ...validInput, message: 'x'.repeat(9000) })).statusCode, 413)
    assert.equal(fake.calls.length, 0)
  })

  it('rejects cross-origin browser requests without writing data', async () => {
    const fake = fakeSql()
    const handler = createWithdrawalsHandler({ getDb: fake.getDb })
    const response = await call(handler, validInput, {
      headers: { ...JSON_HEADERS, origin: 'https://other.example', host: 'leanwebsite.example' },
    })
    assert.equal(response.statusCode, 403)
    assert.equal(fake.calls.length, 0)
  })

  it('does not claim success or log customer data when the database write fails', async () => {
    const fake = fakeSql({ fail: true })
    const handler = createWithdrawalsHandler({ getDb: fake.getDb })
    const logs = []
    const originalError = console.error
    console.error = (...parts) => logs.push(parts.join(' '))
    try {
      const response = await call(handler, validInput)
      assert.equal(response.statusCode, 500)
      assert.equal(response.body.withdrawalId, undefined)
      assert.doesNotMatch(JSON.stringify(response.body), /ada@example\.com|Ada Lovelace/)
    } finally {
      console.error = originalError
    }
    assert.deepEqual(logs, ['withdrawal submission failed'])
  })
})

describe('withdrawal page and persistence migration', () => {
  const page = readFileSync(new URL('../src/withdrawal-page.js', import.meta.url), 'utf8')
  const markdown = readFileSync(new URL('../src/data/withdrawal-page.md', import.meta.url), 'utf8')
  const migration = readFileSync(new URL('../db/migrations/0006_withdrawals.sql', import.meta.url), 'utf8')
  const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8')
  const vercel = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'))
  const artistBuilder = readFileSync(new URL('../src/artist-band-builder.js', import.meta.url), 'utf8')
  const businessBuilder = readFileSync(new URL('../src/business-builder.js', import.meta.url), 'utf8')

  it('includes the required wording and two-stage confirmation with actual response time', () => {
    assert.match(markdown, /\*\*Widerrufsrecht für Verbraucher\*\*/)
    assert.match(markdown, /binnen vierzehn Tagen/)
    assert.match(markdown, /unverzüglich und spätestens binnen vierzehn Tagen/)
    assert.match(markdown, /Muster-Widerrufsformular/)
    assert.match(markdown, /Nach einem wirksamen Widerruf darf die von LeanWebsite bereitgestellte Website-Datei/)
    assert.match(page, /id="withdrawal-start" type="button">Vertrag widerrufen/)
    assert.match(page, /id="withdrawal-submit" type="button">Widerruf bestätigen/)
    assert.match(page, /id="withdrawal-review" type="button">Angaben prüfen/)
    assert.match(page, /form\.reportValidity\(\)/)
    assert.match(page, /payload\.receivedAt/)
    assert.match(page, /payload\.withdrawalId/)
    assert.match(page, /Eine persönliche Eingangsbestätigung per E-Mail folgt/)
    assert.match(page, /fetch\('\/api\/withdrawals'/)
  })

  it('routes both slash forms and links the landing page and both builders', () => {
    assert.match(main, /path === '\/widerruf'/)
    for (const source of [main, artistBuilder, businessBuilder]) {
      assert.match(source, /href="\/widerruf">Widerruf/)
      assert.match(source, /href="\/datenschutz">Datenschutzerklärung/)
      assert.match(source, /href="https:\/\/matthiasbrehm\.de\/impressum"/)
    }
    assert.ok(vercel.rewrites.some(({ source, destination }) => source === '/widerruf' && destination === '/index.html'))
    assert.ok(vercel.rewrites.some(({ source, destination }) => source === '/widerruf/' && destination === '/index.html'))
  })

  it('creates only the requested withdrawal table and permitted status values', () => {
    assert.match(migration, /CREATE TABLE withdrawals/)
    for (const column of [
      'id uuid PRIMARY KEY',
      'customer_name varchar(200) NOT NULL',
      'customer_email varchar(254) NOT NULL',
      'order_reference varchar(200)',
      'message text',
      'received_at timestamptz NOT NULL DEFAULT now()',
      "status text NOT NULL DEFAULT 'received' CHECK (status IN ('received', 'acknowledged', 'resolved'))",
      'acknowledged_at timestamptz',
    ]) assert.ok(migration.includes(column), `missing schema field: ${column}`)
    assert.match(migration, /CREATE INDEX withdrawals_status_idx/)
    assert.match(migration, /CREATE INDEX withdrawals_received_at_idx/)
    assert.doesNotMatch(migration, /ALTER TABLE (?!withdrawals)/)
  })
})
