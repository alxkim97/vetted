import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildRows, statusOf } from '../src/model.js'

const materials = [{ id: 'm', name: 'Material A', products: [] }]
const base = { id: 'a', material_id: 'm', file_name: 'x.md', rev: 1, rev_date: '2026-11-06', first_rev_date: '2026-11-06', folder: 'Material A/Maker', verdict_line: 'FAIL spec wider' }
const stage = (date, what, note) => ({ id: what, evaluation_id: 'a', material_id: 'm', kind: 'stage', event_date: date, what, note })
const docs = date => ({ id: `d${date}`, evaluation_id: 'a', material_id: 'm', kind: 'docs_received', event_date: date, source: 'scan' })
const rows = (tracker, events = []) => buildRows({ materials, evaluations: [{ ...base, tracker }], events })

test('a CoA fail waits for its signature, red', () => {
  const [r] = rows({ coa: 'fail' }, [docs('2026-11-03')])
  assert.equal(r.status, 'fail')
  assert.equal(r.openRequests.length, 0)
})

test('a CoA fail with a request sent afterwards is In progress, with the CoA still red', () => {
  const [r] = rows({ coa: 'fail', request_sent: '261106', request_asked: 'Spec at NMT 0.1%, ID B and C' }, [docs('2026-11-03'), docs('2026-11-06')])
  assert.equal(r.status, 'in_progress')
  assert.equal(r.openRequests.length, 1)
  assert.equal(r.openRequests[0].what, 'Spec at NMT 0.1%, ID B and C')
  assert.equal(r.openRequests[0].source, 'tracker')
  assert.equal(r.stages.coa, 'fail')
  assert.match(r.nextStep, /sent back to PU/)
})

test('the tracker request closes when documents arrive after it, and the fail goes red again', () => {
  const [r] = rows({ coa: 'fail', request_sent: '261106' }, [docs('2026-11-03'), docs('2026-11-12')])
  assert.equal(r.openRequests.length, 0)
  assert.equal(r.status, 'fail')
})

test('a signed outcome beats an open request', () => {
  const [r] = rows({ coa: 'fail', outcome: 'not_approved', request_sent: '261106' })
  assert.equal(r.status, 'not_approved')
})

test('a real open request does not rescue a fail unless the tracker says one was sent', () => {
  assert.equal(statusOf({ coa: 'fail' }, { openData: true }), 'fail')
  assert.equal(statusOf({ coa: 'fail' }, { openData: true, failOpen: true }), 'in_progress')
})

test('same-day stage entries read AVL, CoA, Docs: newest on top is CoA above AVL', () => {
  const [r] = rows({ coa: 'fail', avl_listed: false }, [stage('2026-11-06', 'avl', 'false'), stage('2026-11-06', 'coa', 'fail')])
  const order = r.events.filter(x => x.kind === 'stage').map(x => x.what)
  assert.deepEqual(order, ['avl', 'coa'])
  assert.deepEqual(order.slice().reverse(), ['coa', 'avl'])
})
