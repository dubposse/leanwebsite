import jpeg from 'jpeg-js'
import { isValidPng } from './png.js'
import { generateBusinessHtml } from '../../shared/business-template.js'
import { businessOperatorErrors, BUSINESS_OPERATOR_CHOICES, BUSINESS_OPERATOR_DEFAULTS, BUSINESS_OPERATOR_LIMITS } from '../../shared/business-operator.js'

const MAX_DRAFT_REQUEST_BYTES = 4 * 1024 * 1024
const MAX_IMAGE_BYTES = 1.5 * 1024 * 1024
const MAX_IMAGE_PIXELS = 8 * 1024 * 1024

const DEFAULT_DATA = Object.freeze({
  company: { name: '', tagline: '', industry: '' },
  logo: '',
  hero: { headline: '', sub: '', cta: '', badge: '', image: '' },
  services: [{ icon: '🚀', title: '', text: '' }],
  about: { title: '', text: '', image: '' },
  facts: [],
  gallery: [],
  contact: { email: '', phone: '', address: '', hours: '', instagram: '' },
  design: { accent: '#8b5cf6', accent2: '#22d3ee', mode: 'dark', radius: '16' },
  legal: { owner: '', vat: '', domain: '', notes: '' },
})

const FIELD_LIMITS = Object.freeze({
  'company.name': 100,
  'company.tagline': 180,
  'company.industry': 120,
  'hero.headline': 180,
  'hero.sub': 3000,
  'hero.cta': 100,
  'hero.badge': 120,
  'services.icon': 4,
  'services.title': 120,
  'services.text': 1000,
  'about.title': 120,
  'about.text': 5000,
  'facts.value': 40,
  'facts.label': 120,
  'contact.email': 254,
  'contact.phone': 80,
  'contact.address': 1000,
  'contact.hours': 2000,
  'contact.instagram': 2048,
  'legal.owner': 200,
  'legal.vat': 32,
  'legal.domain': 253,
  'legal.notes': 5000,
})

const DATA_KEYS = Object.freeze([...Object.keys(DEFAULT_DATA), 'operator'])
const DATA_IMAGE_URL = /^data:image\/(jpeg|webp|png);base64,([A-Za-z0-9+/]+={0,2})$/
const INVALID_CONTROL_CHARACTERS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function invalid(BuilderValidationError, message = 'Invalid business data') {
  throw new BuilderValidationError(message)
}

function sectionInput(input, key, defaults, BuilderValidationError) {
  const value = input[key]
  if (value === undefined) return { ...defaults }
  if (!isPlainObject(value) || Object.keys(value).some((field) => !Object.hasOwn(defaults, field))) {
    invalid(BuilderValidationError)
  }
  return { ...defaults, ...value }
}

function validateString(value, path, BuilderValidationError) {
  if (
    typeof value !== 'string'
    || value.length > FIELD_LIMITS[path]
    || INVALID_CONTROL_CHARACTERS.test(value)
  ) {
    invalid(BuilderValidationError)
  }
  return value
}

function validateOptionalUrl(value, BuilderValidationError) {
  if (!value) return value
  if (/[\u0000-\u0020\u007f]/.test(value)) invalid(BuilderValidationError, 'Invalid URL')

  let url
  try {
    url = new URL(value)
  } catch {
    invalid(BuilderValidationError, 'Invalid URL')
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    invalid(BuilderValidationError, 'Invalid URL')
  }
  return value
}

function validateOptionalEmail(value, BuilderValidationError) {
  if (value && !/^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/.test(value)) {
    invalid(BuilderValidationError, 'Invalid email address')
  }
  return value
}

function dimensionsAreValid(width, height) {
  return Number.isInteger(width)
    && Number.isInteger(height)
    && width > 0
    && height > 0
    && width * height <= MAX_IMAGE_PIXELS
}

function decodesAsJpeg(bytes) {
  try {
    const image = jpeg.decode(bytes, {
      formatAsRGBA: true,
      maxMemoryUsageInMB: 48,
      maxResolutionInMP: MAX_IMAGE_PIXELS / (1024 * 1024),
      tolerantDecoding: false,
      useTArray: true,
    })
    return dimensionsAreValid(image.width, image.height)
      && image.data.byteLength === image.width * image.height * 4
  } catch {
    return false
  }
}

function read24le(bytes, offset) {
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16)
}

function webpDimensions(bytes) {
  if (
    bytes.length < 20
    || bytes.toString('ascii', 0, 4) !== 'RIFF'
    || bytes.toString('ascii', 8, 12) !== 'WEBP'
    || bytes.readUInt32LE(4) + 8 !== bytes.length
  ) return null

  let offset = 12
  let canvas
  let frame
  let frameCount = 0

  while (offset < bytes.length) {
    if (offset + 8 > bytes.length) return null
    const tag = bytes.toString('ascii', offset, offset + 4)
    const size = bytes.readUInt32LE(offset + 4)
    const start = offset + 8
    const end = start + size
    if (end > bytes.length) return null
    const chunk = bytes.subarray(start, end)

    if (tag === 'VP8X') {
      if (canvas || size !== 10 || (chunk[0] & 0xc1) !== 0 || (chunk[0] & 0x02) !== 0) return null
      canvas = { width: read24le(chunk, 4) + 1, height: read24le(chunk, 7) + 1 }
    } else if (tag === 'VP8 ') {
      if (
        frame
        || size < 10
        || (chunk[0] & 1) !== 0
        || chunk[3] !== 0x9d
        || chunk[4] !== 0x01
        || chunk[5] !== 0x2a
      ) return null
      frame = {
        width: chunk.readUInt16LE(6) & 0x3fff,
        height: chunk.readUInt16LE(8) & 0x3fff,
      }
      frameCount++
    } else if (tag === 'VP8L') {
      if (frame || size < 5 || chunk[0] !== 0x2f || (chunk[4] >> 5) !== 0) return null
      frame = {
        width: 1 + (((chunk[2] & 0x3f) << 8) | chunk[1]),
        height: 1 + (((chunk[4] & 0x0f) << 10) | (chunk[3] << 2) | ((chunk[2] & 0xc0) >> 6)),
      }
      frameCount++
    } else if (tag === 'ANIM' || tag === 'ANMF') {
      return null
    }

    offset = end + (size & 1)
  }

  if (offset !== bytes.length || frameCount !== 1 || !frame) return null
  if (canvas && (canvas.width !== frame.width || canvas.height !== frame.height)) return null
  return canvas ?? frame
}

function validateImage(value, BuilderValidationError, maxBytes, { logo = false } = {}) {
  if (value === '') return { value, bytes: 0 }

  const match = typeof value === 'string' && DATA_IMAGE_URL.exec(value)
  if (!match || (match[1] === 'png' && !logo)) invalid(BuilderValidationError, 'Invalid image')

  const bytes = Buffer.from(match[2], 'base64')
  if (
    bytes.toString('base64') !== match[2]
    || bytes.length === 0
    || bytes.length > maxBytes
  ) {
    invalid(BuilderValidationError, 'Image is invalid or too large')
  }

  const valid = match[1] === 'png' ? isValidPng(bytes, MAX_IMAGE_PIXELS)
    : match[1] === 'jpeg'
    ? decodesAsJpeg(bytes)
    : (() => {
        const dimensions = webpDimensions(bytes)
        return dimensionsAreValid(dimensions?.width, dimensions?.height)
      })()
  if (!valid) invalid(BuilderValidationError, 'Image data is invalid')

  return { value, bytes: bytes.length }
}

function validateSectionStrings(input, defaults, section, BuilderValidationError, excluded = []) {
  const sectionData = sectionInput(input, section, defaults, BuilderValidationError)
  for (const [key, value] of Object.entries(sectionData)) {
    if (!excluded.includes(key)) {
      sectionData[key] = validateString(value, `${section}.${key}`, BuilderValidationError)
    }
  }
  return sectionData
}

export function validateBusinessData(input, BuilderValidationError, maxImageBytes = MAX_IMAGE_BYTES) {
  if (
    !isPlainObject(input)
    || Object.keys(input).some((key) => !DATA_KEYS.includes(key))
  ) {
    invalid(BuilderValidationError)
  }

  const data = {
    company: validateSectionStrings(input, DEFAULT_DATA.company, 'company', BuilderValidationError),
    hero: validateSectionStrings(input, DEFAULT_DATA.hero, 'hero', BuilderValidationError, ['image']),
    about: validateSectionStrings(input, DEFAULT_DATA.about, 'about', BuilderValidationError, ['image']),
    contact: validateSectionStrings(input, DEFAULT_DATA.contact, 'contact', BuilderValidationError),
    legal: validateSectionStrings(input, DEFAULT_DATA.legal, 'legal', BuilderValidationError),
    design: sectionInput(input, 'design', DEFAULT_DATA.design, BuilderValidationError),
    services: input.services === undefined ? DEFAULT_DATA.services.map((item) => ({ ...item })) : input.services,
    facts: input.facts === undefined ? [] : input.facts,
    gallery: input.gallery === undefined ? [] : input.gallery,
    logo: input.logo === undefined ? '' : input.logo,
  }

  if (Object.hasOwn(input, 'operator')) {
    const operator = sectionInput(input, 'operator', BUSINESS_OPERATOR_DEFAULTS, BuilderValidationError)
    for (const [field, value] of Object.entries(operator)) {
      if (typeof value !== 'string' || value.length > BUSINESS_OPERATOR_LIMITS[field]
        || INVALID_CONTROL_CHARACTERS.test(value)
        || (Object.hasOwn(BUSINESS_OPERATOR_CHOICES, field) && !BUSINESS_OPERATOR_CHOICES[field].includes(value))) {
        invalid(BuilderValidationError, 'Invalid business operator data')
      }
    }
    data.operator = operator
  }

  if (
    typeof data.design.accent !== 'string'
    || !/^#[0-9a-f]{6}$/i.test(data.design.accent)
    || typeof data.design.accent2 !== 'string'
    || !/^#[0-9a-f]{6}$/i.test(data.design.accent2)
  ) {
    invalid(BuilderValidationError, 'Invalid design colors')
  }
  if (
    !['dark', 'light'].includes(data.design.mode)
    || !['4', '16', '28'].includes(data.design.radius)
  ) {
    invalid(BuilderValidationError, 'Invalid design options')
  }
  if (
    !Array.isArray(data.services)
    || data.services.length > 8
    || !Array.isArray(data.facts)
    || data.facts.length > 4
    || !Array.isArray(data.gallery)
    || data.gallery.length > 3
  ) {
    invalid(BuilderValidationError, 'Too many business entries')
  }

  data.services = data.services.map((item) => {
    if (!isPlainObject(item) || Object.keys(item).some((key) => !['icon', 'title', 'text'].includes(key))) {
      invalid(BuilderValidationError)
    }
    return {
      icon: validateString(item.icon === undefined ? '✨' : item.icon, 'services.icon', BuilderValidationError),
      title: validateString(item.title === undefined ? '' : item.title, 'services.title', BuilderValidationError),
      text: validateString(item.text === undefined ? '' : item.text, 'services.text', BuilderValidationError),
    }
  })

  data.facts = data.facts.map((item) => {
    if (!isPlainObject(item) || Object.keys(item).some((key) => !['value', 'label'].includes(key))) {
      invalid(BuilderValidationError)
    }
    return {
      value: validateString(item.value === undefined ? '' : item.value, 'facts.value', BuilderValidationError),
      label: validateString(item.label === undefined ? '' : item.label, 'facts.label', BuilderValidationError),
    }
  })

  data.contact.email = validateOptionalEmail(data.contact.email, BuilderValidationError)
  data.contact.instagram = validateOptionalUrl(data.contact.instagram, BuilderValidationError)

  let imageBytes = 0
  const images = [
    ['logo', data.logo],
    ['hero.image', data.hero.image],
    ['about.image', data.about.image],
  ]
  for (let index = 0; index < data.gallery.length; index++) {
    images.push([`gallery.${index}`, data.gallery[index]])
  }
  for (const [path, value] of images) {
    const image = validateImage(value, BuilderValidationError, maxImageBytes, { logo: path === 'logo' })
    imageBytes += image.bytes
    if (path === 'logo') data.logo = image.value
    else if (path === 'hero.image') data.hero.image = image.value
    else if (path === 'about.image') data.about.image = image.value
    else data.gallery[Number(path.slice('gallery.'.length))] = image.value
  }

  const imageDataUrlBytes = Buffer.byteLength(JSON.stringify(images.map(([, value]) => value)), 'utf8')
  const requestBytes = Buffer.byteLength(JSON.stringify({ builder: 'business', data }), 'utf8')
  if (imageBytes > 0 && imageDataUrlBytes > MAX_DRAFT_REQUEST_BYTES) {
    invalid(BuilderValidationError, 'Images exceed the draft size limit')
  }
  if (requestBytes > MAX_DRAFT_REQUEST_BYTES) {
    invalid(BuilderValidationError, 'Draft content is too large')
  }

  return data
}

export function createBusinessGenerator({ BuilderValidationError, maxImageBytes = MAX_IMAGE_BYTES }) {
  return Object.freeze({
    validate(input) {
      return validateBusinessData(input, BuilderValidationError, maxImageBytes)
    },
    validateForCheckout(data, packageCode) {
      return businessOperatorErrors({ ...BUSINESS_OPERATOR_DEFAULTS, ...data.operator }, packageCode)
    },
    generateHtml(data, _year, packageCode) {
      return generateBusinessHtml(data, { packageCode })
    },
  })
}
