import { HttpError } from './http.js'
import { createArtistBandGenerator } from './artist-band.js'
import { createBusinessGenerator } from './business.js'

// Internal builder interface. Every builder brings its OWN data model, validator and HTML generator:
//
//   { validate(input) -> normalized data (throws BuilderValidationError), generateHtml(data) -> complete HTML string }
//
// Only HTML produced by generateHtml() from validated data may ever become a purchasable snapshot.

export const MAX_HTML_BYTES = 10 * 1024 * 1024
export const MAX_IMAGE_BYTES = 1.5 * 1024 * 1024
export const BUILDER_SLUGS = Object.freeze(['artist-band', 'business'])

// The message of this error is shown to the customer, so it must never contain internal details.
export class BuilderValidationError extends HttpError {
  constructor(message) {
    super(422, message)
    this.name = 'BuilderValidationError'
  }
}

export const defaultGenerators = Object.freeze({
  'artist-band': createArtistBandGenerator({ BuilderValidationError, escapeHtml }),
  business: createBusinessGenerator({ BuilderValidationError, maxImageBytes: MAX_IMAGE_BYTES }),
})

export function getGenerator(generators, slug) {
  const generator = Object.hasOwn(generators, slug) ? generators[slug] : null

  if (!generator || typeof generator.validate !== 'function' || typeof generator.generateHtml !== 'function') {
    throw new HttpError(409, 'This builder is not available for saving and purchase yet')
  }

  return generator
}

export function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

// Helpers for builder implementations.
export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`)
}

// Raster images only (no SVG, which can carry scripts). Returns the decoded size in bytes.
export function validateImageDataUrl(value, { maxBytes = MAX_IMAGE_BYTES } = {}) {
  const match = typeof value === 'string' && /^data:image\/(?:png|jpeg|webp|gif);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value)

  if (!match) throw new BuilderValidationError('Invalid image')

  const size = Buffer.from(match[1], 'base64').byteLength

  if (size === 0 || size > maxBytes) throw new BuilderValidationError('Image is too large')

  return size
}

/**
 * Validates untrusted builder data and returns { data, json }, where json is the normalized serialization
 * that gets stored. Throws BuilderValidationError for bad customer input.
 */
export function validateBuilderData(generators, slug, input) {
  const generator = getGenerator(generators, slug)
  const data = generator.validate(input)

  if (!isPlainObject(data)) throw new Error('Builder validator must return an object')

  return { data, json: Buffer.from(JSON.stringify(data), 'utf8') }
}

/**
 * Produces the complete website HTML for a stored draft. The stored JSON is validated again so that nothing
 * unvalidated ever reaches the generator. Returns a Buffer.
 */
export function renderWebsite(generators, slug, storedJson, year, packageCode) {
  const generator = getGenerator(generators, slug)

  if (!Number.isInteger(year) || year < 1900 || year > 9999) {
    throw new TypeError('A valid site year is required')
  }

  let input

  try {
    input = JSON.parse(storedJson.toString('utf8'))
  } catch {
    throw new HttpError(409, 'The saved draft content is invalid')
  }

  let data

  try {
    data = generator.validate(input)
  } catch (error) {
    if (error instanceof BuilderValidationError) throw new HttpError(409, 'The saved draft content is invalid')
    throw error
  }

  const html = generator.generateHtml(data, year, packageCode)

  if (typeof html !== 'string' || !/^\s*<!doctype html/i.test(html)) {
    throw new Error('Builder generator must return a complete HTML document')
  }

  const body = Buffer.from(html, 'utf8')

  if (body.byteLength > MAX_HTML_BYTES) throw new HttpError(413, 'The generated website is too large')

  return body
}
