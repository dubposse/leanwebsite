import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { resolveOrderCompleteContext } from '../src/order-complete.js'

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
})
