import { test } from 'node:test'
import assert from 'node:assert/strict'
import { matchAvl, materialMatch, companyMatch, avlDate } from '../lib/avl.js'
import { buildRows } from '../src/model.js'

const avl = { fileDate: '2026-10-22', rows: [
  { material: 'Aluminium Widget Dried Gel', manufacturer: 'Acme Chemical Industry Co., Ltd.', date: '2022-07-15', active: true },
  { material: 'Aluminium Widget Magnesium Carbonate Co-Dried Gel', manufacturer: 'Bolt Chemicals Pvt., Ltd.', date: '2022-07-15', active: false },
  { material: 'Widgetol (Heavy)', manufacturer: 'Corvo Labs Limited Unit-III', date: '2026-10-06', active: true },
  { material: 'Widgetol (Light)', manufacturer: 'Delta Pharma', date: '2023-02-13', active: true },
  { material: 'Gizmo Oxide', manufacturer: 'Echo Industries', date: '2023-01-01', active: false },
] }

test('AVL dates: Excel serials, dd-mm-yy, and the 1900 placeholder', () => {
  assert.equal(avlDate('44757'), '2022-07-15')
  assert.equal(avlDate('23-02-23'), '2023-02-23')
  assert.equal(avlDate('366'), null)
  assert.equal(avlDate('-'), null)
})

test('AVL names: word order and company suffixes aside, a bracketed grade must agree', () => {
  assert.equal(materialMatch('Dried Aluminium Widget Gel', 'Aluminium Widget Dried Gel'), 'same')
  assert.equal(materialMatch('Dried Aluminium Widget Gel', 'Aluminium Widget Magnesium Carbonate Co-Dried Gel'), 'near')
  assert.equal(materialMatch('Widgetol (Heavy)', 'Widgetol (Light)'), null)
  assert.equal(materialMatch('Silica (Abc)', 'Silica (Brand X1 Pharma)'), 'near')
  assert.equal(companyMatch('Corvo Labs', 'Corvo Labs Limited Unit-III'), 'same')
  assert.equal(companyMatch('Corvo Fine Chem', 'Corvo Something Else'), 'same')
})

test('AVL match: listed, new source, cancelled, close match, no name', () => {
  assert.equal(matchAvl(avl, { material: 'Dried Aluminium Widget Gel', manufacturer: 'Acme Chemical' }).listed, true)
  assert.equal(matchAvl(avl, { material: 'Widgetol (Heavy)', manufacturer: 'Delta Pharma' }).listed, false)   // listed for Light only
  assert.deepEqual(matchAvl(avl, { material: 'Gizmo Oxide', manufacturer: 'Echo' }).cancelled, true)
  const near = matchAvl(avl, { material: 'Dried Aluminium Widget Gel', manufacturer: 'Bolt Chemicals' })
  assert.equal(near.listed, null)
  assert.equal(near.review.length, 1)
  assert.equal(matchAvl(avl, { material: 'Widgetol (Heavy)', manufacturer: 'Zeta / Corvo Labs' }).listed, true)
  assert.equal(matchAvl(avl, { material: 'Widgetol (Heavy)', manufacturer: null }).reason, 'no manufacturer name')
})

const materials = [{ id: 'm', name: 'Material A', products: [] }]
const base = { id: 'a', material_id: 'm', file_name: 'x.md', rev: 2, rev_date: '2026-10-28', first_rev_date: '2026-10-01', tracker: {}, folder: 'Material A/Maker' }
const ev = (date, what, note) => ({ id: what, evaluation_id: 'a', material_id: 'm', kind: 'stage', event_date: date, what, note })

test('closed: CoA from the verdict, or Fail for a Not approved with nothing else', () => {
  const [a] = buildRows({ materials, evaluations: [{ ...base, outcome: 'not_approved', verdict_line: 'FAIL (spec width) - ROI wider. Not approved 20-07-26.' }], events: [ev('2026-11-04', 'outcome', 'not_approved')] })
  assert.deepEqual([a.stations[1].state, a.stations[1].result, a.stations[1].inferred], ['done', 'Fail', true])
  assert.match(a.stations[1].basis, /verdict \(R\.2\)/)
  const [b] = buildRows({ materials, evaluations: [{ ...base, outcome: 'not_approved', verdict_line: null }], events: [] })
  assert.equal(b.stations[1].result, 'Fail')
  assert.match(b.stations[1].basis, /most stop at the CoA/)
  const [c] = buildRows({ materials, evaluations: [{ ...base, outcome: 'closed', verdict_line: null }], events: [] })
  assert.equal(c.stations[1].state, 'skipped')
})

test('AVL station: Listed, Not listed, or not checked; a hand-set value wins', () => {
  const m = listed => ({ file_date: '2026-10-22', listed, manufacturer: 'Maker Ltd', material: 'Material A', date: '2026-10-06' })
  const [a] = buildRows({ materials, evaluations: [{ ...base, outcome: 'approved', avl_match: m(true) }], events: [] })
  assert.deepEqual([a.stations[0].result, a.stations[0].tone, a.stations[0].state], ['Listed', 'green', 'done'])
  const [b] = buildRows({ materials, evaluations: [{ ...base, outcome: 'approved', avl_match: m(false) }], events: [] })
  assert.deepEqual([b.stations[0].result, b.stations[0].tone], ['Not listed', 'grey'])
  const [c] = buildRows({ materials, evaluations: [{ ...base, avl_match: { file_date: '2026-10-22', listed: null, review: [{ manufacturer: 'Maker', material: 'Material A Type A', active: true }] } }], events: [] })
  assert.deepEqual([c.stations[0].result, c.stations[0].state], ['Not checked', 'skipped'])
  const [d] = buildRows({ materials, evaluations: [{ ...base, avl_listed: true, avl_match: m(false) }], events: [] })
  assert.deepEqual([d.stations[0].result, d.avlListed], ['Listed', true])
})

test('a Thai name in brackets after an English supplier is the same supplier', () => {
  const [r] = buildRows({ materials, evaluations: [{ ...base, supplier: 'Acme Trading Co., Ltd. (บจก. แอคมี เทรดดิ้ง)' }], events: [] })
  assert.equal(r.supplier, 'Acme Trading Co., Ltd.')
  const [t] = buildRows({ materials, evaluations: [{ ...base, supplier: 'บจก. ตัวอย่าง' }], events: [] })
  assert.equal(t.supplier, 'บจก. ตัวอย่าง')
})
