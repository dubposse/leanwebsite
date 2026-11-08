import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { describe, it } from 'node:test'
import { renderOrderComplete, resolveOrderCompleteContext, supportsOrderConfirmation } from '../src/order-complete.js'
import { MANAGED_FILE_DELIVERY_NOTICE } from '../shared/order-instructions.js'

describe('order completion builder context', () => {
  it('uses the Artist & Band local reference for legacy URLs without a builder parameter', () => {
    const result = resolveOrderCompleteContext('?checkout=success')

    assert.equal(result.builder, 'artist-band')
    assert.equal(result.context.storageKey, 'leanwebsite-artist-band-draft-v1')
    assert.equal(result.context.path, '/builder/artist-band')
  })

  it('selects the Artist & Band reference for an explicit builder hint', () => {
    const result = resolveOrderCompleteContext('?checkout=success&builder=artist-band')

    assert.equal(result.builder, 'artist-band')
    assert.equal(result.context.storageKey, 'leanwebsite-artist-band-draft-v1')
    assert.equal(result.context.path, '/builder/artist-band')
  })

  it('selects the Business reference and builder return link', () => {
    const result = resolveOrderCompleteContext('?checkout=cancelled&builder=business')

    assert.equal(result.builder, 'business')
    assert.equal(result.context.storageKey, 'leanwebsite-business-draft-reference-v1')
    assert.equal(result.context.path, '/builder/business')
    assert.equal(result.returnedCancelled, true)
  })

  it('does not silently map an unknown builder to Artist & Band', () => {
    const result = resolveOrderCompleteContext('?checkout=success&builder=unknown')

    assert.equal(result.builder, 'unknown')
    assert.equal(result.context, null)
  })

  it('offers the contract PDF and preserves the manual Rundum-Sorglos email step', async () => {
    const source = await readFile(new URL('../src/order-complete.js', import.meta.url), 'utf8')
    assert.match(source, /Deine Zahlung wurde bestätigt\. Vertragsbestätigung und Website stehen bereit\./)
    assert.match(source, /Vertragsbestätigung \(PDF\) herunterladen/)
    assert.match(source, /oc-email-confirmation-flow/)
    assert.match(source, /\$\{MANAGED_FILE_DELIVERY_NOTICE\}/)
    assert.doesNotMatch(source, /mailto:|sendgrid|nodemailer|sendEmail/i)
  })

  it('shows the plain-text delivery notice only for paid managed packages', async () => {
    const previousWindow = globalThis.window
    const previousStorage = globalThis.localStorage
    const previousFetch = globalThis.fetch
    try {
      globalThis.window = { location: { search: '?builder=artist-band' } }
      globalThis.localStorage = {
        getItem: () => JSON.stringify({
          draftId: '33333333-3333-4333-8333-333333333333',
          draftToken: 'a'.repeat(43),
        }),
      }
      for (const [code, managed] of [
        ['artist-band-code-and-go', false],
        ['artist-band-rundum-sorglos', true],
        ['business-pure-code', false],
        ['business-rundum-sorglos', true],
      ]) {
        globalThis.fetch = async () => ({
          ok: true,
          json: async () => ({ status: 'paid', downloadAvailable: true, package: { code } }),
        })
        const elements = new Map()
        const app = {
          innerHTML: '',
          querySelector(selector) {
            if (!elements.has(selector)) elements.set(selector, { hidden: true, dataset: {}, addEventListener() {} })
            return elements.get(selector)
          },
        }
        renderOrderComplete(app)
        await new Promise((resolve) => setImmediate(resolve))
        assert.equal(elements.get('#oc-email-confirmation-flow').hidden, !managed, code)
        assert.equal(elements.get('#oc-confirmation').hidden, false, code)
        assert.equal(elements.get('#oc-download').hidden, false, code)
        assert.ok(app.innerHTML.includes(`<p>${MANAGED_FILE_DELIVERY_NOTICE}</p>`))
        assert.doesNotMatch(app.innerHTML, /mailto:/i)
      }
    } finally {
      globalThis.window = previousWindow
      globalThis.localStorage = previousStorage
      globalThis.fetch = previousFetch
    }
  })

  it('offers a PDF contract confirmation for all four packages', () => {
    assert.equal(supportsOrderConfirmation('artist-band-rundum-sorglos'), true)
    assert.equal(supportsOrderConfirmation('business-rundum-sorglos'), true)
    assert.equal(supportsOrderConfirmation('artist-band-code-and-go'), true)
    assert.equal(supportsOrderConfirmation('business-pure-code'), true)
    assert.equal(supportsOrderConfirmation(undefined), false)
  })
})
