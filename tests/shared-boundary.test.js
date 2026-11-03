import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it } from 'node:test'

const files = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? files(join(dir, entry.name)) : entry.name.endsWith('.js') ? [join(dir, entry.name)] : [],
  )

describe('browser/server module boundary', () => {
  it('src/ and shared/ never import from api/', () => {
    for (const file of [...files('src'), ...files('shared')]) {
      const source = readFileSync(file, 'utf8')
      assert.doesNotMatch(source, /(?:from|import)\s*\(?\s*['"][^'"]*\bapi\//, `${file} imports from api/`)
    }
  })

  it('shared/ stays free of Node and environment access', () => {
    for (const file of files('shared')) {
      const source = readFileSync(file, 'utf8')
      assert.doesNotMatch(source, /process\.env|from\s+['"]node:/, `${file} uses server-only features`)
    }
  })

  it('server packages are the shared definitions', async () => {
    const server = await import('../api/_lib/packages.js')
    const shared = await import('../shared/packages.js')
    assert.equal(server.packages, shared.packages)
  })
})
