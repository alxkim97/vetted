import { test } from 'node:test'
import assert from 'node:assert/strict'
import { notEvaluated, productsFor, statusOf, nextStep, buildRows } from '../src/model.js'

test('BOM lines no evaluation covers, plain gaps first', () => {
  const materials = [{ products: ['Product A · 2000001', 'Product B · 2000001'] }, { products: ['Product A · 2000002 · K30'] }]
  const products = [
    { name: 'Product A', bom: [['2000001', 'Binder'], ['2000002', 'Filler'], ['2000003', 'Colour'], ['2000009', 'Binder (N)', 'customer code']] },
    { name: 'Product B', bom: [['2000001', 'Binder'], ['2000003', 'Colour'], ['2000004', 'Flavour']] },
  ]
  assert.deepEqual(notEvaluated(products, materials).map(x => [x.code, x.products.length, !!x.note]),
    [['2000003', 2, false], ['2000004', 1, false], ['2000009', 1, true]])
})

test('graded product entries only match that grade', () => {
  const m = { products: ['Product A · 2000002 · K30', 'Product B · 2000005 · K90', 'Product C · 2000002'] }
  assert.deepEqual(productsFor(m, 'K30').map(p => p.name), ['Product A', 'Product C'])
  assert.deepEqual(productsFor(m).map(p => p.name), ['Product A', 'Product B', 'Product C'])
})

test('status: outcome first, then a failed stage, then who has the ball', () => {
  const f = { hasFile: true, hasVerdictLine: true, openData: false }
  assert.equal(statusOf({ outcome: 'closed', coa: 'pass' }, f), 'closed')
  assert.equal(statusOf({ outcome: 'approved', qc: 'not_approved' }, f), 'approved') // management override
  assert.equal(statusOf({ coa: 'pass', docs: 'fail' }, { ...f, openData: true }), 'fail')
  assert.equal(statusOf({ coa: 'gap' }, { ...f, openData: true }), 'in_progress')
  assert.equal(statusOf({ coa: 'gap' }, f), 'missing')
  assert.equal(statusOf({ coa: 'pass', docs: 'pass', qc: 'approved' }, f), 'missing') // close it: Alex's move
  assert.equal(statusOf({}, { hasFile: false, openData: false }), 'awaiting')
  assert.equal(statusOf({}, f), 'untagged')
  assert.equal(nextStep({ coa: 'pass' }), 'Ask for GMP / MSDS and a QC sample')
  assert.equal(nextStep({ coa: 'pass', docs: 'pass', qc: 'approved' }), 'Close it Approved on the Selection Form')
  assert.equal(nextStep({ outcome: 'closed' }), null)
})

test('rows: form-only requests stay Missing; old stamps and old tracker blocks still read', () => {
  const materials = [{ id: 'm', products: [] }]
  const base = { material_id: 'm', file_name: 'x.md', verdict_line: 'x', tracker: {} }
  const evaluations = [
    { ...base, id: 'a', coa: 'gap' },
    { ...base, id: 'b', coa: 'gap' },
    { ...base, id: 'c', stamp: 'closed_ok' },                       // before the v0.6 SQL
    { ...base, id: 'd', coa: null, tracker: { stamp: 'fail' } },     // tracker scanned before v0.6
  ]
  const req = (evaluation_id, topic = null) => ({ id: evaluation_id + 'r', evaluation_id, kind: 'docs_requested', event_date: '2026-11-03', closed_on: null, topic })
  const rows = buildRows({ materials, evaluations, events: [req('a'), req('b', 'form')] })
  assert.deepEqual(rows.map(r => r.status), ['in_progress', 'missing', 'approved', 'fail'])
  assert.equal(rows[1].openRequests.length, 1)
})
