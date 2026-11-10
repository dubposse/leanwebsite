import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { describe, it } from 'node:test'
import { wireBusinessSingleImage } from '../src/business-single-image.js'

function fixture(onFile, isEditorDisabled = () => false) {
  const listeners = new Map()
  const classes = new Set()
  const box = {
    classList: {
      add: (name) => classes.add(name),
      remove: (name) => classes.delete(name),
    },
    addEventListener(name, callback) {
      const callbacks = listeners.get(name) || []
      callbacks.push(callback)
      listeners.set(name, callbacks)
    },
  }
  const input = {
    disabled: false,
    dataset: {},
    files: [],
    value: 'selected',
    addEventListener(name, callback) { this[name] = callback },
  }
  const status = { dataset: {}, textContent: '' }
  wireBusinessSingleImage({ box, input, status, isEditorDisabled, onFile })
  return {
    input,
    status,
    classes,
    dispatch(name, files = []) {
      let prevented = false
      for (const callback of listeners.get(name) || []) {
        callback({ preventDefault() { prevented = true }, dataTransfer: { files } })
      }
      return prevented
    },
  }
}

describe('business single image upload', () => {
  it('uses a native labelled input and field status for each single image, leaving gallery separate', async () => {
    const builder = await readFile(new URL('../src/business-builder.js', import.meta.url), 'utf8')
    const css = await readFile(new URL('../src/business-builder.css', import.meta.url), 'utf8')
    for (const [path, id] of [
      ['logo', 'business-logo'],
      ['hero.image', 'business-hero-image'],
      ['about.image', 'business-about-image'],
    ]) {
      assert.ok(builder.includes(`<label for="${id}">`))
      assert.ok(builder.includes(`data-img="${path}"`))
      assert.match(builder, new RegExp(`id="${id}" type="file" accept="image/\\*"[^>]*aria-describedby="${id}-status"`))
      assert.ok(builder.includes(`id="${id}-status" role="status" aria-live="polite"`))
    }
    assert.match(css, /\.drop\[data-img\] input\[type='file'\]\s*\{[^}]*display:\s*block;[^}]*opacity:\s*0/s)
    assert.match(builder, /wireDrop\(\$\('#gallery-drop'\)/)
  })

  it('processes a selection once, shows progress, and resets only after completion', async () => {
    let finish
    const calls = []
    const pending = new Promise((resolve) => { finish = resolve })
    const field = fixture((file) => { calls.push(file); return pending })
    const file = { name: 'photo.jpg' }
    field.input.files = [file]
    field.input.change()
    field.input.change()
    field.dispatch('drop', [file])
    assert.deepEqual(calls, [file])
    assert.equal(field.input.value, 'selected')
    assert.equal(field.input.disabled, true)
    assert.equal(field.status.textContent, 'Bild wird verarbeitet …')
    finish()
    await pending
    await Promise.resolve()
    assert.equal(field.input.value, '')
    assert.equal(field.input.disabled, false)
    assert.equal(field.status.textContent, '')
  })

  it('shows a persistent error, resets the input, and permits retrying the same file', async () => {
    let attempts = 0
    const field = fixture(async () => {
      attempts += 1
      if (attempts === 1) throw new Error('Bild konnte nicht gelesen werden.')
    })
    field.input.files = [{ name: 'photo.jpg' }]
    field.input.change()
    await Promise.resolve()
    assert.equal(field.status.dataset.state, 'error')
    assert.equal(field.status.textContent, 'Bild konnte nicht gelesen werden.')
    assert.equal(field.input.value, '')
    field.input.change()
    await Promise.resolve()
    assert.equal(attempts, 2)
    assert.equal(field.status.textContent, '')
  })

  it('handles drops, drag feedback, cancellation, and editor disabling during processing', async () => {
    let finish
    let editorDisabled = false
    const calls = []
    const pending = new Promise((resolve) => { finish = resolve })
    const field = fixture((file) => { calls.push(file); return pending }, () => editorDisabled)
    field.input.change()
    assert.equal(calls.length, 0)
    assert.equal(field.dispatch('dragover'), true)
    assert.equal(field.classes.has('over'), true)
    const file = { name: 'drop.jpg' }
    assert.equal(field.dispatch('drop', [file]), true)
    assert.equal(field.classes.has('over'), false)
    assert.deepEqual(calls, [file])
    editorDisabled = true
    finish()
    await pending
    await Promise.resolve()
    assert.equal(field.input.disabled, true)
    field.dispatch('drop', [file])
    assert.equal(calls.length, 1)
  })
})
