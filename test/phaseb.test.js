import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildRows, expiring, todayIso, daysBetween } from '../src/model.js'
import { anyDate, expiriesOf, parseTracker } from '../lib/parse.js'
import { splitAsks } from '../src/handoff.js'
import { candidateParts } from '../src/reply.js'

const materials = [{ id: 'm', name: 'Material A', products: [] }]
const ev = (extra = {}) => ({ id: 'a', material_id: 'm', file_name: 'x.md', verdict_line: 'x', rev: 0, rev_date: '2026-10-01', first_rev_date: '2026-10-01', folder: 'Material A/Maker', tracker: {}, ...extra })
const req = (id, date, extra = {}) => ({ id, evaluation_id: 'a', material_id: 'm', kind: 'docs_requested', event_date: date, what: 'QC sample 300 g', party: 'PU', closed_on: null, topic: 'sample', ...extra })
const stage = (date, what, note) => ({ id: `s-${what}`, evaluation_id: 'a', material_id: 'm', kind: 'stage', event_date: date, what, note })
const row = (e, events = []) => buildRows({ materials, evaluations: [ev(e)], events })[0]
const addDays = n => new Date(Date.parse(todayIso()) + n * 864e5).toISOString().slice(0, 10)

// ── Expiry dates ──
test('dates as people write them', () => {
  assert.equal(anyDate('290316'), '2029-03-16')
  assert.equal(anyDate('2029-03-16'), '2029-03-16')
  assert.equal(anyDate('16/03/2029'), '2029-03-16')
  assert.equal(anyDate('6.3.2029'), '2029-03-06')
  assert.equal(anyDate('next year'), null)
  assert.equal(anyDate('31/13/2029'), null)
})

test('valid-until lines in the tracker block, soonest first', () => {
  const t = parseTracker('<!-- rm-tracker\ncoa: ผ่าน\ngmp_valid_to: 290316\nquotation_valid_to: 23/10/2026\nhalal_valid_to: soon\n-->')
  assert.deepEqual(expiriesOf(t).map(x => [x.doc, x.date]), [['Quotation', '2026-10-23'], ['GMP', '2029-03-16'], ['Halal', null]])
  assert.deepEqual(expiriesOf({}), [])
})

test('expiring: within 60 days or past, only on evaluations still in use', () => {
  const t = { coa: 'pass', gmp_valid_to: addDays(30), iso_valid_to: addDays(90), quotation_valid_to: addDays(-5) }
  const r = row({ tracker: t })
  assert.deepEqual(r.expiries.map(x => [x.doc, x.days]), [['Quotation', -5], ['GMP', 30], ['ISO 9001', 90]])
  assert.deepEqual(expiring([r]).map(x => x.doc), ['Quotation', 'GMP'])
  assert.deepEqual(expiring([r], 10).map(x => x.doc), ['Quotation'])
  assert.deepEqual(expiring([row({ tracker: { ...t, outcome: 'not_approved' } })]), [])
  assert.deepEqual(expiring([row({ tracker: { ...t, outcome: 'approved' } })]).map(x => x.doc), ['Quotation', 'GMP']) // an approved source still needs valid papers
})

// ── QC sample tracker ──
test('no sample request and no QC result: no tracker', () => {
  assert.equal(row({ coa: 'pass' }).sample, null)
})

test('sample asked, waiting on PU', () => {
  const s = row({ coa: 'pass' }, [req('q1', '2026-11-01')]).sample
  assert.deepEqual(s.steps.map(x => [x.key, x.date, x.days]), [['requested', '2026-11-01', null], ['received', null, null], ['sent', null, null], ['result', null, null]])
  assert.equal(s.now, 'received')
  assert.equal(s.holder, 'PU')
  assert.equal(s.waitingDays, daysBetween('2026-11-01', todayIso()))
  assert.equal(s.askId, 'q1')
})

test('received, sent to QC, then the result: days between each step', () => {
  const events = [req('q1', '2026-11-01', { closed_on: '2026-11-06' }), req('q2', '2026-11-08', { party: 'QC', what: 'Analysis request' })]
  const mid = row({ coa: 'pass', docs: 'pass' }, events)
  assert.equal(mid.sample.now, 'result')
  assert.equal(mid.sample.holder, 'QC')
  assert.deepEqual(mid.sample.steps.map(x => x.days), [null, 5, 2, null])
  assert.equal(mid.status, 'in_progress') // the request to QC is open: the ball is with QC
  assert.equal(mid.holder.who, 'QC')
  const done = row({ coa: 'pass', docs: 'pass', qc: 'approved' }, [events[0], { ...events[1], closed_on: '2026-11-20' }, stage('2026-11-20', 'qc', 'approved')]).sample
  assert.equal(done.now, null)
  assert.equal(done.open, false)
  assert.equal(done.result, 'approved')
  assert.deepEqual(done.steps.map(x => [x.date, x.days]), [['2026-11-01', null], ['2026-11-06', 5], ['2026-11-08', 2], ['2026-11-20', 12]])
})

test('received but not sent: your move; a QC result recorded without sample requests still shows', () => {
  const s = row({ coa: 'pass' }, [req('q1', '2026-11-01', { closed_on: '2026-11-06' })]).sample
  assert.equal(s.now, 'sent')
  assert.equal(s.holder, 'RD')
  const old = row({ coa: 'pass', qc: 'not_approved' }, [stage('2026-09-10', 'qc', 'not_approved')]).sample
  assert.equal(old.result, 'not_approved')
  assert.deepEqual(old.steps.map(x => x.done), [false, false, false, true])
})

test('the latest ask to PU is the one tracked (a second request after a lost sample)', () => {
  const s = row({ coa: 'pass' }, [req('q1', '2026-10-01', { closed_on: '2026-10-03' }), req('q2', '2026-11-01')]).sample
  assert.equal(s.askId, 'q2')
  assert.equal(s.now, 'received')
})

// ── Logging a sent message ──
test('a sample ask goes in its own request, the rest in one', () => {
  assert.deepEqual(splitAsks(['เอกสาร GMP', 'ตัวอย่างสำหรับ QC']), { data: ['เอกสาร GMP'], sample: ['ตัวอย่างสำหรับ QC'] })
  assert.deepEqual(splitAsks(['GMP certificate', 'QC sample 300 g']), { data: ['GMP certificate'], sample: ['QC sample 300 g'] })
  assert.deepEqual(splitAsks([]), { data: [], sample: [] })
})

test('the PU reply shows a sample with QC as waiting on QC', () => {
  const r = row({ coa: 'pass', docs: 'pass' }, [req('q1', '2026-11-01', { closed_on: '2026-11-06' }), req('q2', '2026-11-08', { party: 'QC', what: 'Analysis request' })])
  assert.deepEqual(candidateParts(r).waits, ['รอจาก QC: Analysis request (ขอไว้ 08/11/69)'])
})
