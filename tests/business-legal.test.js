import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { defaultGenerators, renderWebsite, validateBuilderData } from '../api/_lib/generators.js'
import { BUSINESS_OPERATOR_DEFAULTS } from '../shared/business-operator.js'
import { generateBusinessHtml } from '../shared/business-template.js'

const operator = (overrides = {}) => ({
  ...BUSINESS_OPERATOR_DEFAULTS,
  operatorName: 'Ada Betreiberin', street: 'Musterweg 1', postalCode: '10115',
  city: 'Berlin', country: 'Deutschland', email: 'ada@example.de',
  confirmPublic: 'true', confirmReviewed: 'true', ...overrides,
})
const data = (overrides = {}) => validateBuilderData(defaultGenerators, 'business', {
  company: { name: 'Firma' }, contact: { email: 'website@example.de', address: 'Kontaktanschrift' },
  legal: { owner: 'Früherer Inhaber', vat: 'Alte USt' }, ...overrides,
}).data
const legalView = (html, id) => html.match(new RegExp(`<section id="${id}" class="legal-view">([\\s\\S]*?)</section>`))[1]

describe('business legal website views', () => {
  it('uses the operator for all four forms and only applicable additional details', () => {
    for (const [type, form] of [['person', ''], ['gbr', 'GbR'], ['association', 'Verein'], ['company', 'GmbH']]) {
      const state = data({ operator: operator({ operatorType: type, legalForm: 'GmbH', representative: 'Ada und Ben' }) })
      const view = legalView(generateBusinessHtml(state), 'impressum')
      assert.match(view, /Ada Betreiberin<br>/)
      assert.match(view, /Musterweg 1<br>10115 Berlin<br>Deutschland/)
      assert.match(view, /E-Mail: ada@example\.de/)
      assert.doesNotMatch(view, /Kontaktanschrift|Früherer Inhaber|Alte USt|website@example/)
      assert.equal(view.includes('Vertretungsberechtigt: Ada und Ben'), type !== 'person')
      if (form) assert.ok(view.includes(`<br>${form}`))
      assert.doesNotMatch(view, /Registerangaben|Umsatzsteuer-Identifikationsnummer|journalistisch-redaktionelle Inhalte|Telefon:/)
    }
    const view = legalView(generateBusinessHtml(data({ operator: operator({
      registered: 'true', registerCourt: 'Amtsgericht', registerNumber: 'HRB 123',
      editorial: 'true', editorialName: 'Ben', editorialAddress: 'Weg 2\nBerlin',
      vatId: 'DE123', phone: '+49 123',
    }) })), 'impressum')
    for (const text of ['Registerangaben', 'Amtsgericht', 'HRB 123', 'DE123', 'Telefon: +49 123', 'Ben<br>Weg 2<br>Berlin']) assert.ok(view.includes(text))
  })

  it('renders provider selections without inventing hosting details', () => {
    const custom = data({ operator: operator({ hostingProvider: 'other', hostingOther: 'Mein Hosting', domainProvider: 'IONOS' }) })
    const pure = legalView(generateBusinessHtml(custom, { packageCode: 'business-pure-code' }), 'datenschutz')
    assert.match(pure, /Als Hostinganbieter ist Mein Hosting angegeben/)
    assert.match(pure, /Als Domainanbieter ist IONOS angegeben/)
    const managed = legalView(generateBusinessHtml(custom, { packageCode: 'business-rundum-sorglos' }), 'datenschutz')
    assert.match(managed, /Als Hostinganbieter ist Hostinger vorgesehen/)
    assert.match(managed, /Als Domainanbieter ist Hostinger vorgesehen/)
    assert.doesNotMatch(managed, /Mein Hosting|IONOS/)
    const unknown = legalView(generateBusinessHtml(data({ operator: operator() }), { packageCode: 'business-pure-code' }), 'datenschutz')
    assert.match(unknown, /Hostingangaben müssen vor Veröffentlichung ergänzt werden/)
    assert.doesNotMatch(unknown, /Als Domainanbieter/)
    for (const text of ['Serverprotokolle', 'IP-Adresse', 'E-Mail oder telefonisch', 'Cookies', 'Tracking', 'Galerie', 'Bildvergrößerung', 'Kopieren', 'Datenschutzaufsichtsbehörde', 'Aktualisierung']) assert.ok(unknown.includes(text))
  })

  it('escapes operator, conditional and provider fields', () => {
    const payload = '<img src=x onerror="alert(1)">'
    const html = generateBusinessHtml(data({ operator: operator({
      operatorName: payload, operatorType: 'company', legalForm: payload, representative: payload,
      street: payload, city: payload, phone: payload, registered: 'true', registerCourt: payload,
      registerNumber: payload, vatId: payload, editorial: 'true', editorialName: payload,
      editorialAddress: payload, hostingProvider: 'other', hostingOther: payload,
      domainProvider: 'other', domainOther: payload,
    }) }), { packageCode: 'business-pure-code' })
    assert.doesNotMatch(html, /<img src=x onerror=/)
    assert.ok((html.match(/&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;/g) || []).length >= 14)
  })

  it('keeps target views separate and preview identical to download except the srcdoc base', () => {
    const state = data({ operator: operator({ hostingProvider: 'STRATO' }) })
    for (const packageCode of ['business-pure-code', 'business-rundum-sorglos']) {
      const preview = generateBusinessHtml(state, { preview: true, packageCode })
      const download = renderWebsite(defaultGenerators, 'business', Buffer.from(JSON.stringify(state)), 2042, packageCode).toString()
      assert.equal(preview.replace('<base href="about:srcdoc">', ''), download)
      assert.match(download, /\.legal-view:target\{display:block\}/)
      assert.match(download, /\.legal-view:target ~ \.site-main\{display:none\}/)
      assert.match(download, /id="impressum"[\s\S]*?href="#top"[\s\S]*?id="datenschutz"[\s\S]*?href="#top"[\s\S]*?<div class="site-main">/)
      assert.match(download, /href="#impressum">Impressum<\/a><a href="#datenschutz">Datenschutz<\/a>/)
      assert.doesNotMatch(download, /<base\b/)
    }
  })

  it('renders placeholders for old drafts without exposing legacy contact or billing as the operator', () => {
    const state = data()
    const html = generateBusinessHtml(state)
    assert.match(legalView(html, 'impressum'), /\[Name des rechtlich verantwortlichen Websitebetreibers\]/)
    assert.match(legalView(html, 'datenschutz'), /Hostingangaben müssen vor Veröffentlichung ergänzt werden/)
    assert.ok(defaultGenerators.business.validateForCheckout(state, 'business-pure-code').some((e) => e.field === 'confirmReviewed'))
  })
})
