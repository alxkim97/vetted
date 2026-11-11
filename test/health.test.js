import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildRows } from '../src/model.js'
import { healthCheck, isSignedForm } from '../src/health.js'

const materials = [{ id: 'm', name: 'Material A', products: [] }]
const ev = (extra = {}) => ({ id: 'a', material_id: 'm', file_name: 'Material A (Maker) CoA Comparison (R.1_261020).md', verdict_line: 'x', rev: 1, rev_date: '2026-10-20', first_rev_date: '2026-10-20', folder: 'Material A/Maker', tracker: { coa: 'pass' }, ...extra })
const req = (id, date, what, extra = {}) => ({ id, evaluation_id: 'a', material_id: 'm', kind: 'docs_requested', event_date: date, what, party: 'PU', closed_on: null, topic: null, ...extra })
const docs = date => ({ id: `d${date}`, evaluation_id: 'a', material_id: 'm', kind: 'docs_received', event_date: date, source: 'scan' })
const file = (date, name) => ({ id: name, evaluation_id: 'a', doc_date: date, name })
const check = (e, events = [], files = []) => healthCheck(buildRows({ materials, evaluations: [ev(e)], events }), files)
const rules = (...a) => check(...a).map(x => x.rule)

test('signed forms: signed or a decision word, never unsigned', () => {
  assert.equal(isSignedForm('260817 Material A Selection Form FR-QA-PC-069 (Signed - Approved, Maker).pdf'), true)
  assert.equal(isSignedForm('260721 Material A Selection Form (Reviewer Annotated - Not Approved, Maker).pdf'), true)
  assert.equal(isSignedForm('260904 Material A Selection Form (Signed - REJECTED, wrong grade).pdf'), true)
  assert.equal(isSignedForm('260902 Material A Selection Form (Unsigned - Pending Approval).pdf'), false)
  assert.equal(isSignedForm('260902 Material A Selection Form (Reviewer Annotated - PASS).pdf'), false)
  assert.equal(isSignedForm('260817 Material A CoA (Signed).pdf'), false)
})

test('rule: decision date estimated while a signed form with another date is on file', () => {
  // No stage entry for the outcome, so its date is estimated from the last timeline date.
  const events = [docs('2026-07-20'), docs('2026-11-04')]
  const files = [file('2026-07-21', 'Selection Form (Signed - Approved, Maker).pdf'), file('2026-11-04', 'Selection Form (Reviewer Annotated and Signed).pdf')]
  const [h] = check({ tracker: {}, outcome: 'approved' }, events, files)
  assert.equal(h.rule, 'decision_estimated')
  assert.match(h.reason, /dated 04-11-26\* .*21-07-26 Document folder/) // the form that says Approved, not the newest
  // Same date: the estimate (here the revision date, the last date known) agrees with the form.
  assert.deepEqual(rules({ tracker: {}, outcome: 'approved' }, [docs('2026-07-21')], [file('2026-10-20', 'Selection Form (Signed - Approved).pdf')]), [])
  // A dated decision entry: not estimated.
  assert.deepEqual(rules({ tracker: {}, outcome: 'approved' }, [...events, { id: 's', evaluation_id: 'a', material_id: 'm', kind: 'stage', event_date: '2026-07-21', what: 'outcome', note: 'approved' }], files), [])
  // No signed form: nothing to compare with.
  assert.deepEqual(rules({ tracker: {}, outcome: 'approved' }, events, [file('2026-07-21', 'Selection Form (Unsigned).pdf')]), [])
})

test('rule: Approved with the documents stage Missing or Fail', () => {
  const [h] = check({ tracker: { coa: 'pass', docs: 'gap', outcome: 'approved', verdict_date: '261020' } })
  assert.equal(h.rule, 'approved_docs_missing')
  assert.match(h.reason, /Docs is Missing in the tracker block/)
  assert.match(check({ tracker: {}, coa: 'pass', docs: 'fail', outcome: 'approved' })[0].reason, /Docs is Fail\./)
  assert.deepEqual(rules({ tracker: {}, coa: 'pass', docs: 'pass', outcome: 'approved' }), [])
})

test('rule: Not approved with an open request, from the app or the tracker block', () => {
  const [h] = check({ tracker: {}, coa: 'fail', outcome: 'not_approved' }, [req('q', '2026-10-25', 'Corrected spec')])
  assert.equal(h.rule, 'not_approved_open')
  assert.match(h.reason, /a request is still open: "Corrected spec" \(asked 25-10-26\)/)
  const [t] = check({ tracker: { coa: 'fail', outcome: 'not_approved', request_sent: '261025' } })
  assert.match(t.reason, /from request_sent in the tracker block/)
  assert.deepEqual(rules({ tracker: {}, coa: 'fail', outcome: 'not_approved' }, [req('q', '2026-10-25', 'x', { closed_on: '2026-10-30' })]), [])
})

test('rule: the open request in the app differs from the file\'s request_asked', () => {
  const tracker = { coa: 'gap', request_sent: '261025', request_asked: 'GMP certificate and MSDS' }
  const [h] = check({ tracker }, [req('q', '2026-10-25', 'QC sample 300 g')])
  assert.equal(h.rule, 'request_differs')
  assert.match(h.reason, /asks for "GMP certificate and MSDS"; the open request in the app says "QC sample 300 g"/)
  // Same words, different case and punctuation: fine. One holding the other: fine.
  assert.deepEqual(rules({ tracker }, [req('q', '2026-10-25', 'GMP certificate, and MSDS.')]), [])
  assert.deepEqual(rules({ tracker }, [req('q', '2026-10-25', 'GMP certificate and MSDS (asked 25-10-26)')]), [])
  // Only the tracker's own request: nothing to compare.
  assert.deepEqual(rules({ tracker }), [])
})

test('rule: the tracker says a request is out, but nothing is open in the app', () => {
  const tracker = { coa: 'gap', request_sent: '261025', request_asked: 'GMP certificate' }
  const [h] = check({ tracker }, [docs('2026-10-29')])
  assert.equal(h.rule, 'request_not_open')
  assert.match(h.reason, /went to PU on 25-10-26, but no request is open in the app \(documents on 29-10-26 closed it\)/)
  assert.deepEqual(rules({ tracker }), []) // still open
  assert.deepEqual(rules({ tracker: { ...tracker, outcome: 'approved' } }, [docs('2026-10-29')]), []) // closed: no longer matters
})

test('rule: an open evaluation whose comparison file has no tracker block', () => {
  const [h] = check({ tracker: {}, coa: 'gap' })
  assert.equal(h.rule, 'no_tracker')
  assert.match(h.reason, /^Material A \(Maker\) CoA Comparison \(R\.1_261020\)\.md has no rm-tracker block/)
  assert.deepEqual(rules({ tracker: {}, coa: 'gap', outcome: 'not_approved' }), []) // closed
  assert.deepEqual(rules({ tracker: {}, file_name: null, verdict_line: null }), []) // no file yet
})

test('the check never changes the rows it reads', () => {
  const rows = buildRows({ materials, evaluations: [ev({ tracker: {}, coa: 'gap' })], events: [] })
  const before = JSON.stringify(rows, (k, v) => v instanceof Set ? [...v] : v)
  healthCheck(rows, [file('2026-10-20', 'Selection Form (Signed).pdf')])
  assert.equal(JSON.stringify(rows, (k, v) => v instanceof Set ? [...v] : v), before)
})
