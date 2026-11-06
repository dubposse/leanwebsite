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
import { generateBusinessHtml } from '../shared/business-template.js'
import { createFakeDb, createFakeStorage, createFakeStripe } from './helpers/fakes.js'

const MALFORMED_JPEG_BASE64 =
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wCEAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSgBBwcHCggKEwoKEygaFhooKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKP/AABEIAAEAAQMBEQACEQEDEQH/xAGiAAABBQEBAQEBAQAAAAAAAAAAAQIDBAUGBwgJCgsQAAIBAwMCBAMFBQQEAAABfQECAwAEEQUSITFBBhNRYQcicRQygZGhCCNCscEVUtHwJDNicoIJChYXGBkaJSYnKCkqNDU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ4eHl6g4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2drh4uPk5ebn6Onq8fLz9PX29/j5+gEAAwEBAQEBAQEBAQEBAQECAwQFBgcICQoLEQACAQIEBAMEBwUEBAABAncAAQIDEQQFITEGEkFRB2FxEyIygQgUQpGhscEJIzNS8BVictEKFiQ04SXxFxgZGiYnKCkqNTY3ODk6Q0RFRkdISUpTVldYWVpjZGVmZ2hpanN0dXZ4eXqCg4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2drh4uPk5ebn6Onq8/T19vf4+fr/2gAMAwEAAhEDEQA/APOq+OP6RP8A/9k='

const JPEG_BASE64 = jpeg
  .encode({ data: Uint8Array.from([255, 0, 0, 255]), width: 1, height: 1 }, 80)
  .data.toString('base64')
const WEBP_DATA_URL =
  'data:image/webp;base64,UklGRgYCAABXRUJQVlA4WAoAAAAgAAAAAAAAAAAASUNDUMgBAAAAAAHIAAAAAAQwAABtbnRyUkdCIFhZWiAH4AABAAEAAAAAAABhY3NwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAA9tYAAQAAAADTLQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAlkZXNjAAAA8AAAACRyWFlaAAABFAAAABRnWFlaAAABKAAAABRiWFlaAAABPAAAABR3dHB0AAABUAAAABRyVFJDAAABZAAAAChnVFJDAAABZAAAAChiVFJDAAABZAAAAChjcHJ0AAABjAAAADxtbHVjAAAAAAAAAAEAAAAMZW5VUwAAAAgAAAAcAHMAUgBHAEJYWVogAAAAAAAAb6IAADj1AAADkFhZWiAAAAAAAABimQAAt4UAABjaWFlaIAAAAAAAACSgAAAPhAAAts9YWVogAAAAAAAA9tYAAQAAAADTLXBhcmEAAAAAAAQAAAACZmYAAPKnAAANWQAAE9AAAApbAAAAAAAAAABtbHVjAAAAAAAAAAEAAAAMZW5VUwAAACAAAAAcAEcAbwBvAGcAbABlACAASQBuAGMALgAgADIAMAAxADZWUDggGAAAADABAJ0BKgEAAQABQCYlpAADcAD+/PQAAA=='

function artistData(overrides = {}) {
  return {
    name: 'DJ Nova',
    genre: 'Techno · Acid · Electro',
    tagline: 'Basslines für die Nacht.',
    bio: 'Produzent und DJ aus der Posse.',
    accent: '#c6ff00',
    theme: 'dark',
    contentFont: 'standard',
    contentColor: 'auto',
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

function artistCss(html) {
  return html.match(/<style>\n([\s\S]*?)\n<\/style>/)?.[1] ?? ''
}

const validate = (data) => validateBuilderData(defaultGenerators, 'artist-band', data).data
const validateBusiness = (data) => validateBuilderData(defaultGenerators, 'business', data).data

function businessData(overrides = {}) {
  return {
    company: { name: 'Nordlicht Studio', tagline: 'Gute Ideen, klar umgesetzt.', industry: 'Design' },
    logo: '',
    hero: { headline: 'Wir gestalten Zukunft.', sub: 'Für Menschen und Unternehmen.', cta: 'Anfragen', badge: 'Seit 2012', image: '' },
    services: [{ icon: '✨', title: 'Strategie', text: 'Marken mit Charakter.' }],
    about: { title: 'Über uns', text: 'Ein kleines, erfahrenes Team.', image: '' },
    facts: [{ value: '12+', label: 'Jahre Erfahrung' }],
    gallery: [],
    contact: { email: 'hallo@example.com', phone: '+49 30 123456', address: 'Berlin', hours: 'Mo–Fr', instagram: 'https://instagram.com/nordlicht' },
    design: { accent: '#8b5cf6', accent2: '#22d3ee', mode: 'dark', radius: '16' },
    legal: { owner: 'Mara Beispiel', vat: 'DE123456789', domain: 'www.example.com', notes: 'Bitte barrierearm.' },
    ...overrides,
  }
}

describe('builder generators', () => {
  it('is registered and validates the real artist and band data model', () => {
    assert.ok(defaultGenerators['artist-band'])
    assert.deepEqual(validate(artistData()), artistData())
    assert.deepEqual(validate(artistData({ spotify: 'https://open.spotify.com/artist/example' })).spotify, 'https://open.spotify.com/artist/example')
  })

  it('defaults legacy drafts to standard typography and automatic text color', () => {
    const legacy = artistData()
    delete legacy.contentFont
    delete legacy.contentColor

    assert.deepEqual(validate(legacy), artistData())
    const html = generateArtistBandHtml(legacy, 2042)
    const css = artistCss(html)
    assert.match(html, /<body data-content-font="standard" data-content-color="auto">/)
    assert.match(css, /body:not\(\[data-content-color="accent"\]\):not\(\[data-content-color="claim"\]\)\{--content-fg:var\(--fg\)\}/)
    assert.match(css, /\.content-section\{color:var\(--content-fg\);/)
    assert.match(css, /section\{width:min\(var\(--content-width\),calc\(100% - var\(--page-gutter\) - var\(--page-gutter\)\)\);margin-inline:var\(--page-gutter\);/)
    assert.match(css, /\.hero\{[^}]*padding:8vw var\(--page-gutter\) 6vw/)
    assert.equal((css.match(/{/g) ?? []).length, (css.match(/}/g) ?? []).length)
  })

  it('applies each selected content typography and color in generated HTML and CSS', () => {
    const genreAccent = validate(artistData({ contentFont: 'genre', contentColor: 'accent' }))
    const genreHtml = generateArtistBandHtml(genreAccent, 2042)
    const genreCss = artistCss(genreHtml)
    assert.equal(genreAccent.accent, '#c6ff00')
    assert.match(genreHtml, /<body data-content-font="genre" data-content-color="accent">/)
    assert.match(genreCss, /body\[data-content-color="accent"\]\{--content-fg:var\(--acc\)\}/)
    assert.match(genreCss, /body\[data-content-font="genre"\] \.content-section\{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:\.95rem;letter-spacing:\.025em;line-height:1\.7\}/)
    assert.match(genreCss, /body\[data-content-font="genre"\] \.content-section h2\{font-size:\.8rem;letter-spacing:\.3em\}/)
    assert.match(genreHtml, /<section class="content-section"><h2>Über<\/h2>/)
    assert.equal((genreCss.match(/{/g) ?? []).length, (genreCss.match(/}/g) ?? []).length)

    const claimColor = validate(artistData({ contentFont: 'claim', contentColor: 'claim' }))
    const claimHtml = generateArtistBandHtml(claimColor, 2042)
    const claimCss = artistCss(claimHtml)
    assert.match(claimHtml, /<body data-content-font="claim" data-content-color="claim">/)
    assert.match(claimCss, /body\[data-content-color="claim"\]\{--content-fg:var\(--mut\)\}/)
    assert.match(claimCss, /body\[data-content-font="claim"\] \.content-section\{font-family:Georgia,"Times New Roman",serif;font-size:1\.15rem;letter-spacing:\.01em;line-height:1\.75\}/)
    assert.match(claimCss, /body\[data-content-font="claim"\] \.content-section h2\{font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;font-size:1rem;letter-spacing:\.18em\}/)
    assert.equal((claimCss.match(/{/g) ?? []).length, (claimCss.match(/}/g) ?? []).length)
    assert.equal(
      generateArtistBandHtml(claimColor, 2042),
      renderWebsite(defaultGenerators, 'artist-band', Buffer.from(JSON.stringify(claimColor)), 2042).toString(),
    )
  })

  describe('business generator', () => {
    it('is registered and allows saving an incomplete draft with default values', () => {
      assert.ok(defaultGenerators.business)
      assert.deepEqual(validateBusiness({}), {
        company: { name: '', tagline: '', industry: '' },
        logo: '',
        hero: { headline: '', sub: '', cta: '', badge: '', image: '' },
        services: [{ icon: '🚀', title: '', text: '' }],
        about: { title: '', text: '', image: '' },
        facts: [],
        gallery: [],
        contact: { email: '', phone: '', address: '', hours: '', instagram: '' },
        design: { accent: '#8b5cf6', accent2: '#22d3ee', mode: 'dark', radius: '16' },
        legal: { owner: '', vat: '', domain: '', notes: '' },
      })
      assert.equal(validateBusiness({ company: { name: 'Teilweise' } }).company.name, 'Teilweise')
    })

    it('preserves every valid business field, including optional and not-yet-rendered values', () => {
      const image = `data:image/jpeg;base64,${JPEG_BASE64}`
      const data = businessData({
        logo: image,
        hero: { ...businessData().hero, image },
        about: { ...businessData().about, image },
        services: Array.from({ length: 8 }, (_, index) => ({ icon: '🚀', title: `Service ${index}`, text: 'Beschreibung' })),
        facts: Array.from({ length: 4 }, (_, index) => ({ value: `${index}+`, label: `Fakt ${index}` })),
        gallery: [image, image, image],
      })

      assert.deepEqual(validateBusiness(data), data)
    })

    it('accepts three gallery images and rejects a fourth without truncating data', () => {
      const image = `data:image/jpeg;base64,${JPEG_BASE64}`
      assert.equal(validateBusiness(businessData({ gallery: [image, image, image] })).gallery.length, 3)
      assert.throws(() => validateBusiness(businessData({ gallery: [image, image, image, image] })), { statusCode: 422 })
      assert.equal(generateBusinessHtml(businessData({ gallery: [image, image, image, image] })).match(/class="rv" src="data:image\/jpeg/g).length, 4)
    })

    it('accepts WebP data URLs produced by the browser canvas image processor', () => {
      assert.equal(validateBusiness(businessData({ logo: WEBP_DATA_URL })).logo, WEBP_DATA_URL)
    })

    it('rejects invalid images, design options, lengths, and array bounds', () => {
      for (const data of [
        businessData({ logo: 'https://example.com/logo.jpg' }),
        businessData({ logo: 'data:image/svg+xml;base64,PHN2Zz4=' }),
        businessData({ logo: 'data:image/jpeg;base64,AAAA' }),
        businessData({ logo: `data:image/jpeg;base64,${MALFORMED_JPEG_BASE64}` }),
        businessData({ design: { ...businessData().design, accent: 'red' } }),
        businessData({ design: { ...businessData().design, mode: 'system' } }),
        businessData({ design: { ...businessData().design, radius: '12' } }),
        businessData({ company: { name: 'x'.repeat(101), tagline: '', industry: '' } }),
        businessData({ company: { ...businessData().company, tagline: 'x'.repeat(181) } }),
        businessData({ services: Array.from({ length: 9 }, () => ({ icon: '', title: '', text: '' })) }),
        businessData({ services: [{ icon: '', title: '', text: 'x'.repeat(1001) }] }),
        businessData({ facts: Array.from({ length: 5 }, () => ({ value: '', label: '' })) }),
        businessData({ gallery: ['data:image/webp;base64,AAAA'] }),
        businessData({ contact: { ...businessData().contact, email: 'invalid' } }),
        businessData({ contact: { ...businessData().contact, instagram: 'javascript:alert(1)' } }),
        businessData({ company: { name: 'x', tagline: '', industry: '', extra: 'unexpected' } }),
      ]) {
        assert.throws(() => validateBusiness(data), { statusCode: 422 })
      }
    })

    it('rejects aggregate image data that exceeds the existing 4 MiB draft request limit', () => {
      const comment = Buffer.alloc(65537)
      comment.writeUInt16BE(0xfffe, 0)
      comment.writeUInt16BE(0xffff, 2)
      const jpegWithComments = Buffer.concat([
        Buffer.from(JPEG_BASE64, 'base64').subarray(0, 2),
        ...Array.from({ length: 22 }, () => comment),
        Buffer.from(JPEG_BASE64, 'base64').subarray(2),
      ])
      const image = `data:image/jpeg;base64,${jpegWithComments.toString('base64')}`
      assert.ok(Buffer.byteLength(image) < 2 * 1024 * 1024)
      assert.throws(() => validateBusiness(businessData({ logo: image, gallery: [image, image] })), { statusCode: 422 })
    })

    it('generates complete website HTML through the registered server renderer', () => {
      const data = businessData()
      const html = renderWebsite(defaultGenerators, 'business', Buffer.from(JSON.stringify(data)), 2042).toString()

      assert.equal(html, generateBusinessHtml(data))
      assert.match(html, /^<!DOCTYPE html>/)
      assert.match(html, /@keyframes shine/)
      assert.match(html, /id="lb"/)
      assert.match(html, /IntersectionObserver/)
      assert.match(html, /<strong>Impressum<\/strong>/)
      assert.match(html, /Nordlicht Studio/)
    })
  })

  it('rejects invalid types, themes, colors, URLs, emails, rows and lengths', () => {
    for (const data of [
      artistData({ name: '' }),
      artistData({ name: 7 }),
      artistData({ tagline: 'x'.repeat(181) }),
      artistData({ theme: 'custom' }),
      artistData({ contentFont: 'serif' }),
      artistData({ contentColor: '#ffffff' }),
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
    const data = artistData({
      cover: `data:image/jpeg;base64,${JPEG_BASE64}`,
      contentFont: 'claim',
      contentColor: 'accent',
    })

    await saveDraft({ sql, put: storage.putObject, generators: defaultGenerators, draftId, draftToken, builderSlug: 'artist-band', data })
    const loaded = await loadDraft({ sql, get: storage.getObject, draftId, draftToken })
    assert.deepEqual(loaded.data, validate(data))
    assert.equal(loaded.data.contentFont, 'claim')
    assert.equal(loaded.data.contentColor, 'accent')

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
    assert.match(snapshot.body.toString(), /data-content-font="claim" data-content-color="accent"/)
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
