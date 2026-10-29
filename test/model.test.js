import { test } from 'node:test'
import assert from 'node:assert/strict'
import { notEvaluated, productsFor } from '../src/model.js'

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
