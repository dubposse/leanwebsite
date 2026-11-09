import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { describe, it } from 'node:test'
import { copyArtistBandLink } from '../src/artist-band-link-copy.js'
import { generateArtistBandHtml } from '../shared/artist-band-template.js'
import { LEGAL_DEFAULTS } from '../shared/artist-band-legal.js'

describe('artist and band builder link copy controls', () => {
  it('uses the current value without rewriting it', async () => {
    const copied = []
    const clipboard = { async writeText(value) { copied.push(value) } }
    const firstValue = 'https://example.com/first'
    const currentValue = 'https://example.com/latest?set=live%20now'

    await copyArtistBandLink(firstValue, 'url', clipboard)
    await copyArtistBandLink(currentValue, 'url', clipboard)

    assert.deepEqual(copied, [firstValue, currentValue])
  })

  it('does not copy empty or invalid URLs and emails', async () => {
    let writes = 0
    const clipboard = { async writeText() { writes += 1 } }

    for (const [value, kind] of [
      ['', 'url'],
      ['not a URL', 'url'],
      ['javascript:alert(1)', 'url'],
      ['user@example.com ', 'email'],
      ['invalid email', 'email'],
    ]) {
      const result = await copyArtistBandLink(value, kind, clipboard)
      assert.equal(result.success, false)
      assert.match(result.message, /gültige Zieladresse/)
      assert.doesNotMatch(result.message, /kopiert/i)
    }

    assert.equal(writes, 0)
  })

  it('keeps the existing fields and adds controls for fixed and dynamically rendered track links', async () => {
    const builder = await readFile(new URL('../src/artist-band-builder.js', import.meta.url), 'utf8')
    const styles = await readFile(new URL('../src/style.css', import.meta.url), 'utf8')
    const mobile = styles.slice(styles.indexOf('@media (max-width: 480px)'))

    for (const field of ['spotify', 'soundcloud', 'bandcamp', 'instagram', 'email']) {
      assert.match(builder, new RegExp(`name="${field}"`))
      assert.match(builder, new RegExp(`data-link-control data-kind="${field === 'email' ? 'email' : 'url'}"`))
    }
    assert.match(builder, /const value = input\.value/)
    assert.match(builder, /row\.append\(first, linkControl, remove\)/)
    assert.match(builder, /data-copy-link/)
    assert.match(builder, /Prüfe deine Weblinks vor der Bestellung/)
    assert.match(builder, /Prüfe deinen Link vor der Bestellung/)
    assert.match(mobile, /\.ab-link-copy\s*\{[^}]*min-height:\s*40px/)
    assert.match(styles, /\.ab-link-value\s*\{[^}]*overflow-wrap:\s*anywhere/)
    assert.match(styles, /\.ab-link-copy-status\s*\{[^}]*overflow-wrap:\s*anywhere/)
  })

  it('keeps initial defaults, preview wiring, and customer website HTML free of builder controls', async () => {
    const builder = await readFile(new URL('../src/artist-band-builder.js', import.meta.url), 'utf8')
    assert.match(builder, /spotify: '',\s*soundcloud: '',\s*bandcamp: '',\s*instagram: '',\s*email: ''/)
    assert.match(builder, /preview\.srcdoc = generateArtistBandHtml\(data, new Date\(\)\.getFullYear\(\), undefined,/)
    assert.match(builder, /<iframe id="ab-preview"[^>]*sandbox=""/)

    const websiteHtml = generateArtistBandHtml({
      name: 'Artist',
      genre: '',
      tagline: '',
      bio: '',
      accent: '#c6ff00',
      theme: 'dark',
      contentFont: 'standard',
      contentColor: 'auto',
      spotify: 'https://example.com/artist',
      soundcloud: '',
      bandcamp: '',
      instagram: '',
      email: 'book@example.com',
      cover: '',
      tracks: [{ a: 'Track', b: 'https://example.com/track' }],
      gigsHeading: 'Live',
      gigs: [],
      legal: { ...LEGAL_DEFAULTS },
    }, 2026)

    assert.match(websiteHtml, /href="https:\/\/example\.com\/track"/)
    assert.match(websiteHtml, /href="https:\/\/example\.com\/artist"/)
    assert.match(websiteHtml, /href="mailto:book@example\.com"/)
    assert.doesNotMatch(websiteHtml, /Link kopieren|ab-link-control|Prüfe deine Weblinks/)
  })
})
