import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { runInNewContext } from 'node:vm'
import { generateBusinessHtml } from '../shared/business-template.js'
import { defaultGenerators, renderWebsite } from '../api/_lib/generators.js'

function data(email = 'hallo@example.com') {
  return {
    company: { name: 'Firma', tagline: '', industry: '' },
    logo: '',
    hero: { headline: '', sub: '', cta: '', badge: '', image: '' },
    services: [], about: { title: '', text: '', image: '' }, facts: [], gallery: [],
    contact: { email, phone: '', address: '', hours: '', instagram: '' },
    design: { accent: '#8b5cf6', accent2: '#22d3ee', mode: 'dark', radius: '16' },
    legal: { owner: '', vat: '', domain: '', notes: '' },
  }
}

function runScript(html, { clipboard, legacyResult = false, legacyThrows = false, selecting = false } = {}) {
  function element(attributes = {}) {
    return {
      attributes, listeners: {}, style: {}, textContent: '',
      classList: { toggle() {}, add() {}, remove() {} },
      setAttribute(name, value) { this.attributes[name] = value },
      getAttribute(name) { return this.attributes[name] },
      addEventListener(name, callback) { this.listeners[name] = callback },
      focus() { this.focused = true },
      contains() { return selecting },
    }
  }
  const email = element()
  email.textContent = 'hallo@example.com'
  const statuses = { 'email-copy-status': element(), 'cta-copy-status': element() }
  const buttons = Object.keys(statuses).map((id) => element({ 'aria-describedby': id }))
  const nav = element()
  nav.querySelector = () => null
  const lightbox = element()
  lightbox.querySelector = () => element()
  const nodes = { '#y': element(), '#nav': nav, '#nav-links': element(), '#glow': element(), '#lb': lightbox, '#contact-email-value': email }
  let legacyValue
  let removed = false
  const document = {
    querySelector: (selector) => nodes[selector],
    querySelectorAll: (selector) => selector === '[data-copy-email]' ? buttons : [],
    getElementById: (id) => statuses[id],
    body: { appendChild(field) { legacyValue = field.value } },
    createElement() { return { style: {}, select() {}, remove() { removed = true } } },
    execCommand(command) {
      assert.equal(command, 'copy')
      if (legacyThrows) throw new Error('denied')
      return legacyResult
    },
  }
  const script = html.match(/<script>\n([\s\S]*?)\n<\/script>/)[1]
  runInNewContext(script, {
    document, navigator: { clipboard },
    window: { getSelection: () => ({ isCollapsed: !selecting, anchorNode: {} }) },
    addEventListener() {},
    IntersectionObserver: class { observe() {} },
  })
  return { buttons, statuses, legacyValue: () => legacyValue, removed: () => removed }
}

describe('business contact copying', () => {
  it('keeps hero and lower labels independent in preview and downloaded HTML', () => {
    for (const cta of ['', 'Termin vereinbaren']) {
      const state = data()
      state.hero.cta = cta
      const exported = renderWebsite(defaultGenerators, 'business', Buffer.from(JSON.stringify(state)), 2042).toString()
      for (const html of [exported, generateBusinessHtml(state, { preview: true })]) {
        assert.match(html, new RegExp(`href="#kontakt">${cta || 'Kontakt aufnehmen'}</a>`))
        assert.match(html, /<div class="big-cta rv"><h2>Kontakt aufnehmen<\/h2><button class="btn"[^>]*>E-Mail-Adresse kopieren<\/button>/)
        assert.match(html, /<span id="contact-email-value">hallo@example\.com<\/span>/)
        assert.equal((html.match(/data-copy-email aria-describedby/g) || []).length, 2)
        assert.doesNotMatch(html, /mailto:/i)
        assert.match(html, /role="status" aria-live="polite"/)
      }
    }
  })

  it('provides a hero target but no copy buttons when email is missing or invalid', () => {
    for (const email of ['', 'kaputt', 'x@example.com<script>']) {
      const html = generateBusinessHtml(data(email))
      assert.match(html, /href="#kontakt">Kontakt aufnehmen<\/a>/)
      assert.match(html, /<section id="kontakt">/)
      assert.doesNotMatch(html, /data-copy-email aria-describedby/)
      assert.doesNotMatch(html, /mailto:/i)
      if (email) assert.match(html, /<div class="card rv"><h3>E-Mail<\/h3><span>/)
    }
  })

  it('copies the exact address and reports success for either button', async () => {
    for (const preview of [true, false]) {
      const copied = []
      const script = runScript(generateBusinessHtml(data(), { preview }), {
        clipboard: { async writeText(value) { copied.push(value) } },
      })
      await script.buttons[0].listeners.click()
      await script.buttons[1].listeners.click()
      assert.deepEqual(copied, ['hallo@example.com', 'hallo@example.com'])
      assert.equal(script.statuses['email-copy-status'].textContent, 'E-Mail kopiert!')
      assert.equal(script.statuses['cta-copy-status'].textContent, 'E-Mail kopiert!')
      assert.equal(script.legacyValue(), undefined)
    }
  })

  it('uses the legacy copy fallback on denial or missing clipboard access', async () => {
    for (const clipboard of [undefined, { async writeText() { throw new Error('denied') } }]) {
      const script = runScript(generateBusinessHtml(data()), { clipboard, legacyResult: true })
      await script.buttons[1].listeners.click()
      assert.equal(script.legacyValue(), 'hallo@example.com')
      assert.equal(script.removed(), true)
      assert.equal(script.buttons[1].focused, true)
      assert.equal(script.statuses['cta-copy-status'].textContent, 'E-Mail kopiert!')
    }
  })

  it('offers manual copying without claiming success when copying fails', async () => {
    for (const legacyThrows of [false, true]) {
      const script = runScript(generateBusinessHtml(data()), {
        clipboard: { async writeText() { throw new Error('denied') } },
        legacyResult: false,
        legacyThrows,
      })
      await script.buttons[0].listeners.click()
      assert.match(script.statuses['email-copy-status'].textContent, /nicht möglich.*markieren und manuell kopieren/)
      assert.equal(script.removed(), true)
    }
  })

  it('does not interrupt manually selecting the visible address', async () => {
    let writes = 0
    const script = runScript(generateBusinessHtml(data()), {
      clipboard: { async writeText() { writes += 1 } },
      selecting: true,
    })
    await script.buttons[0].listeners.click()
    assert.equal(writes, 0)
    assert.equal(script.statuses['email-copy-status'].textContent, '')
  })
})
