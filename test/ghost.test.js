import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ghostDocEvents } from '../lib/sync.js'

const base = { source: 'scan', kind: 'docs_received', material_id: 'm1', party: null, note: null, closed_on: null, topic: null }
const rows = [
  { ...base, id: 'kept-seen', source_ref: 'Mat/Cand/Document/261101' },
  { ...base, id: 'gone', source_ref: 'Mat/Cand/Document/261102' },
  { ...base, id: 'gone-root', source_ref: 'Mat/Document/261103' },
  { ...base, id: 'has-image', source_ref: 'Mat/Cand/Document/261104' },
  { ...base, id: 'has-note', source_ref: 'Mat/Cand/Document/261105', note: 'checked with PU' },
  { ...base, id: 'closed', source_ref: 'Mat/Cand/Document/261106', closed_on: '2026-11-10' },
  { ...base, id: 'other-mat', source_ref: 'Other/Document/261107', material_id: 'm2' },
  { ...base, id: 'app-made', source_ref: null, source: 'app' },
  { ...base, id: 'chat-made', source_ref: 'Mat/Cand/Document/261108', source: 'chat' },
  { ...base, id: 'request', source_ref: 'Mat/Cand/Document/261109', kind: 'docs_requested' },
]
const opts = { seen: new Set(['Mat/Cand/Document/261101']), materialIds: new Set(['m1']), withEvidence: new Set(['has-image']) }

test('ghost entries: only bare scan-made entries of a gone folder, in a material the scan read', () => {
  assert.deepEqual(ghostDocEvents(rows, opts), ['gone', 'gone-root'])
})

test('ghost entries: a scan that saw no document folders removes nothing', () => {
  assert.deepEqual(ghostDocEvents(rows, { ...opts, seen: new Set() }), [])
})
