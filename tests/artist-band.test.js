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
import { artistBandLegalErrors, LEGAL_DEFAULTS } from '../shared/artist-band-legal.js'
import { loadPaidSnapshot } from '../api/_lib/downloads.js'
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
    gigsHeading: 'Live',
    gigs: [{ a: '2026-11-21', b: 'Berlin · Club Posse' }],
    ...overrides,
  }
}

function legalData(overrides = {}) {
  return {
    ...LEGAL_DEFAULTS,
    operatorName: 'Ada Beispiel',
    street: 'Musterstraße 1',
    postalCode: '10115',
    city: 'Berlin',
    country: 'Deutschland',
    email: 'ada@example.de',
    confirmPublic: true,
    confirmReviewed: true,
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
  it('uses self-contained fragment views for legal information without scripts', () => {
    for (const packageCode of ['artist-band-code-and-go', 'artist-band-rundum-sorglos']) {
      const data = artistData({ legal: legalData() })
      const html = renderWebsite(defaultGenerators, 'artist-band', Buffer.from(JSON.stringify(data)), 2042, packageCode).toString()
      assert.match(html, /\.legal-section\{display:none;/)
      assert.match(html, /\.legal-section:target\{display:block\}/)
      assert.match(html, /\.legal-section:target ~ \.site-main\{display:none\}/)
      assert.match(html, /<section id="impressum"[\s\S]*?href="#website"[\s\S]*?<\/section>\s*<section id="datenschutz"[\s\S]*?href="#website"[\s\S]*?<\/section>\s*<div id="website" class="site-main">/)
      assert.match(html, /href="#impressum">Impressum<\/a>/)
      assert.match(html, /href="#datenschutz">Datenschutz<\/a>/)
      assert.match(html, /Ada Beispiel/)
      assert.match(html, /Diese Datenschutzerklärung gilt für die aktuelle technische Ausgestaltung der Website\./)
      assert.doesNotMatch(html, /<script\b|<base\b/i)
    }
  })

  it('validates operator types, conditional fields and confirmations for checkout', () => {
    for (const operatorType of ['person', 'gbr', 'association', 'company']) {
      const legal = legalData({ operatorType, representative: 'Ada Vertreter', legalForm: 'GmbH' })
      assert.deepEqual(artistBandLegalErrors(legal, 'artist-band-code-and-go'), [])
      assert.deepEqual(validate(artistData({ legal })).legal, legal)
      if (operatorType !== 'person') {
        assert.ok(artistBandLegalErrors({ ...legal, representative: '' }, 'artist-band-code-and-go').some((e) => e.field === 'representative'))
      }
    }
    const errors = artistBandLegalErrors(legalData({
      operatorType: 'company', legalForm: '', registered: true, editorial: true,
      email: 'invalid', hostingProvider: 'other', domainProvider: 'other',
      confirmPublic: false, confirmReviewed: false,
    }), 'artist-band-code-and-go').map((error) => error.field)
    for (const field of ['legalForm', 'representative', 'email', 'registerCourt', 'registerNumber', 'editorialName', 'editorialAddress', 'hostingOther', 'domainOther', 'confirmPublic', 'confirmReviewed']) {
      assert.ok(errors.includes(field), field)
    }
    assert.ok(!artistBandLegalErrors(legalData({ hostingProvider: 'other' }), 'artist-band-rundum-sorglos').some((e) => e.field === 'hostingOther'))
    assert.throws(() => validate(artistData({ legal: { operatorType: 'invalid' } })), { statusCode: 422 })
    assert.throws(() => validate(artistData({ legal: { unexpected: 'x' } })), { statusCode: 422 })
  })

  it('renders the supplied legal texts safely with preview placeholders and package-specific hosting', () => {
    const preview = generateArtistBandHtml(artistData(), 2042)
    assert.match(preview, /href="#impressum"/)
    assert.match(preview, /href="#datenschutz"/)
    assert.match(preview, /Die Hostingangaben müssen vor Veröffentlichung ergänzt werden/)
    const legal = legalData({
      operatorType: 'company', legalForm: 'GmbH', representative: 'A & B',
      operatorName: '<script>alert(1)</script>', registered: true, registerCourt: 'Berlin',
      registerNumber: '123', editorial: true, editorialName: 'Ada', editorialAddress: 'Berlin',
      hostingProvider: 'other', hostingOther: 'Beispielhosting',
    })
    const html = generateArtistBandHtml(artistData({ legal }), 2042, undefined, 'artist-band-code-and-go')
    assert.ok(!html.includes('<script>'))
    assert.match(html, /&#60;script&#62;alert\(1\)&#60;\/script&#62;/)
    assert.match(html, /Diese Website wird bei Beispielhosting betrieben/)
    assert.match(html, /Registerangaben/)
    assert.match(html, /journalistisch-redaktionelle Inhalte gemäß § 18 Abs\. 2 MStV/)
    for (const text of [
      'Angaben gemäß § 5 DDG',
      'Diese Website kann Links zu externen Angeboten enthalten. Für deren Inhalte sind die jeweiligen Anbieter verantwortlich.',
      'Auf die Gestaltung und Inhalte externer Websites besteht kein unmittelbarer Einfluss.',
      'Verantwortlich für die Verarbeitung personenbezogener Daten auf dieser Website ist:',
      'Beim Aufruf der Website können technisch erforderliche Informationen verarbeitet werden, insbesondere IP-Adresse, Datum und Uhrzeit des Zugriffs, angeforderte Inhalte sowie Browser- und Geräteinformationen.',
      'Diese Verarbeitung dient der technischen Bereitstellung, Stabilität und Sicherheit der Website. Rechtsgrundlage ist Art. 6 Abs. 1 lit. f DSGVO.',
      'Die konkrete Speicherung, Speicherdauer und gegebenenfalls Weitergabe dieser Daten richten sich nach den technischen und vertraglichen Bedingungen des eingesetzten Hostinganbieters.',
      'Diese Website verwendet in ihrer bereitgestellten Grundversion keine eigenen Cookies, Analysewerkzeuge oder Trackingdienste.',
      'Wenn Sie per E-Mail Kontakt aufnehmen, werden Ihre übermittelten Angaben zur Bearbeitung Ihrer Anfrage verarbeitet.',
      'Rechtsgrundlage ist je nach Anlass Art. 6 Abs. 1 lit. b oder lit. f DSGVO.',
      'Die Daten werden gelöscht, sobald sie für die Bearbeitung nicht mehr benötigt werden und keine gesetzlichen Aufbewahrungspflichten entgegenstehen.',
      'Diese Website enthält gegebenenfalls Links zu externen Plattformen wie Musikdiensten oder sozialen Netzwerken.',
      'Erst beim Aufrufen dieser Links verlassen Sie diese Website. Für die dortige Datenverarbeitung gelten die Datenschutzhinweise der jeweiligen Anbieter.',
      'Sie haben im Rahmen der gesetzlichen Voraussetzungen das Recht auf Auskunft, Berichtigung, Löschung, Einschränkung der Verarbeitung, Datenübertragbarkeit sowie Widerspruch gegen bestimmte Verarbeitungen.',
      'Sie können sich außerdem bei einer zuständigen Datenschutzaufsichtsbehörde beschweren.',
      'Diese Datenschutzerklärung gilt für die aktuelle technische Ausgestaltung der Website.',
      'Werden weitere Dienste, Funktionen oder Datenverarbeitungen hinzugefügt, muss sie entsprechend angepasst werden.',
    ]) assert.ok(html.includes(text), text)
    const managed = generateArtistBandHtml(artistData({ legal }), 2042, undefined, 'artist-band-rundum-sorglos')
    assert.match(managed, /Diese Website wird bei Hostinger betrieben/)
    assert.ok(!managed.includes('Diese Website wird bei Beispielhosting betrieben'))
  })

  it('binds legal information and confirmed package hosting to each paid website download', async () => {
    for (const packageCode of ['artist-band-code-and-go', 'artist-band-rundum-sorglos']) {
      const sql = createFakeDb()
      const storage = createFakeStorage()
      const stripe = createFakeStripe()
      const { draftId, draftToken } = await createDraft({ sql, builderSlug: 'artist-band' })
      const data = artistData({ legal: legalData({ hostingProvider: 'IONOS' }) })
      await saveDraft({ sql, put: storage.putObject, generators: defaultGenerators, draftId, draftToken, builderSlug: 'artist-band', data })
      const fulfillmentData = {
        firstName: 'Ada', lastName: 'Beispiel', billingStreet: 'Straße 1', billingPostalCode: '10115',
        billingCity: 'Berlin', billingCountryCode: 'DE', communicationEmail: 'ada@example.de',
        desiredDomain: 'beispiel.de', alternativeDomain: null, domainHolderDiffers: false, hostingerConsent: true,
      }
      await createCheckoutSession({
        sql, stripe, storage, generators: defaultGenerators, siteUrl: 'https://leanwebsite.example', year: 2042,
        request: { draftId, draftToken, builderSlug: 'artist-band', packageCode, ...(packageCode.endsWith('rundum-sorglos') && { fulfillmentData }) },
      })
      sql.orders[0].status = 'paid'
      const download = await loadPaidSnapshot({ sql, storage, body: { draftId, draftToken } })
      const html = download.body.toString()
      assert.equal(download.fileName, 'website.html')
      assert.match(html, /<section id="impressum"/)
      assert.match(html, /<section id="datenschutz"/)
      assert.ok(html.includes('Diese Website verwendet in ihrer bereitgestellten Grundversion keine eigenen Cookies, Analysewerkzeuge oder Trackingdienste.'))
      assert.ok(html.includes(`Diese Website wird bei ${packageCode.endsWith('rundum-sorglos') ? 'Hostinger' : 'IONOS'} betrieben.`))
    }
  })

  it('allows old and incomplete drafts to be saved but rejects incomplete legal data before checkout', async () => {
    const sql = createFakeDb()
    const storage = createFakeStorage()
    const stripe = createFakeStripe()
    const { draftId, draftToken } = await createDraft({ sql, builderSlug: 'artist-band' })
    for (const data of [artistData(), artistData({ legal: { operatorName: 'Ada' } })]) {
      await saveDraft({ sql, put: storage.putObject, generators: defaultGenerators, draftId, draftToken, builderSlug: 'artist-band', data })
      const loaded = await loadDraft({ sql, get: storage.getObject, draftId, draftToken })
      assert.equal(loaded.data.name, 'DJ Nova')
      await assert.rejects(createCheckoutSession({
        sql, stripe, storage, generators: defaultGenerators, siteUrl: 'https://leanwebsite.example', year: 2042,
        request: { draftId, draftToken, builderSlug: 'artist-band', packageCode: 'artist-band-code-and-go' },
      }), { statusCode: 422 })
      assert.equal(stripe.createCalls, 0)
    }
  })

  it('is registered and validates the real artist and band data model', () => {
    assert.ok(defaultGenerators['artist-band'])
    assert.deepEqual(validate(artistData()), artistData())
    assert.deepEqual(validate(artistData({ spotify: 'https://open.spotify.com/artist/example' })).spotify, 'https://open.spotify.com/artist/example')
  })

  it('defaults and validates the gig heading for current and legacy data', () => {
    const legacy = artistData()
    delete legacy.gigsHeading
    for (const data of [legacy, artistData({ gigsHeading: '' }), artistData({ gigsHeading: '   ' })]) {
      assert.equal(validate(data).gigsHeading, 'Live')
      assert.match(generateArtistBandHtml(data, 2042), /<h2>Live<\/h2><div class="row gig-row">/)
      assert.match(renderWebsite(defaultGenerators, 'artist-band', Buffer.from(JSON.stringify(data)), 2042).toString(), /<h2>Live<\/h2><div class="row gig-row">/)
    }
    assert.equal(validate(artistData({ gigsHeading: 'x'.repeat(40) })).gigsHeading.length, 40)
    for (const gigsHeading of ['x'.repeat(41), null, 123]) {
      assert.throws(() => validate(artistData({ gigsHeading })), { statusCode: 422 })
    }
  })

  it('escapes the gig heading identically in preview and server output for both packages', () => {
    const gigs = [{ a: '2026-11-21', b: 'Berlin · Club Posse' }, { a: 'Termin offen', b: 'Bandprobe' }]
    for (const gigsHeading of ['Bandmitglieder', '<Band & "Freunde">']) {
      const data = validate(artistData({ gigsHeading, gigs }))
      const expected = gigsHeading === 'Bandmitglieder' ? gigsHeading : '&#60;Band &#38; &#34;Freunde&#34;&#62;'
      for (const packageCode of ['artist-band-code-and-go', 'artist-band-rundum-sorglos']) {
        const preview = generateArtistBandHtml(data, 2042, undefined, packageCode)
        const download = renderWebsite(defaultGenerators, 'artist-band', Buffer.from(JSON.stringify(data)), 2042, packageCode).toString()
        assert.equal(preview, download)
        assert.ok(preview.includes(`<h2>${expected}</h2><div class="row gig-row">`))
        assert.match(preview, /datetime="2026-11-21" aria-label="21\. November 2026"/)
        assert.match(preview, /<span class="gig-date-text">Termin offen<\/span><span>Bandprobe<\/span>/)
        assert.match(preview, /<h2>Über<\/h2>/)
        assert.match(preview, /<h2>Releases<\/h2>/)
      }
    }
  })

  it('saves and reloads the gig heading with unchanged gig data', async () => {
    const sql = createFakeDb()
    const storage = createFakeStorage()
    const { draftId, draftToken } = await createDraft({ sql, builderSlug: 'artist-band' })
    const data = artistData({ gigsHeading: 'Bandmitglieder', gigs: [{ a: 'Termin offen', b: 'Berlin' }] })
    await saveDraft({ sql, put: storage.putObject, generators: defaultGenerators, draftId, draftToken, builderSlug: 'artist-band', data })
    const loaded = await loadDraft({ sql, get: storage.getObject, draftId, draftToken })
    assert.equal(loaded.data.gigsHeading, 'Bandmitglieder')
    assert.deepEqual(loaded.data.gigs, data.gigs)
    assert.match(generateArtistBandHtml(loaded.data, 2042), /<h2>Bandmitglieder<\/h2>/)
  })

  it('renders every ISO gig month and both single- and double-digit days without changing stored data', () => {
    const months = [
      ['JAN', 'Januar'], ['FEB', 'Februar'], ['MÄR', 'März'], ['APR', 'April'],
      ['MAI', 'Mai'], ['JUN', 'Juni'], ['JUL', 'Juli'], ['AUG', 'August'],
      ['SEP', 'September'], ['OKT', 'Oktober'], ['NOV', 'November'], ['DEZ', 'Dezember'],
    ]
    const gigs = months.map((_, index) => ({
      a: `2026-${String(index + 1).padStart(2, '0')}-${index % 2 ? '21' : '01'}`,
      b: `Ort ${index + 1}`,
    }))
    const data = validate(artistData({ gigs }))
    assert.deepEqual(data.gigs, gigs)
    for (const contentFont of ['standard', 'genre', 'claim']) {
      const selected = { ...data, contentFont }
      const html = generateArtistBandHtml(selected, 2042)
      assert.equal(html, renderWebsite(defaultGenerators, 'artist-band', Buffer.from(JSON.stringify(selected)), 2042).toString())
      for (const [index, [short, full]] of months.entries()) {
        const day = index % 2 ? 21 : 1
        assert.ok(html.includes(`<time class="gig-date" datetime="${gigs[index].a}" aria-label="${day}. ${full} 2026"><span class="gig-day">${day}</span><span class="gig-month">${short}</span></time>`))
        assert.ok(html.includes(`<span>Ort ${index + 1}</span><span class="gig-year" aria-hidden="true">2026</span>`))
      }
    }
  })

  it('preserves escaped free-text and incomplete gig dates and rejects invalid calendar dates', () => {
    const gigs = [
      { a: '2024-02-29', b: 'Schaltjahr' },
      { a: '2025-02-29', b: 'Kein Schaltjahr' },
      { a: '2026-04-31', b: '' },
      { a: '2026-13-01', b: '' },
      { a: '0000-01-01', b: '' },
      { a: 'Termin <offen>', b: 'Club & Bar' },
      { a: '', b: 'Nur Ort' },
      { a: '2026-', b: '' },
    ]
    const html = generateArtistBandHtml(artistData({ gigs }), 2042)
    assert.match(html, /datetime="2024-02-29" aria-label="29\. Februar 2024"/)
    for (const value of ['2025-02-29', '2026-04-31', '2026-13-01', '0000-01-01', '2026-']) {
      assert.ok(html.includes(`<span class="gig-date-text">${value}</span>`))
      assert.ok(!html.includes(`datetime="${value}"`))
    }
    assert.ok(html.includes('Termin &#60;offen&#62;'))
    assert.ok(html.includes('Club &#38; Bar'))
    assert.ok(html.includes('<span>Nur Ort</span>'))
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
    assert.match(genreCss, /\.genre,body\[data-content-font="genre"\] \.content-section,body\[data-content-font="genre"\] \.content-section h2\{letter-spacing:\.3em\}/)
    assert.match(genreCss, /body\[data-content-font="genre"\] \.content-section\{font-size:\.95rem;line-height:1\.7\}/)
    assert.match(genreCss, /body\[data-content-font="genre"\] \.content-section h2\{font-size:\.8rem\}/)
    assert.match(genreCss, /\.content-section h2\{font-size:\.85rem;font-weight:inherit;text-transform:none;color:inherit;margin:0 0 1rem\}/)
    assert.match(genreCss, /\.content-section p\{margin:0;line-height:1\.75\}/)
    assert.match(genreHtml, /<section class="content-section"><h2>Über<\/h2>/)
    assert.equal((genreCss.match(/{/g) ?? []).length, (genreCss.match(/}/g) ?? []).length)

    const claimColor = validate(artistData({ contentFont: 'claim', contentColor: 'claim' }))
    const claimHtml = generateArtistBandHtml(claimColor, 2042)
    const claimCss = artistCss(claimHtml)
    assert.match(claimHtml, /<body data-content-font="claim" data-content-color="claim">/)
    assert.match(claimCss, /body\[data-content-color="claim"\]\{--content-fg:var\(--mut\)\}/)
    assert.match(claimCss, /body\[data-content-font="claim"\] \.content-section\{font-size:1\.15rem;line-height:1\.75\}/)
    assert.match(claimCss, /body\[data-content-font="claim"\] \.content-section h2\{font-size:1rem\}/)
    assert.doesNotMatch(claimCss, /ui-monospace|Georgia,"Times New Roman"/)
    assert.equal((claimCss.match(/{/g) ?? []).length, (claimCss.match(/}/g) ?? []).length)
    assert.equal(
      generateArtistBandHtml(claimColor, 2042),
      renderWebsite(defaultGenerators, 'artist-band', Buffer.from(JSON.stringify(claimColor)), 2042).toString(),
    )
  })

  it('preserves every font and color selection across validation, preview and download', () => {
    for (const contentFont of ['standard', 'genre', 'claim']) {
      for (const contentColor of ['auto', 'accent', 'claim']) {
        const data = validate(artistData({ contentFont, contentColor, bio: 'Produzent und DJ aus der Posse.' }))
        const preview = generateArtistBandHtml(data, 2042)
        const download = renderWebsite(defaultGenerators, 'artist-band', Buffer.from(JSON.stringify(data)), 2042).toString()
        assert.equal(preview, download)
        assert.match(preview, new RegExp(`<body data-content-font="${contentFont}" data-content-color="${contentColor}">`))
        assert.match(preview, /<p>Produzent und DJ aus der Posse\.<\/p>/)
      }
    }
  })

  it('saves and restores all content font selections in drafts', async () => {
    const sql = createFakeDb()
    const storage = createFakeStorage()
    const { draftId, draftToken } = await createDraft({ sql, builderSlug: 'artist-band' })
    for (const contentFont of ['standard', 'genre', 'claim']) {
      const data = artistData({ contentFont })
      await saveDraft({ sql, put: storage.putObject, generators: defaultGenerators, draftId, draftToken, builderSlug: 'artist-band', data })
      const loaded = await loadDraft({ sql, get: storage.getObject, draftId, draftToken })
      assert.equal(loaded.data.contentFont, contentFont)
    }
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
      assert.match(html, /<h1>Impressum<\/h1>/)
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
    assert.match(first.toString(), /© 2042 DJ Nova<nav class="legal-links"/)
    assert.doesNotMatch(first.toString(), /erstellt mit LeanWebsite/)
    assert.match(first.toString(), /<a href="#impressum">Impressum<\/a><a href="#datenschutz">Datenschutz<\/a>/)
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
      legal: legalData(),
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
    assert.match(snapshot.body.toString(), /© 2042 DJ Nova<nav class="legal-links"/)
    assert.doesNotMatch(snapshot.body.toString(), /erstellt mit LeanWebsite/)
    assert.match(snapshot.body.toString(), /<a href="#impressum">Impressum<\/a><a href="#datenschutz">Datenschutz<\/a>/)
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
