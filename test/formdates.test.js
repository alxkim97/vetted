import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildRows, isAnnotatedForm, formStageDates } from '../src/model.js'
import { parseDmy, isoToDmy } from '../src/dateInput.js'

// ── dd-mm-yyyy date field ──
test('dd-mm-yyyy in, ISO out; impossible dates refused', () => {
  assert.equal(parseDmy('21-07-2026'), '2026-07-21')
  assert.equal(parseDmy('1/7/2026'), '2026-07-01')
  assert.equal(parseDmy(' 21.07.2026 '), '2026-07-21')
  assert.equal(parseDmy('31-02-2026'), null)
  assert.equal(parseDmy('07/21/2026'), null) // US order is not accepted
  assert.equal(parseDmy('21-07-26'), null)
  assert.equal(isoToDmy('2026-07-21'), '21-07-2026')
  assert.equal(isoToDmy(''), '')
})

// ── Stage dates from the signed Selection Form ──
const form = (date, note, extra = 'Selection Form FR-QA-PC-069 + CoA (Maker A') => ({ evaluation_id: 'a', doc_date: date, name: `${date.slice(2).replace(/-/g, '')} Material A ${extra}${note ? `, ${note}` : ''}).pdf` })

test('which scans count as a signed form', () => {
  assert.equal(isAnnotatedForm('260727 X Selection Form (Reviewer Annotated - PASS, Maker A).pdf'), true)
  assert.equal(isAnnotatedForm('261030 X Selection Form, CoA (Maker A) (Reviewer Annotated Pass, AVL Source Note).pdf'), true)
  assert.equal(isAnnotatedForm('X Selection Form FR-QA-PC-069 (Maker A, Signed - REJECTED).pdf'), true)
  assert.equal(isAnnotatedForm('X Selection Form FR-QA-PC-069 (Maker A, Unsigned - Pending Approval).pdf'), false)
  assert.equal(isAnnotatedForm('260724 X Selection Form + CoA (Maker A).pdf'), false)
  assert.equal(isAnnotatedForm('X CoA (Maker A, Reviewer Annotated).pdf'), false)
})

test('CoA date: the first form whose note says the current verdict', () => {
  const forms = [form('2026-07-20', 'Reviewer Annotated - ขาด'), form('2026-07-27', 'Reviewer Annotated - PASS')]
  assert.equal(formStageDates(forms, { coa: 'pass' }, { from: '2026-07-15' }).coa, '2026-07-27')
  assert.equal(formStageDates(forms, { coa: 'gap' }, { from: '2026-07-15' }).coa, '2026-07-20')
  assert.equal(formStageDates([form('2026-07-27', 'Reviewer Annotated - Not Approved')], { coa: 'pass' }).coa, null)
})

test('a form with no verdict word, or from before the evaluation, gives no date', () => {
  assert.equal(formStageDates([form('2026-11-04', 'Reviewer Annotated')], { coa: 'pass' }).coa, null)
  assert.equal(formStageDates([form('2026-06-01', 'Reviewer Annotated - PASS')], { coa: 'pass' }, { from: '2026-07-01' }).coa, null)
})

test('Docs date: the same form when its note covers the documents, else a later form', () => {
  const both = [form('2026-10-30', 'Reviewer Annotated - CoA and GMP ผ่าน')]
  assert.deepEqual(formStageDates(both, { coa: 'pass', docs: 'pass' }), { coa: '2026-10-30', docs: '2026-10-30' })
  const two = [form('2026-07-27', 'Reviewer Annotated - PASS'), form('2026-11-04', 'Reviewer Annotated', 'Selection Form + GMP + ISO (Maker A')]
  assert.deepEqual(formStageDates(two, { coa: 'pass', docs: 'pass' }), { coa: '2026-07-27', docs: '2026-11-04' })
  // CoA-only note on the one form: no Docs date from it.
  assert.equal(formStageDates([form('2026-07-27', 'Reviewer Annotated - PASS')], { coa: 'pass', docs: 'pass' }).docs, null)
  // No CoA form found: Docs isn't guessed either.
  assert.equal(formStageDates([form('2026-11-04', 'Reviewer Annotated')], { coa: 'pass', docs: 'pass' }).docs, null)
})

const materials = [{ id: 'm', name: 'Material A', products: [] }]
const ev = (extra = {}) => ({ id: 'a', material_id: 'm', file_name: 'x.md', verdict_line: 'x', rev: 0, rev_date: '2026-07-24', first_rev_date: '2026-07-24', folder: 'Material A/Maker A', tracker: {}, coa: 'pass', ...extra })

test('in the rows: the form date replaces the estimate, a date set by hand still wins', () => {
  const files = [form('2026-07-27', 'Reviewer Annotated - PASS')]
  const est = buildRows({ materials, evaluations: [ev()], events: [] })[0].stageDates.coa
  assert.deepEqual([est.date, est.est], ['2026-07-24', true])
  const fromForm = buildRows({ materials, evaluations: [ev()], events: [], files })[0].stageDates.coa
  assert.deepEqual([fromForm.date, fromForm.est], ['2026-07-27', false])
  const byHand = buildRows({ materials, evaluations: [ev()], files, events: [{ id: 's', evaluation_id: 'a', material_id: 'm', kind: 'stage', what: 'coa', note: 'pass', event_date: '2026-07-25' }] })[0].stageDates.coa
  assert.equal(byHand.date, '2026-07-25')
  const tracker = buildRows({ materials, evaluations: [ev({ tracker: { coa: 'pass', verdict_date: '260726' } })], events: [], files })[0].stageDates.coa
  assert.equal(tracker.est, false) // the tracker's verdict_date is exact; the form doesn't override it
})
