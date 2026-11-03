import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

// Secret access tokens (e.g. for drafts). Only the hash is stored; the token is shown to its owner once.
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/
const HASH_PATTERN = /^[0-9a-f]{64}$/

export function hashToken(token) {
  return createHash('sha256').update(token).digest('hex')
}

// 256 bits of randomness, so an unsalted SHA-256 is sufficient for storage.
export function generateAccessToken() {
  const token = randomBytes(32).toString('base64url')
  return { token, hash: hashToken(token) }
}

export function isWellFormedToken(token) {
  return typeof token === 'string' && TOKEN_PATTERN.test(token)
}

export function verifyToken(token, storedHash) {
  if (!isWellFormedToken(token) || typeof storedHash !== 'string' || !HASH_PATTERN.test(storedHash)) {
    return false
  }

  return timingSafeEqual(Buffer.from(hashToken(token), 'hex'), Buffer.from(storedHash, 'hex'))
}
