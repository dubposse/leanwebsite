import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createDraft, loadDraft, saveDraft } from '../api/_lib/drafts.js'
import { defaultGenerators, renderWebsite, validateBuilderData } from '../api/_lib/generators.js'
import { BUSINESS_OPERATOR_DEFAULTS, businessOperatorErrors } from '../shared/business-operator.js'
import { createFakeDb, createFakeStorage } from './helpers/fakes.js'

const operator = (overrides = {}) => ({
  ...BUSINESS_OPERATOR_DEFAULTS,
  operatorName: 'Musterbetrieb',
  street: 'Musterstraße 1',
  postalCode: '10115',
  city: 'Berlin',
  country: 'Deutschland',
  email: 'kontakt@example.de',
  confirmPublic: 'true',
  confirmReviewed: 'true',
  ...overrides,
})
const validate = (data) => validateBuilderData(defaultGenerators, 'business', data).data
const fields = (data, pkg = 'business-pure-code') => businessOperatorErrors(data, pkg).map((error) => error.field)

describe('business operator data', () => {
  it('validates all operator forms and their conditional required fields', () => {
    for (const operatorType of ['person', 'gbr', 'association', 'company']) {
      const data = operator({ operatorType, representative: 'Ada, Ben', legalForm: 'GmbH' })
      assert.deepEqual(fields(data), [])
      assert.deepEqual(fields(data, 'business-rundum-sorglos'), [])
      assert.deepEqual(validate({ operator: data }).operator, data)
      assert.equal(fields({ ...data, representative: '' }).includes('representative'), operatorType !== 'person')
      assert.equal(fields({ ...data, legalForm: '' }).includes('legalForm'), operatorType === 'company')
    }
  })

  it('returns all missing fields and checks conditional choices and the review confirmation', () => {
    assert.deepEqual(fields(operator({
      operatorName: '', email: 'invalid', registered: 'true', editorial: 'true',
      hostingProvider: 'other', domainProvider: 'other', confirmPublic: 'false',
    })), ['operatorName', 'email', 'registerCourt', 'registerNumber', 'editorialName',
      'editorialAddress', 'hostingOther', 'domainOther', 'confirmPublic'])
    assert.deepEqual(fields(operator({ hostingProvider: 'other', domainProvider: 'other' }), 'business-rundum-sorglos'), [])
    assert.deepEqual(fields(operator({ confirmReviewed: 'false' })), ['confirmReviewed'])
    assert.deepEqual(fields(operator({ hostingProvider: '', domainProvider: '' })), [])
  })

  it('rejects unknown fields, wrong types, excessive lengths, control characters and invalid choices', () => {
    for (const invalid of [
      { extra: 'x' }, { email: 3 }, { operatorName: 'x'.repeat(501) }, { city: 'x\u0000y' },
      { operatorType: 'invalid' }, { registered: true }, { editorial: 'maybe' },
      { hostingProvider: 'invalid' }, { domainProvider: 'invalid' }, { confirmPublic: 'yes' },
    ]) {
      assert.throws(() => validate({ operator: invalid }), { statusCode: 422 })
    }
  })

  it('loads legacy drafts and saves and restores incomplete or complete operator data', async () => {
    const sql = createFakeDb()
    sql.builders.push({ id: 'b2', slug: 'business', name: 'Business', active: true })
    const storage = createFakeStorage()
    const { draftId, draftToken } = await createDraft({ sql, builderSlug: 'business' })
    const save = (data) => saveDraft({ sql, put: storage.putObject, generators: defaultGenerators, draftId, draftToken, builderSlug: 'business', data })
    const load = () => loadDraft({ sql, get: storage.getObject, draftId, draftToken })
    await save({ company: { name: 'Alt' } })
    assert.equal((await load()).data.operator, undefined)
    for (const value of [operator({ operatorName: '', confirmPublic: 'false' }), operator({ confirmReviewed: 'true', hostingProvider: 'other', hostingOther: 'Beispiel' })]) {
      await save({ company: { name: 'Alt' }, operator: value })
      assert.deepEqual((await load()).data.operator, value)
    }
  })

  it('escapes operator input instead of exposing it as HTML', () => {
    const old = validate({ company: { name: 'Studio' } })
    const withOperator = validate({ ...old, operator: operator({ operatorName: '<script>alert(1)</script>' }) })
    const render = (data) => renderWebsite(defaultGenerators, 'business', Buffer.from(JSON.stringify(data)), 2042).toString()
    assert.notEqual(render(old), render(withOperator))
    assert.doesNotMatch(render(withOperator), /<script>alert\(1\)<\/script>/)
    assert.match(render(withOperator), /&lt;script&gt;alert\(1\)&lt;\/script&gt;/)
  })
})
