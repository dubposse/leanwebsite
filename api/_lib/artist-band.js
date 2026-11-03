import jpeg from 'jpeg-js'
import { generateArtistBandHtml } from '../../shared/artist-band-template.js'

export { generateArtistBandHtml }

const FIELD_LIMITS = Object.freeze({
  name: 100,
  genre: 120,
  tagline: 180,
  bio: 3000,
  spotify: 2048,
  soundcloud: 2048,
  bandcamp: 2048,
  instagram: 2048,
  email: 254,
})

const THEMES = Object.freeze({
  dark: ['#07070c', '#f2f2f7', '#9a9ab0', '#14141d'],
  light: ['#f6f6f1', '#111118', '#5a5a6a', '#ffffff'],
  grad: ['#12002b', '#ffffff', '#c9b8ee', '#ffffff14'],
})

const JPEG_DATA_URL = /^data:image\/jpeg;base64,([A-Za-z0-9+/]+={0,2})$/

function invalid(BuilderValidationError, message = 'Invalid artist or band data') {
  throw new BuilderValidationError(message)
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function decodesAsJpeg(bytes) {
  try {
    const image = jpeg.decode(bytes, {
      formatAsRGBA: true,
      maxMemoryUsageInMB: 48,
      maxResolutionInMP: 8,
      tolerantDecoding: false,
      useTArray: true,
    })

    return image.width > 0 && image.height > 0 && image.data.byteLength === image.width * image.height * 4
  } catch {
    return false
  }
}

export function validateArtistBandCover(value, { BuilderValidationError, maxBytes = 1.5 * 1024 * 1024 }) {
  if (value === '') return ''
  const match = typeof value === 'string' && JPEG_DATA_URL.exec(value)
  if (!match) invalid(BuilderValidationError, 'Cover must be a JPEG image')

  const bytes = Buffer.from(match[1], 'base64')
  if (bytes.toString('base64') !== match[1] || bytes.length === 0 || bytes.length > maxBytes) {
    invalid(BuilderValidationError, 'Cover image is invalid or too large')
  }
  if (!decodesAsJpeg(bytes)) invalid(BuilderValidationError, 'Cover must contain valid JPEG image data')

  return value
}

function validateString(input, key, BuilderValidationError, { required = false, max = FIELD_LIMITS[key] } = {}) {
  const value = input[key]
  if (typeof value !== 'string' || value.length > max || (required && value.trim().length === 0)) {
    invalid(BuilderValidationError)
  }
  return value
}

function validateUrl(value, BuilderValidationError) {
  if (!value) return ''
  if (/[\u0000-\u0020\u007f]/.test(value)) invalid(BuilderValidationError, 'Invalid URL')

  let parsed
  try {
    parsed = new URL(value)
  } catch {
    invalid(BuilderValidationError, 'Invalid URL')
  }

  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
    invalid(BuilderValidationError, 'Invalid URL')
  }

  return parsed.href
}

function validateEmail(value, BuilderValidationError) {
  if (!value) return ''
  if (!/^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/.test(value)) {
    invalid(BuilderValidationError, 'Invalid email address')
  }
  return value
}

function validateRows(value, BuilderValidationError) {
  if (!Array.isArray(value) || value.length > 20) invalid(BuilderValidationError)

  return value.map((row) => {
    if (!isPlainObject(row) || Object.keys(row).some((key) => key !== 'a' && key !== 'b')) {
      invalid(BuilderValidationError)
    }
    if (typeof row.a !== 'string' || row.a.length > 80 || typeof row.b !== 'string' || row.b.length > 200) {
      invalid(BuilderValidationError)
    }
    return { a: row.a, b: row.b }
  })
}

export function validateArtistBandData(input, BuilderValidationError) {
  const fields = [
    'name', 'genre', 'tagline', 'bio', 'accent', 'theme', 'spotify', 'soundcloud',
    'bandcamp', 'instagram', 'email', 'cover', 'tracks', 'gigs',
  ]
  if (!isPlainObject(input) || Object.keys(input).some((key) => !fields.includes(key))) {
    invalid(BuilderValidationError)
  }

  const data = {
    name: validateString(input, 'name', BuilderValidationError, { required: true }),
    genre: validateString(input, 'genre', BuilderValidationError),
    tagline: validateString(input, 'tagline', BuilderValidationError),
    bio: validateString(input, 'bio', BuilderValidationError),
    accent: validateString(input, 'accent', BuilderValidationError, { max: 7 }),
    theme: validateString(input, 'theme', BuilderValidationError, { max: 5 }),
    spotify: validateString(input, 'spotify', BuilderValidationError),
    soundcloud: validateString(input, 'soundcloud', BuilderValidationError),
    bandcamp: validateString(input, 'bandcamp', BuilderValidationError),
    instagram: validateString(input, 'instagram', BuilderValidationError),
    email: validateString(input, 'email', BuilderValidationError),
    cover: validateString(input, 'cover', BuilderValidationError, { max: 3 * 1024 * 1024 }),
    tracks: input.tracks,
    gigs: input.gigs,
  }

  if (!/^#[0-9a-f]{6}$/i.test(data.accent) || !Object.hasOwn(THEMES, data.theme)) {
    invalid(BuilderValidationError)
  }

  for (const key of ['spotify', 'soundcloud', 'bandcamp', 'instagram']) {
    data[key] = validateUrl(data[key], BuilderValidationError)
  }
  data.email = validateEmail(data.email, BuilderValidationError)
  data.cover = validateArtistBandCover(data.cover, { BuilderValidationError })
  data.tracks = validateRows(data.tracks, BuilderValidationError)
  data.gigs = validateRows(data.gigs, BuilderValidationError)

  return data
}

export function createArtistBandGenerator(dependencies) {
  return Object.freeze({
    validate(input) {
      return validateArtistBandData(input, dependencies.BuilderValidationError)
    },
    generateHtml(data, year) {
      return generateArtistBandHtml(data, year, dependencies.escapeHtml)
    },
  })
}
