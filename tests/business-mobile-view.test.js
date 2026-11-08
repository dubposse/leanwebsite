import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { describe, it } from 'node:test'
import { setupBusinessMobileView } from '../src/business-mobile-view.js'

function button(view) {
  return {
    dataset: { view },
    attributes: {},
    addEventListener(event, callback) { this[event] = callback },
    setAttribute(name, value) { this.attributes[name] = value },
  }
}

describe('business mobile view', () => {
  it('switches modes without changing editor data and refreshes only when opening preview', () => {
    const edit = button('edit')
    const preview = button('preview')
    const data = { company: 'Test', step: 7 }
    let renders = 0
    let scrolls = 0
    const workspace = {
      dataset: { view: 'edit' },
      data,
      scrollIntoView(options) {
        assert.deepEqual(options, { block: 'start', behavior: 'instant' })
        scrolls += 1
      },
    }
    setupBusinessMobileView(workspace, { querySelectorAll: () => [edit, preview] }, () => { renders += 1 })
    preview.click()
    assert.equal(workspace.dataset.view, 'preview')
    assert.equal(preview.attributes['aria-pressed'], 'true')
    assert.equal(edit.attributes['aria-pressed'], 'false')
    preview.click()
    edit.click()
    assert.equal(workspace.dataset.view, 'edit')
    assert.equal(edit.attributes['aria-pressed'], 'true')
    assert.equal(renders, 1)
    assert.equal(scrolls, 2)
    assert.deepEqual(data, { company: 'Test', step: 7 })
  })

  it('scopes visibility, sticky geometry, and actual iframe width to smartphones', async () => {
    const css = await readFile(new URL('../src/business-builder.css', import.meta.url), 'utf8')
    const mobile = css.slice(css.indexOf('@media (max-width: 480px)'))
    assert.match(css, /\.mobile-view-switch\s*\{\s*display:\s*none/)
    assert.match(mobile, /--switch-top:\s*max\(8px, env\(safe-area-inset-top, 0px\)\)/)
    assert.match(mobile, /--switch-clearance:\s*calc\(var\(--switch-top\) \+ 62px\)/)
    assert.match(mobile, /\.mobile-view-switch\s*\{[^}]*position:\s*sticky;[^}]*top:\s*var\(--switch-top\);[^}]*border-radius:\s*10px;[^}]*padding:\s*4px/)
    assert.match(mobile, /\.mobile-view-switch button\s*\{[^}]*min-height:\s*40px;[^}]*flex:\s*1/)
    assert.match(mobile, /\.layout\[data-view='edit'\] \.preview,\s*#app\.business-builder \.layout\[data-view='preview'\] \.panel\s*\{\s*display:\s*none/)
    assert.match(mobile, /scroll-margin-top:\s*var\(--switch-clearance\)/)
    assert.match(mobile, /\.preview iframe\s*\{\s*width:\s*100%\s*!important/)
    assert.match(mobile, /#btn-reset|\.topbar-actions \.btn:not\(\[hidden\]\)/)
  })

  it('refreshes current state on opening preview and retains the sandbox and accessible controls', async () => {
    const builder = await readFile(new URL('../src/business-builder.js', import.meta.url), 'utf8')
    assert.match(builder, /data-view="edit" aria-pressed="true" aria-controls="business-editor"/)
    assert.match(builder, /data-view="preview" aria-pressed="false" aria-controls="business-preview"/)
    assert.match(builder, /setupBusinessMobileView\([\s\S]*?frame\.getBoundingClientRect\(\)\s*renderPreview\(\)/)
    assert.match(builder, /function renderPreview\(\)\s*\{\s*clearTimeout\(previewTimer\)\s*frame\.srcdoc = generateBusinessHtml\(state, \{ preview: true, packageCode: selectedPackageCode\(\) \}\)/)
    assert.match(builder, /sandbox="allow-scripts allow-popups"/)
  })
})
