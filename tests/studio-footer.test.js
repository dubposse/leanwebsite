import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { renderCheckoutReview } from '../shared/checkout-review.js'

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')
const main = read('../src/main.js')
const artist = read('../src/artist-band-builder.js')
const business = read('../src/business-builder.js')
const privacy = read('../src/privacy-policy-page.js')
const withdrawal = read('../src/withdrawal-page.js')
const css = read('../src/style.css')
const businessCss = read('../src/business-builder.css')

describe('studio footer links', () => {
  it('retains the legal link destinations in every studio footer', () => {
    for (const [source, selector] of [
      [main, 'site-footer-links'],
      [artist, 'ab-footer-links'],
      [business, 'business-privacy-links'],
      [privacy, 'privacy-footer-links'],
      [withdrawal, 'privacy-footer-links'],
    ]) {
      const nav = source.match(new RegExp(`<nav class="${selector}"[\\s\\S]*?</nav>`))?.[0]
      assert.ok(nav, selector)
      assert.match(nav, /href="\/datenschutz"/)
      assert.match(nav, /href="\/widerruf"/)
      assert.match(nav, /href="https:\/\/matthiasbrehm\.de\/impressum" target="_blank" rel="noopener noreferrer"/)
    }
    assert.match(artist, /<\/nav>\s*<a href="\/">Zurück zur Startseite<\/a>\s*<\/footer>/)
    for (const source of [main, privacy, withdrawal]) {
      assert.match(source, /<a class="brand footer-brand" href="\/"/)
    }
  })

  it('keeps the existing withdrawal link in both checkout reviews', () => {
    for (const [packageCode, builderLabel] of [['artist-band-code-and-go', 'Artist & Band'], ['business-pure-code', 'Business']]) {
      assert.match(renderCheckoutReview({ packageCode, builderLabel }), /<a href="\/widerruf">Widerrufsbelehrung<\/a>/)
    }
  })

  it('limits wrapping and touch-area changes to mobile footer and review selectors', () => {
    assert.match(css, /@media \(max-width: 560px\)[\s\S]*?\.site-footer-links a,[\s\S]*?min-height: 44px;[\s\S]*?white-space: nowrap;/)
    assert.match(css, /@media \(max-width: 760px\)[\s\S]*?\.ab-footer\s*\{[^}]*flex-direction: column;/)
    assert.match(css, /\.ab-footer > a\s*\{[^}]*align-self: stretch;[^}]*border-top:/)
    assert.match(css, /\.ab-footer a,[\s\S]*?\.ab-checkout-review \.checkout-review-links a\s*\{[^}]*min-height: 44px;[^}]*white-space: nowrap;[^}]*overflow-wrap: normal;/)
    assert.match(businessCss, /@media \(max-width: 480px\)[\s\S]*?\.business-privacy-links a,[\s\S]*?min-height: 44px;[^}]*white-space: nowrap;[^}]*overflow-wrap: normal;/)
  })
})
