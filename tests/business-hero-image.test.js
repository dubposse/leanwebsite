import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { describe, it } from 'node:test'
import { encodeBusinessLogo, hasImageTransparency, imageByteLength, isImageDataUrl } from '../src/business-image.js'
import { createDraft, loadDraft, saveDraft } from '../api/_lib/drafts.js'
import { createCheckoutSession } from '../api/_lib/checkout.js'
import { loadPaidSnapshot } from '../api/_lib/downloads.js'
import { defaultGenerators, renderWebsite, validateBuilderData } from '../api/_lib/generators.js'
import { BUSINESS_OPERATOR_DEFAULTS } from '../shared/business-operator.js'
import { generateBusinessHtml } from '../shared/business-template.js'
import { createFakeDb, createFakeStorage, createFakeStripe } from './helpers/fakes.js'

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAF0lEQVR4AWL6z8AARAwMTIwMDEDEwAAAAAD//6Q/uukAAAAGSURBVAMAHzYCBdyiI4gAAAAASUVORK5CYII='
const url = (type, size) => `data:image/${type};base64,${Buffer.alloc(size).toString('base64')}`
const options = { maxImageBytes: 1.5 * 1024 * 1024, fitsDraft: () => true, label: 'Titelbild' }

describe('business title image', () => {
  it('renders native closed help directly beside the upload', async () => {
    const builder = await readFile(new URL('../src/business-builder.js', import.meta.url), 'utf8')
    const css = await readFile(new URL('../src/business-builder.css', import.meta.url), 'utf8')
    const help = builder.slice(builder.indexOf('id="business-hero-image-status"'), builder.indexOf('data-step="Leistungen"'))
    assert.match(help, /<details class="hero-image-help">\s*<summary>Tipps für dein Titelbild<\/summary>/)
    for (const text of ['1920 × 1080 Pixel', 'sichtbare Bildausschnitt', 'Browserfenster', 'auf demselben Gerät']) assert.ok(help.includes(text))
    assert.match(css, /\.hero-image-help summary\s*\{[^}]*min-height:\s*44px/s)
    assert.match(css, /\.hero-image-help summary:focus-visible\s*\{[^}]*outline:/s)
  })

  it('examines every original pixel in bounded tiles, including partial alpha at the edge', () => {
    const calls = []
    let tile = 0
    const context = {
      clearRect() {},
      drawImage(_image, x, y, width, height) { calls.push([x, y, width, height]); tile += 1 },
      getImageData(_x, _y, width, height) {
        const data = new Uint8ClampedArray(width * height * 4)
        for (let i = 3; i < data.length; i += 4) data[i] = 255
        if (tile === 4) data[data.length - 1] = 254
        return { data }
      },
    }
    const canvas = { getContext: () => context }
    assert.equal(hasImageTransparency({ width: 513, height: 513 }, canvas), true)
    assert.equal(canvas.width, 512)
    assert.equal(canvas.height, 512)
    assert.deepEqual(calls, [[0, 0, 512, 512], [512, 0, 1, 512], [0, 512, 512, 1], [512, 512, 1, 1]])
    tile = -100
    assert.equal(hasImageTransparency({ width: 2, height: 2 }, canvas), false)
    assert.throws(() => hasImageTransparency({ width: 2, height: 2 }, { getContext: () => null }), /nicht verfügbar/)
  })

  it('reuses transparent WebP and bounded PNG fallback with title-specific errors', () => {
    const draws = []
    let mode = 'webp'
    const canvas = {
      width: 1800, height: 1000,
      toDataURL(type) {
        if (mode === 'webp') return url('webp', 30)
        if (type === 'image/webp') throw new Error('unsupported')
        return url('png', this.width > 1260 ? 120 : 30)
      },
      getContext: () => ({ drawImage: (...args) => draws.push(args) }),
    }
    assert.match(encodeBusinessLogo(canvas, {}, options), /^data:image\/webp/)
    mode = 'png'
    assert.match(encodeBusinessLogo(canvas, {}, { ...options, maxImageBytes: 50 }), /^data:image\/png/)
    assert.deepEqual(draws[0].slice(1), [0, 0, 1260, 700])
    assert.throws(() => encodeBusinessLogo(canvas, {}, { ...options, maxImageBytes: 1 }), /Titelbild.*1,5 MiB/)
    assert.throws(() => encodeBusinessLogo(canvas, {}, { ...options, fitsDraft: () => false }), /Titelbild.*Draft-Limit/)
  })

  it('accepts title PNG only in intended image slots', () => {
    assert.equal(isImageDataUrl(PNG, { hero: true }), true)
    assert.equal(imageByteLength(PNG, { hero: true }), Buffer.from(PNG.split(',')[1], 'base64').length)
    assert.equal(isImageDataUrl(PNG), false)
    const validate = (data) => validateBuilderData(defaultGenerators, 'business', data).data
    assert.equal(validate({ hero: { image: PNG } }).hero.image, PNG)
    assert.equal(validate({ logo: PNG }).logo, PNG)
    assert.throws(() => validate({ about: { image: PNG } }), { statusCode: 422 })
    assert.throws(() => validate({ gallery: [PNG] }), { statusCode: 422 })
  })

  it('saves and restores title PNG and embeds it in preview and paid website snapshot in both modes', async () => {
    for (const mode of ['dark', 'light']) {
      const sql = createFakeDb()
      sql.builders.push({ id: 'b2', slug: 'business', name: 'Business', active: true })
      const storage = createFakeStorage()
      const { draftId, draftToken } = await createDraft({ sql, builderSlug: 'business' })
      const data = {
        hero: { image: PNG }, design: { mode }, company: { name: 'Test' }, contact: { email: 'test@example.com' },
        operator: { ...BUSINESS_OPERATOR_DEFAULTS, operatorName: 'Test', street: 'Straße 1', postalCode: '10115',
          city: 'Berlin', country: 'Deutschland', email: 'test@example.com', confirmPublic: 'true', confirmReviewed: 'true' },
      }
      await saveDraft({ sql, put: storage.putObject, generators: defaultGenerators, draftId, draftToken, builderSlug: 'business', data })
      const loaded = await loadDraft({ sql, get: storage.getObject, draftId, draftToken })
      assert.equal(loaded.data.hero.image, PNG)
      const preview = generateBusinessHtml(loaded.data, { preview: true })
      const html = renderWebsite(defaultGenerators, 'business', Buffer.from(JSON.stringify(loaded.data)), 2042).toString()
      for (const output of [preview, html]) {
        assert.ok(output.includes(`<div class="hero-bg"><img src="${PNG}"`))
        assert.ok(output.includes(`--bg:${mode === 'dark' ? '#07070d' : '#f7f7fb'}`))
        assert.match(output, /body\{margin:0;background:var\(--bg\)/)
        assert.match(output, /\.hero-bg img\{[^}]*object-fit:cover/)
      }
      await createCheckoutSession({ sql, storage, stripe: createFakeStripe(), generators: defaultGenerators,
        siteUrl: 'https://leanwebsite.example', year: 2042,
        request: { draftId, draftToken, builderSlug: 'business', packageCode: 'business-pure-code' } })
      sql.orders[0].status = 'paid'
      const download = await loadPaidSnapshot({ sql, storage, body: { draftId, draftToken } })
      assert.equal(download.fileName, 'website.html')
      assert.ok(download.body.toString().includes(`<div class="hero-bg"><img src="${PNG}"`))
    }
  })
})
