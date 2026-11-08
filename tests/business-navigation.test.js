import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'
import jpeg from 'jpeg-js'
import { generateBusinessHtml } from '../shared/business-template.js'
import { defaultGenerators, renderWebsite } from '../api/_lib/generators.js'

const image = `data:image/jpeg;base64,${jpeg.encode({
  data: Uint8Array.from([255, 0, 0, 255]), width: 1, height: 1,
}, 80).data.toString('base64')}`

function businessData() {
  return {
    company: { name: 'Nordlicht Studio', tagline: 'Gute Ideen', industry: 'Design' },
    logo: image,
    hero: { headline: 'Wir gestalten Zukunft.', sub: 'Für Menschen.', cta: 'Anfragen', badge: '', image: '' },
    services: [{ icon: '✨', title: 'Strategie', text: 'Marken mit Charakter.' }],
    about: { title: 'Über uns', text: 'Ein kleines Team.', image: '' },
    facts: [],
    gallery: [image],
    contact: { email: 'hallo@example.com', phone: '', address: '', hours: '', instagram: 'https://instagram.com/nordlicht' },
    design: { accent: '#8b5cf6', accent2: '#22d3ee', mode: 'dark', radius: '16' },
    legal: { owner: '', vat: '', domain: '', notes: '' },
  }
}

function fragmentLinks(html) {
  return [...html.matchAll(/<a\b[^>]*href="(#[^"]+)"[^>]*>/g)].map((match) => match[1])
}

function exerciseMenuScript(html) {
  function element(attributes = {}) {
    const listeners = {}
    return {
      attributes,
      listeners,
      style: {},
      classList: { toggle() {}, add() {}, remove() {} },
      setAttribute(name, value) { attributes[name] = value },
      getAttribute(name) { return attributes[name] },
      addEventListener(name, callback) { listeners[name] = callback },
      focus() { this.focused = true },
    }
  }
  const menu = element({ 'aria-expanded': 'false', 'aria-label': 'Menü öffnen' })
  const links = element()
  const nav = element()
  nav.querySelector = () => menu
  const lightbox = element()
  lightbox.querySelector = () => element()
  const nodes = { '#y': element(), '#nav': nav, '#nav-links': links, '#glow': element(), '#lb': lightbox }
  const listeners = {}
  const media = { addEventListener(name, callback) { this[name] = callback } }
  const document = { querySelector: (selector) => nodes[selector], querySelectorAll: () => [] }
  const script = html.match(/<script>\n([\s\S]*?)\n<\/script>/)?.[1]
  assert.ok(script)
  runInNewContext(script, {
    document,
    addEventListener(name, callback) { (listeners[name] ??= []).push(callback) },
    matchMedia(query) { assert.equal(query, '(max-width: 760px)'); return media },
    IntersectionObserver: class { observe() {} },
  })
  return { menu, links, media, listeners }
}

describe('business website navigation', () => {
  it('renders one accessible navigation list with a mobile toggle and responsive visibility', () => {
    const html = generateBusinessHtml(businessData())
    assert.match(html, /<button class="menu-toggle" type="button" aria-label="Menü öffnen" aria-expanded="false" aria-controls="nav-links"><span><\/span><span><\/span><span><\/span><\/button>/)
    assert.match(html, /<ul id="nav-links">/)
    assert.match(html, /\.menu-toggle\{display:none\}/)
    assert.match(html, /@media\(max-width:760px\)\{[\s\S]*?\.menu-toggle\{display:flex/)
    assert.match(html, /\.nav ul\{display:none;position:absolute/)
    assert.match(html, /\.nav \.menu-toggle\[aria-expanded="true"\]\+ul\{display:flex\}/)
    assert.match(html, /:focus-visible/)
    assert.equal((html.match(/<ul id="nav-links">/g) || []).length, 1)
  })

  it('includes only existing navigation targets and omits the toggle for an empty menu', () => {
    const data = businessData()
    data.services = []
    data.about = { title: '', text: '', image: '' }
    data.gallery = []
    data.contact = { email: '', phone: '', address: '', hours: '', instagram: '' }
    const html = generateBusinessHtml(data)
    assert.doesNotMatch(html, /<button class="menu-toggle"/)
    assert.match(html, /<ul id="nav-links"><\/ul>/)
    data.services = [{ icon: '', title: 'Service', text: '' }]
    const withService = generateBusinessHtml(data)
    assert.match(withService, /<ul id="nav-links"><li><a href="#leistungen">Leistungen<\/a><\/li><\/ul>/)
    assert.doesNotMatch(withService, /<a href="#(?:ueber-uns|galerie|kontakt)">/)
  })

  it('opens, closes on a link or Escape, and resets when entering desktop width', () => {
    for (const html of [generateBusinessHtml(businessData()), generateBusinessHtml(businessData(), { preview: true })]) {
      const { menu, links, media, listeners } = exerciseMenuScript(html)
      const click = () => menu.listeners.click()
      const check = (expanded, label) => {
        assert.equal(menu.getAttribute('aria-expanded'), expanded)
        assert.equal(menu.getAttribute('aria-label'), label)
      }
      click()
      check('true', 'Menü schließen')
      click()
      check('false', 'Menü öffnen')
      click()
      links.listeners.click({ target: { closest: () => ({}) } })
      check('false', 'Menü öffnen')
      click()
      listeners.keydown.forEach((handler) => handler({ key: 'Escape' }))
      check('false', 'Menü öffnen')
      assert.equal(menu.focused, true)
      click()
      media.change({ matches: true })
      check('true', 'Menü schließen')
      media.change({ matches: false })
      check('false', 'Menü öffnen')
    }
  })

  it('generates internal links with corresponding targets and no mail navigation', () => {
    const html = generateBusinessHtml(businessData())
    const links = fragmentLinks(html)
    assert.deepEqual(links, ['#top', '#top', '#top', '#leistungen', '#ueber-uns', '#galerie', '#kontakt', '#kontakt', '#impressum', '#datenschutz'])
    for (const fragment of links) {
      assert.match(html, new RegExp(`\\bid="${fragment.slice(1)}"`))
    }
    assert.doesNotMatch(html, /mailto:/i)
  })

  it('resolves preview fragments against srcdoc instead of the builder URL', () => {
    const data = businessData()
    const preview = generateBusinessHtml(data, { preview: true })
    const base = preview.match(/<base href="([^"]+)">/)?.[1]
    assert.equal(base, 'about:srcdoc')
    assert.ok(preview.indexOf('<base ') < preview.indexOf('href="#top"'))
    for (const fragment of fragmentLinks(preview)) {
      assert.equal(new URL(fragment, base).href, `about:srcdoc${fragment}`)
      assert.equal(new URL(fragment, 'https://leanwebsite.example/builder/business').pathname, '/builder/business')
    }
    assert.equal(preview.replace('<base href="about:srcdoc">', ''), generateBusinessHtml(data))
  })

  it('uses the preview base for both initial rendering and subsequent updates', async () => {
    const builder = await readFile(new URL('../src/business-builder.js', import.meta.url), 'utf8')
    const assignments = [...builder.matchAll(/frame\.srcdoc\s*=\s*([^;\n]+)/g)].map((match) => match[1].trim())
    assert.deepEqual(assignments, [
      'generateBusinessHtml(state, { preview: true, packageCode: selectedPackageCode() })',
    ])
    assert.match(builder, /function renderState\(\)[\s\S]*?renderPreview\(\)/)
    assert.match(builder, /function updatePreview\(\)[\s\S]*?setTimeout\(renderPreview, 300\)/)
    assert.match(builder, /<iframe id="preview"[^>]*sandbox="allow-scripts allow-popups"/)
  })

  it('keeps downloaded HTML independent and uses normal same-file fragment links', () => {
    const data = businessData()
    const html = renderWebsite(defaultGenerators, 'business', Buffer.from(JSON.stringify(data)), 2042).toString()
    assert.equal(html, generateBusinessHtml(data))
    assert.doesNotMatch(html, /<base\b/i)
    for (const fragment of fragmentLinks(html)) {
      assert.equal(new URL(fragment, 'file:///downloads/website.html').href, `file:///downloads/website.html${fragment}`)
    }
  })
})
