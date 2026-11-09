import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { describe, it } from 'node:test'
import { generateArtistBandHtml } from '../shared/artist-band-template.js'
import { LEGAL_DEFAULTS } from '../shared/artist-band-legal.js'

describe('artist and band cover help', () => {
  it('renders the closed native cover help beside the upload in the builder only', async () => {
    const builder = await readFile(new URL('../src/artist-band-builder.js', import.meta.url), 'utf8')
    const uploadIndex = builder.indexOf('id="ab-cover"')
    const helpIndex = builder.indexOf('<details class="ab-cover-help ab-field-wide">')

    assert.ok(uploadIndex >= 0)
    assert.ok(helpIndex > uploadIndex)
    assert.match(builder.slice(helpIndex), /^<details class="ab-cover-help ab-field-wide">/)
    assert.match(builder.slice(helpIndex), /<summary>Tipps für dein Cover-Bild<\/summary>/)
    assert.doesNotMatch(builder.slice(helpIndex).match(/^<details[^>]*>/)?.[0] ?? '', /\sopen(?:\s|>)/)
    for (const text of [
      '1920 × 1080 Pixel',
      'Je nach Bildschirmgröße kann sich der sichtbare Bildausschnitt verändern.',
      'Verkleinere dein Browserfenster am Computer',
      'die Darstellung auf deinem Smartphone kontrollieren.',
      'Bearbeite und bestelle deine Website möglichst auf demselben Gerät',
    ]) assert.ok(builder.includes(text), text)
  })

  it('styles only the cover help and keeps it readable and keyboard-focusable on mobile', async () => {
    const styles = await readFile(new URL('../src/style.css', import.meta.url), 'utf8')
    const mobile = styles.slice(styles.indexOf('@media (max-width: 480px)'))

    assert.match(styles, /\.ab-cover-help summary:focus-visible\s*\{[^}]*outline:/)
    assert.match(mobile, /\.ab-cover-help\s*\{\s*font-size:\s*13px/)
    assert.match(mobile, /\.ab-cover-help summary\s*\{\s*min-height:\s*44px/)
  })

  it('does not inject builder instructions into generated customer websites', () => {
    const html = generateArtistBandHtml({
      name: 'Artist',
      accent: '#c6ff00',
      theme: 'dark',
      bio: '',
      tracks: [],
      gigs: [],
      cover: '',
      legal: { ...LEGAL_DEFAULTS },
    }, 2026)

    assert.doesNotMatch(html, /Tipps für dein Cover-Bild|1920 × 1080 Pixel|sichtbare Bildausschnitt/)
  })
})
