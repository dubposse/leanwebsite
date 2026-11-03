import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { generateAccessToken, hashToken, isWellFormedToken, verifyToken } from '../api/_lib/tokens.js'

describe('access tokens', () => {
  it('generates url-safe 256-bit tokens with a matching sha-256 hex hash', () => {
    const { token, hash } = generateAccessToken()
    assert.match(token, /^[A-Za-z0-9_-]{43}$/)
    assert.match(hash, /^[0-9a-f]{64}$/)
    assert.equal(hash, hashToken(token))
    assert.notEqual(token, hash)
  })

  it('generates unique tokens', () => {
    assert.notEqual(generateAccessToken().token, generateAccessToken().token)
  })

  it('verifies only the matching token', () => {
    const { token, hash } = generateAccessToken()
    assert.equal(verifyToken(token, hash), true)
    assert.equal(verifyToken(generateAccessToken().token, hash), false)
  })

  it('rejects malformed tokens and hashes without throwing', () => {
    const { token, hash } = generateAccessToken()

    for (const bad of [undefined, null, 42, '', 'short', `${token}x`, token.replace(/.$/, '!')]) {
      assert.equal(verifyToken(bad, hash), false)
      assert.equal(isWellFormedToken(bad), false)
    }

    for (const badHash of [undefined, null, '', 'abc', hash.toUpperCase()]) {
      assert.equal(verifyToken(token, badHash), false)
    }
  })
})
