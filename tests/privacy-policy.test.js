import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { renderMarkdown } from '../src/markdown.js'

const policy = readFileSync(new URL('../src/data/privacy-policy.md', import.meta.url), 'utf8')
const page = readFileSync(new URL('../src/privacy-policy-page.js', import.meta.url), 'utf8')
const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8')
const artistBuilder = readFileSync(new URL('../src/artist-band-builder.js', import.meta.url), 'utf8')
const businessBuilder = readFileSync(new URL('../src/business-builder.js', import.meta.url), 'utf8')
const styles = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8')
const businessStyles = readFileSync(new URL('../src/business-builder.css', import.meta.url), 'utf8')
const vercel = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'))

describe('privacy policy page', () => {
  it('contains all 19 provided sections and key required wording', () => {
    const sections = policy.match(/^### \d{1,2}\. .+$/gm) ?? []
    assert.equal(sections.length, 19)
    assert.match(policy, /^# Datenschutzerklärung – LeanWebsite Studio$/m)
    assert.match(policy, /^\*\*Stand: 7\. November 2026\*\*$/m)
    assert.match(policy, /\[kontakt@matthiasbrehm\.de\]\(mailto:kontakt@matthiasbrehm\.de\)/)
    assert.match(policy, /\[https:\/\/matthiasbrehm\.de\]\(https:\/\/matthiasbrehm\.de\)/)
    assert.match(policy, /§ 25 Abs\. 2 TDDDG/)
    assert.match(policy, /Bayerische Landesamt für Datenschutzaufsicht/)
  })

  it('routes /datenschutz and makes it available in Vercel previews', () => {
    assert.match(main, /path === '\/datenschutz'/)
    assert.ok(vercel.rewrites.some(({ source, destination }) => source === '/datenschutz' && destination === '/index.html'))
    assert.ok(vercel.rewrites.some(({ source, destination }) => source === '/datenschutz/' && destination === '/index.html'))
    assert.ok(vercel.rewrites.some(({ source, destination }) => source === '/widerruf' && destination === '/index.html'))
    assert.ok(vercel.rewrites.some(({ source, destination }) => source === '/widerruf/' && destination === '/index.html'))
    assert.match(page, /privacy-policy\.md\?raw/)
  })

  it('links the landing page and both builders to privacy and the existing imprint', () => {
    for (const source of [main, artistBuilder, businessBuilder]) {
      assert.match(source, /href="\/datenschutz">Datenschutzerklärung/)
      assert.match(source, /href="\/widerruf">Widerruf/)
      assert.match(source, /href="https:\/\/matthiasbrehm\.de\/impressum"/)
    }
    assert.match(page, /href="https:\/\/matthiasbrehm\.de\/impressum"/)
    assert.doesNotMatch(main, /href="\/impressum"/)
  })

  it('provides responsive styling and semantic policy sections', () => {
    assert.match(renderMarkdown(policy), /<section class="privacy-section legal-section"/)
    assert.match(page, /<article class="privacy-document">/)
    assert.match(styles, /@media \(max-width: 800px\)[\s\S]*?\.privacy-content/)
    assert.match(businessStyles, /\.business-privacy-links/)
  })
})
