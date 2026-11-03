import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import jpeg from 'jpeg-js'
import { createCheckoutSession } from '../api/_lib/checkout.js'
import { createDraft, loadDraft, saveDraft, saveDraftContent } from '../api/_lib/drafts.js'
import {
  defaultGenerators,
  renderWebsite,
  validateBuilderData,
} from '../api/_lib/generators.js'
import { generateArtistBandHtml } from '../shared/artist-band-template.js'
import { createFakeDb, createFakeStorage, createFakeStripe } from './helpers/fakes.js'

const MALFORMED_JPEG_BASE64 =
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wCEAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSgBBwcHCggKEwoKEygaFhooKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKP/AABEIAAEAAQMBEQACEQEDEQH/xAGiAAABBQEBAQEBAQAAAAAAAAAAAQIDBAUGBwgJCgsQAAIBAwMCBAMFBQQEAAABfQECAwAEEQUSITFBBhNRYQcicRQygZGhCCNCscEVUtHwJDNicoIJChYXGBkaJSYnKCkqNDU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ4eHl6g4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2drh4uPk5ebn6Onq8fLz9PX29/j5+gEAAwEBAQEBAQEBAQEBAQECAwQFBgcICQoLEQACAQIEBAMEBwUEBAABAncAAQIDEQQFITEGEkFRB2FxEyIygQgUQpGhscEJIzNS8BVictEKFiQ04SXxFxgZGiYnKCkqNTY3ODk6Q0RFRkdISUpTVldYWVpjZGVmZ2hpanN0dXZ4eXqCg4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2drh4uPk5ebn6Onq8/T19vf4+fr/2gAMAwEAAhEDEQA/APOq+OP6RP8A/9k='

const JPEG_BASE64 = jpeg
  .encode({ data: Uint8Array.from([255, 0, 0, 255]), width: 1, height: 1 }, 80)
  .data.toString('base64')

function artistData(overrides = {}) {
  return {
    name: 'DJ Nova',
    genre: 'Techno · Acid · Electro',
    tagline: 'Basslines für die Nacht.',
    bio: 'Produzent und DJ aus der Posse.',
    accent: '#c6ff00',
    theme: 'dark',
    spotify: '',
    soundcloud: '',
    bandcamp: '',
    instagram: '',
    email: '',
    cover: '',
    tracks: [{ a: 'Midnight Acid', b: '' }],
    gigs: [{ a: '2026-11-21', b: 'Berlin · Club Posse' }],
    ...overrides,
  }
}

const validate = (data) => validateBuilderData(defaultGenerators, 'artist-band', data).data

describe('artist-band generator', () => {
  it('is registered and validates the real artist and band data model', () => {
    assert.ok(defaultGenerators['artist-band'])
    assert.deepEqual(validate(artistData()), artistData())
    assert.deepEqual(validate(artistData({ spotify: 'https://open.spotify.com/artist/example' })).spotify, 'https://open.spotify.com/artist/example')
  })

  it('rejects invalid types, themes, colors, URLs, emails, rows and lengths', () => {
    for (const data of [
      artistData({ name: '' }),
      artistData({ name: 7 }),
      artistData({ tagline: 'x'.repeat(181) }),
      artistData({ theme: 'custom' }),
      artistData({ accent: '#fff; background:url(javascript:alert(1))' }),
      artistData({ spotify: 'javascript:alert(1)' }),
      artistData({ bandcamp: 'https://user:pass@example.com/' }),
      artistData({ email: 'not-an-email' }),
      artistData({ tracks: [{ a: 'Track', b: '', extra: 'attribute' }] }),
      artistData({ gigs: 'not-an-array' }),
      artistData({ tracks: Array.from({ length: 21 }, () => ({ a: 'x', b: '' })) }),
      artistData({ gigs: [{ a: 'x'.repeat(81), b: '' }] }),
    ]) {
      assert.throws(() => validate(data), { statusCode: 422 })
    }
  })

  it('escapes HTML and attributes and confines CSS values to validated tokens', () => {
    const data = validate(artistData({
      name: '<img src=x onerror="alert(1)">',
      tagline: '"><script>alert(1)</script>',
      bio: '</p><style>body{display:none}</style>',
      tracks: [{ a: '<svg onload=alert(1)>', b: 'https://example.com/?x=" onmouseover="alert(1)' }],
    }))
    const html = defaultGenerators['artist-band'].generateHtml(data, 2034)

    assert.ok(!html.includes('<img src=x'))
    assert.ok(!html.includes('<script>alert(1)</script>'))
    assert.ok(!html.includes('<style>body{display:none}</style>'))
    assert.ok(html.includes('&#60;img src=x onerror=&#34;alert(1)&#34;&#62;'))
    assert.ok(html.includes('background:var(--bg)'))
    assert.ok(!html.includes('href="https://example.com/?x=" onmouseover='))
  })

  it('accepts decodable JPEG data URLs and rejects malformed or oversized covers', () => {
    const jpeg = Buffer.from(JPEG_BASE64, 'base64')
    assert.equal(validate(artistData({ cover: `data:image/jpeg;base64,${JPEG_BASE64}` })).cover, `data:image/jpeg;base64,${JPEG_BASE64}`)

    for (const cover of [
      'data:image/png;base64,AAAA',
      'data:image/jpeg;base64,AAAA',
      `data:image/jpeg;base64,${MALFORMED_JPEG_BASE64}`,
      'data:image/jpeg;base64,/9j/2Q==',
      'data:image/jpeg;base64,AA==',
    ]) {
      assert.throws(() => validate(artistData({ cover })), { statusCode: 422 })
    }

    const oversized = Buffer.concat([jpeg.subarray(0, -2), Buffer.alloc(1.5 * 1024 * 1024), jpeg.subarray(-2)])
    const cover = `data:image/jpeg;base64,${oversized.toString('base64')}`
    assert.throws(() => validate(artistData({ cover })), { statusCode: 422 })
  })

  it('generates a complete deterministic document for an explicit year', () => {
    const json = Buffer.from(JSON.stringify(artistData()))
    const first = renderWebsite(defaultGenerators, 'artist-band', json, 2042)
    const second = renderWebsite(defaultGenerators, 'artist-band', json, 2042)

    assert.deepEqual(first, second)
    assert.match(first.toString(), /^<!DOCTYPE html>/)
    assert.match(first.toString(), /© 2042 DJ Nova · erstellt mit LeanWebsite/)
    assert.ok(!first.toString().includes('possebeats.de'))
    assert.notDeepEqual(first, renderWebsite(defaultGenerators, 'artist-band', json, 2043))
  })

  it('uses the same shared HTML renderer for the browser preview and backend output', () => {
    const data = validate(artistData())
    const preview = generateArtistBandHtml(data, 2042)
    const website = renderWebsite(defaultGenerators, 'artist-band', Buffer.from(JSON.stringify(data)), 2042)

    assert.equal(preview, website.toString())
  })

  it('keeps incomplete preview links from breaking the generated page', () => {
    const html = generateArtistBandHtml(artistData({
      spotify: 'javascript:alert(1)',
      tracks: [{ a: 'New Track', b: 'not a URL yet' }],
    }), 2042)

    assert.ok(!html.includes('javascript:'))
    assert.ok(!html.includes('href="not a URL yet"'))
    assert.ok(html.includes('New Track'))
  })

  it('saves and reloads validated data, then snapshots generated HTML for checkout', async () => {
    const sql = createFakeDb()
    const storage = createFakeStorage()
    const stripe = createFakeStripe()
    const { draftId, draftToken } = await createDraft({ sql, builderSlug: 'artist-band' })
    const data = artistData({ cover: `data:image/jpeg;base64,${JPEG_BASE64}` })

    await saveDraft({ sql, put: storage.putObject, generators: defaultGenerators, draftId, draftToken, builderSlug: 'artist-band', data })
    const loaded = await loadDraft({ sql, get: storage.getObject, draftId, draftToken })
    assert.deepEqual(loaded.data, validate(data))

    const { url } = await createCheckoutSession({
      sql,
      stripe,
      siteUrl: 'https://leanwebsite.example',
      request: { draftId, draftToken, builderSlug: 'artist-band', packageCode: 'artist-band-code-and-go' },
      storage,
      generators: defaultGenerators,
      year: 2042,
    })
    const order = sql.orders[0]
    const snapshot = storage.objects.get(order.snapshot_key)
    assert.match(url, /^https:\/\/checkout\.stripe\.com\//)
    assert.equal(order.snapshot_content_type, 'text/html')
    assert.match(snapshot.body.toString(), /© 2042 DJ Nova · erstellt mit LeanWebsite/)
    assert.equal(stripe.createCalls, 1)

    const snapshotBefore = Buffer.from(snapshot.body)
    sql.drafts[0].status = 'locked'
    order.status = 'paid'
    await assert.rejects(
      saveDraftContent({ sql, put: storage.putObject, draftId, draftToken, body: Buffer.from(JSON.stringify(data)), contentType: 'application/json' }),
      { statusCode: 409 },
    )
    assert.deepEqual(storage.objects.get(order.snapshot_key).body, snapshotBefore)
  })

  it('coordinates concurrent saves and a draft lock with immutable version objects', async () => {
    const sql = createFakeDb()
    const storage = createFakeStorage()
    const { draftId, draftToken } = await createDraft({ sql, builderSlug: 'artist-band' })
    const firstBody = Buffer.from('{"version":1}')
    const secondBody = Buffer.from('{"version":2}')
    const [first, second] = await Promise.all([
      saveDraftContent({ sql, put: storage.putObject, draftId, draftToken, body: firstBody, contentType: 'application/json' }),
      saveDraftContent({ sql, put: storage.putObject, draftId, draftToken, body: secondBody, contentType: 'application/json' }),
    ])
    const currentBody = storage.objects.get(sql.drafts[0].storage_key).body

    assert.notEqual(first.key, second.key)
    assert.ok(currentBody.equals(firstBody) || currentBody.equals(secondBody))
    assert.deepEqual(storage.objects.get(first.key).body, firstBody)
    assert.deepEqual(storage.objects.get(second.key).body, secondBody)

    let markWritten
    let finishWrite
    const written = new Promise((resolve) => {
      markWritten = resolve
    })
    const writeGate = new Promise((resolve) => {
      finishWrite = resolve
    })
    const put = async (key, body, options) => {
      await storage.putObject(key, body, options)
      markWritten()
      await writeGate
    }
    const previousKey = sql.drafts[0].storage_key
    const pending = saveDraftContent({ sql, put, draftId, draftToken, body: Buffer.from('{"version":3}'), contentType: 'application/json' })
    await written
    sql.drafts[0].status = 'locked'
    finishWrite()

    await assert.rejects(pending, { statusCode: 409 })
    assert.equal(sql.drafts[0].storage_key, previousKey)
    assert.deepEqual(storage.objects.get(previousKey).body, currentBody)
  })
})
