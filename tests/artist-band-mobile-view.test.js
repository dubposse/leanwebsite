import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { describe, it } from 'node:test'
import { setupArtistBandMobileView } from '../src/artist-band-mobile-view.js'

function button(view) {
  return {
    dataset: { view },
    attributes: {},
    addEventListener(event, callback) { this[event] = callback },
    setAttribute(name, value) { this.attributes[name] = value },
  }
}

describe('artist and band mobile view', () => {
  it('reloads only when entering preview and preserves the builder data and preview HTML', () => {
    const data = { name: 'Unverändert', tracks: [{ a: 'Track', b: '' }] }
    let reloads = 0
    const frame = {
      html: 'current preview',
      getAttribute: () => frame.html,
      getBoundingClientRect() {},
      set srcdoc(value) { this.html = value; reloads += 1 },
    }
    const edit = button('edit')
    const preview = button('preview')
    let scrolls = 0
    const workspace = {
      dataset: { view: 'edit' },
      data,
      querySelector: () => frame,
      scrollIntoView: (options) => {
        assert.deepEqual(options, { block: 'start', behavior: 'instant' })
        scrolls += 1
      },
    }
    const controls = { querySelectorAll: () => [edit, preview] }

    setupArtistBandMobileView(workspace, controls)
    preview.click()
    assert.equal(workspace.dataset.view, 'preview')
    assert.equal(preview.attributes['aria-pressed'], 'true')
    assert.equal(edit.attributes['aria-pressed'], 'false')
    assert.equal(reloads, 1)
    preview.click()
    assert.equal(reloads, 1)
    edit.click()
    assert.equal(workspace.dataset.view, 'edit')
    assert.equal(edit.attributes['aria-pressed'], 'true')
    assert.equal(preview.attributes['aria-pressed'], 'false')
    assert.deepEqual(workspace.data, { name: 'Unverändert', tracks: [{ a: 'Track', b: '' }] })
    assert.equal(frame.html, 'current preview')
    preview.click()
    assert.equal(reloads, 2)
    assert.equal(scrolls, 3)
  })

  it('limits the mode switch and hiding rules to the smartphone breakpoint', async () => {
    const css = await readFile(new URL('../src/style.css', import.meta.url), 'utf8')
    const mobile = css.slice(css.indexOf('@media (max-width: 480px)'))
    assert.match(css, /\.ab-mobile-view-switch\s*\{\s*display:\s*none/)
    assert.match(mobile, /\.ab-workspace\[data-view='edit'\] \.ab-preview-panel,\s*\.ab-workspace\[data-view='preview'\] \.ab-editor\s*\{\s*display:\s*none/)
    assert.match(mobile, /--ab-switch-top:\s*max\(8px, env\(safe-area-inset-top, 0px\)\)/)
    assert.match(mobile, /--ab-switch-clearance:\s*calc\(var\(--ab-switch-top\) \+ 62px\)/)
    assert.match(mobile, /\.ab-mobile-view-switch\s*\{[^}]*position:\s*sticky;[^}]*top:\s*var\(--ab-switch-top\);[^}]*margin-bottom:\s*12px;[^}]*padding:\s*4px;[^}]*border:[^;]+;[^}]*border-radius:\s*10px;/)
    assert.match(mobile, /\.ab-mobile-view-switch button\s*\{[^}]*min-height:\s*40px;/)
    assert.match(mobile, /height:\s*calc\(100dvh - var\(--ab-switch-clearance\) - 46px\)/)
    assert.match(mobile, /scroll-margin-top:\s*var\(--ab-switch-clearance\)/)
  })

  it('does not replace a preview that has not been generated yet', () => {
    let writes = 0
    const frame = {
      getAttribute: () => null,
      set srcdoc(value) { writes += 1 },
    }
    const edit = button('edit')
    const preview = button('preview')
    const workspace = {
      dataset: { view: 'edit' },
      querySelector: () => frame,
      scrollIntoView() {},
    }
    setupArtistBandMobileView(workspace, { querySelectorAll: () => [edit, preview] })
    preview.click()
    assert.equal(workspace.dataset.view, 'preview')
    assert.equal(writes, 0)
  })

  it('keeps state changes connected to the existing shared preview renderer', async () => {
    const builder = await readFile(new URL('../src/artist-band-builder.js', import.meta.url), 'utf8')
    assert.match(builder, /preview\.srcdoc = generateArtistBandHtml\(data, new Date\(\)\.getFullYear\(\), undefined,/)
    assert.match(builder, /\.replace\('<head>', '<head><base href="about:srcdoc">'\)/)
    assert.match(builder, /<iframe id="ab-preview"[^>]*sandbox=""/)
    assert.match(builder, /function markChanged\(\)[\s\S]*?updatePreview\(\)/)
    assert.match(builder, /data\[key\] = event\.target\.value\s*markChanged\(\)/)
    assert.match(builder, /data-view="edit" aria-pressed="true" aria-controls="ab-editor"/)
    assert.match(builder, /data-view="preview" aria-pressed="false" aria-controls="ab-preview-panel"/)
  })
})
