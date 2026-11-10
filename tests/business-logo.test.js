import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { deflateSync } from 'node:zlib'
import { encodeBusinessLogo, imageByteLength, isImageDataUrl } from '../src/business-image.js'
import { createDraft, loadDraft, saveDraft } from '../api/_lib/drafts.js'
import { createCheckoutSession } from '../api/_lib/checkout.js'
import { loadPaidSnapshot } from '../api/_lib/downloads.js'
import { defaultGenerators, renderWebsite, validateBuilderData } from '../api/_lib/generators.js'
import { BUSINESS_OPERATOR_DEFAULTS } from '../shared/business-operator.js'
import { createFakeDb, createFakeStorage, createFakeStripe } from './helpers/fakes.js'

function chunk(type, data) {
  const name = Buffer.from(type)
  let crc = 0xffffffff
  for (const byte of Buffer.concat([name, data])) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0)
  }
  const length = Buffer.alloc(4)
  const checksum = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0)
  return Buffer.concat([length, name, data, checksum])
}

function png({ width = 1, height = 1, raw = Buffer.from([0, 255, 0, 0, 0]) } = {}) {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8
  header[9] = 6
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

const dataUrl = (type, bytes) => `data:image/${type};base64,${bytes.toString('base64')}`
const PNG = dataUrl('png', png())
const WEBP = dataUrl('webp', Buffer.from([1, 2, 3]))
const CANVAS_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAF0lEQVR4AWL6z8AARAwMTIwMDEDEwAAAAAD//6Q/uukAAAAGSURBVAMAHzYCBdyiI4gAAAAASUVORK5CYII='

function fakeCanvas(encode) {
  const calls = []
  const canvas = {
    width: 500,
    height: 300,
    toDataURL(type, quality) {
      calls.push({ type, quality, width: this.width, height: this.height })
      return encode(type, this.width)
    },
    getContext() {
      return { drawImage: (...args) => calls.push({ draw: args }) }
    },
  }
  return { canvas, calls }
}

const options = { maxImageBytes: 1.5 * 1024 * 1024, fitsDraft: () => true }
const validate = (data) => validateBuilderData(defaultGenerators, 'business', data).data

describe('business logo PNG fallback', () => {
  it('prefers a successful WebP encoding', () => {
    const { canvas, calls } = fakeCanvas(() => WEBP)
    assert.equal(encodeBusinessLogo(canvas, {}, options), WEBP)
    assert.deepEqual(calls.map((call) => call.type), ['image/webp'])
  })

  it('accepts a browser-generated PNG directly and retains transparent pixels', () => {
    const { canvas, calls } = fakeCanvas(() => PNG)
    assert.equal(encodeBusinessLogo(canvas, {}, options), PNG)
    assert.deepEqual(calls.map((call) => call.type), ['image/webp'])
    assert.equal(validate({ logo: PNG }).logo, PNG)
  })

  it('encodes PNG when WebP throws or returns an invalid data URL', () => {
    for (const webp of [() => { throw new Error('unsupported') }, () => 'data:image/webp;base64,invalid']) {
      const { canvas, calls } = fakeCanvas((type) => type === 'image/webp' ? webp() : PNG)
      assert.equal(encodeBusinessLogo(canvas, {}, options), PNG)
      assert.deepEqual(calls.map((call) => call.type), ['image/webp', 'image/png'])
    }
  })

  it('shrinks oversized PNGs without filling a background and observes both limits', () => {
    const large = dataUrl('png', Buffer.alloc(120))
    const small = dataUrl('png', Buffer.alloc(30))
    const { canvas, calls } = fakeCanvas((type, width) => type === 'image/webp' || width > 350 ? large : small)
    assert.equal(encodeBusinessLogo(canvas, {}, { maxImageBytes: 50, fitsDraft: (value) => value === small }), small)
    assert.deepEqual(calls.filter((call) => call.draw).map((call) => call.draw.slice(1)), [[0, 0, 350, 210]])
    assert.equal(canvas.width, 350)
    assert.equal(canvas.height, 210)
  })

  it('stops shrinking and reports image or request limits and PNG encoding failures', () => {
    const large = dataUrl('png', Buffer.alloc(120))
    const tooBig = fakeCanvas(() => large)
    assert.throws(() => encodeBusinessLogo(tooBig.canvas, {}, { ...options, maxImageBytes: 50 }), /größer als 1,5 MiB/)
    assert.equal(tooBig.calls.filter((call) => call.draw).length, 7)
    const request = fakeCanvas(() => PNG)
    assert.throws(() => encodeBusinessLogo(request.canvas, {}, { ...options, fitsDraft: () => false }), /Draft-Limit von 4 MiB/)
    const broken = fakeCanvas((type) => { throw new Error(type) })
    assert.throws(() => encodeBusinessLogo(broken.canvas, {}, options), /nicht als PNG gespeichert/)
  })

  it('enforces the actual 1.5 MiB image and 4 MiB draft thresholds on PNG', () => {
    const imageLimit = 1.5 * 1024 * 1024
    const draftLimit = 4 * 1024 * 1024
    const over = dataUrl('png', Buffer.alloc(imageLimit + 1))
    const atLimit = dataUrl('png', Buffer.alloc(imageLimit))
    const { canvas, calls } = fakeCanvas((type, width) => width === 500 ? over : atLimit)
    const otherData = 'x'.repeat(draftLimit - JSON.stringify({ logo: atLimit, other: '' }).length)
    const fitsDraft = (logo) => Buffer.byteLength(JSON.stringify({ logo, other: otherData })) <= draftLimit
    assert.equal(encodeBusinessLogo(canvas, {}, { maxImageBytes: imageLimit, fitsDraft }), atLimit)
    assert.equal(imageByteLength(atLimit, { logo: true }), imageLimit)
    assert.equal(calls.filter((call) => call.draw).length, 1)
    assert.equal(fitsDraft(atLimit), true)
    assert.equal(Buffer.byteLength(JSON.stringify({ logo: atLimit, other: otherData + 'x' })), draftLimit + 1)
  })

  it('accepts PNG only for the logo and rejects malformed or unsafe PNG data', () => {
    assert.equal(isImageDataUrl(PNG, { logo: true }), true)
    assert.equal(isImageDataUrl(PNG), false)
    assert.equal(imageByteLength(PNG, { logo: true }), png().length)
    assert.equal(validate({ logo: PNG }).logo, PNG)
    assert.equal(validate({ logo: CANVAS_PNG }).logo, CANVAS_PNG)
    for (const data of [{ hero: { image: PNG } }, { about: { image: PNG } }, { gallery: [PNG] }]) {
      assert.throws(() => validate(data), { statusCode: 422 })
    }
    const corrupt = png()
    corrupt[corrupt.length - 1] ^= 1
    for (const invalid of [Buffer.from('not a PNG'), corrupt, png({ width: 9000000 }), png({ raw: Buffer.from([9, 0, 0, 0, 0]) }), png({ raw: Buffer.alloc(50) })]) {
      assert.throws(() => validate({ logo: dataUrl('png', invalid) }), { statusCode: 422 })
    }
  })

  it('persists and restores a PNG logo and embeds it in generated website HTML', async () => {
    const sql = createFakeDb()
    sql.builders.push({ id: 'b2', slug: 'business', name: 'Business', active: true })
    const storage = createFakeStorage()
    const { draftId, draftToken } = await createDraft({ sql, builderSlug: 'business' })
    const data = {
      logo: PNG,
      company: { name: 'Test' },
      contact: { email: 'test@example.com' },
      operator: {
        ...BUSINESS_OPERATOR_DEFAULTS,
        operatorName: 'Test', street: 'Straße 1', postalCode: '10115', city: 'Berlin',
        country: 'Deutschland', email: 'test@example.com', confirmPublic: 'true', confirmReviewed: 'true',
      },
    }
    await saveDraft({ sql, put: storage.putObject, generators: defaultGenerators, draftId, draftToken, builderSlug: 'business', data })
    const loaded = await loadDraft({ sql, get: storage.getObject, draftId, draftToken })
    assert.equal(loaded.data.logo, PNG)
    const html = renderWebsite(defaultGenerators, 'business', Buffer.from(JSON.stringify(loaded.data)), 2042).toString()
    assert.ok(html.includes(`<img src="${PNG}"`))
    await createCheckoutSession({
      sql, storage, stripe: createFakeStripe(), generators: defaultGenerators,
      siteUrl: 'https://leanwebsite.example', year: 2042,
      request: { draftId, draftToken, builderSlug: 'business', packageCode: 'business-pure-code' },
    })
    sql.orders[0].status = 'paid'
    const download = await loadPaidSnapshot({ sql, storage, body: { draftId, draftToken } })
    assert.equal(download.fileName, 'website.html')
    assert.ok(download.body.toString().includes(`<img src="${PNG}"`))
  })
})
