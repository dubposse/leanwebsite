import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { describe, it } from 'node:test'
import { resolveOrderCompleteContext, supportsOrderConfirmation } from '../src/order-complete.js'

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
    assert.match(source, /Vertragsbestätigung als PDF herunterladen/)
    assert.match(source, /oc-email-confirmation-flow/)
    assert.match(source, /kontakt@matthiasbrehm\.de/)
    assert.doesNotMatch(source, /mailto:|sendgrid|nodemailer|sendEmail/i)
  })

  it('offers a PDF contract confirmation for all four packages', () => {
    assert.equal(supportsOrderConfirmation('artist-band-rundum-sorglos'), true)
    assert.equal(supportsOrderConfirmation('business-rundum-sorglos'), true)
    assert.equal(supportsOrderConfirmation('artist-band-code-and-go'), true)
    assert.equal(supportsOrderConfirmation('business-pure-code'), true)
    assert.equal(supportsOrderConfirmation(undefined), false)
  })
})
