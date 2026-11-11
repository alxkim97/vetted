import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildRows } from '../src/model.js'
import { puReply, replyGroups, thaiDate, thaiList, candidateParts } from '../src/reply.js'

const materials = [{ id: 'm1', name: 'Material A', products: [] }, { id: 'm2', name: 'Material B', products: [] }, { id: 'm3', name: 'Material C', products: [] }]
const ev = (id, mat, extra = {}) => ({ id, material_id: mat, file_name: 'x.md', verdict_line: 'x', rev: 0, rev_date: '2026-10-20', first_rev_date: '2026-10-20', folder: `${mat}/${id}`, tracker: {}, ...extra })
const req = (id, evaluation_id, date, what, extra = {}) => ({ id, evaluation_id, material_id: 'm', kind: 'docs_requested', event_date: date, what, party: 'PU', closed_on: null, topic: null, ...extra })
const stage = (id, evaluation_id, date, what, note) => ({ id, evaluation_id, material_id: 'm', kind: 'stage', event_date: date, what, note })

test('Thai dates and lists', () => {
  assert.equal(thaiDate('2026-10-28'), '28/10/69')
  assert.equal(thaiDate('2027-01-05'), '05/01/70')
  assert.equal(thaiList(['A']), 'A')
  assert.equal(thaiList(['A', 'B', 'C']), 'A, B และ C')
})

test('the example-6 shape: subject, one section per material, status first, then what PU owes with dates', () => {
  const evaluations = [
    ev('a1', 'm1', { coa: 'pass', docs: 'pass', manufacturer: 'Maker One', supplier: 'Distributor X' }),
    ev('b1', 'm2', { coa: 'fail', outcome: 'not_approved', manufacturer: 'Maker Two', supplier: 'Distributor X' }),
    ev('b2', 'm2', { coa: 'gap', manufacturer: 'Maker Three', supplier: 'Distributor X' }),
    ev('c1', 'm3', { outcome: 'approved', manufacturer: 'Maker Four', supplier: 'Distributor Y' }),
  ]
  const events = [
    req('q1', 'a1', '2026-10-28', 'Written confirmation of the manufacturer'),
    req('q2', 'a1', '2026-11-03', 'MSDS'),
    req('q3', 'a1', '2026-11-03', 'QC sample'),
    req('q4', 'b2', '2026-10-30', 'Current-lot CoA with the impurity results. After the CoA passes: GMP, MSDS, 500 g sample'),
    stage('s1', 'c1', '2026-08-17', 'outcome', 'approved'),
  ]
  const rows = buildRows({ materials, evaluations, events })
  const text = puReply(replyGroups(rows))
  assert.equal(text, [
    'เรื่อง: *ตอบเรื่องติดตามผลการคัดเลือก Material A, Material B และ Material C*',
    '',
    '1. Material A (Maker One ผ่าน Distributor X)',
    '- CoA และ GMP *ผ่านแล้ว* ยังสรุปผลการคัดเลือกไม่ได้เพราะรอสิ่งที่ขอ PU ไว้',
    '- รอจาก PU: Written confirmation of the manufacturer (ขอไว้ 28/10/69) / MSDS, QC sample (ขอไว้ 03/11/69)',
    '',
    '2. Material B',
    '- Maker Three (ผ่าน Distributor X): CoA *ขาด* รอจาก PU: Current-lot CoA with the impurity results (ขอไว้ 30/10/69) หลัง CoA ผ่านจึงจะขอ GMP, MSDS, 500 g sample',
    '- Maker Two (ผ่าน Distributor X): CoA *ไม่ผ่าน* ปิดการประเมินแล้ว ไม่มีอะไรรอเพิ่ม',
    '',
    '3. Material C (Maker Four ผ่าน Distributor Y)',
    '- ผลการคัดเลือก *อนุมัติ* ลงนามแล้วเมื่อ 17/08/69',
    '- ไม่มีเอกสารที่ PU ต้องส่งเพิ่มครับ',
  ].join('\n'))
  // No price, quotation or chase line is ever added.
  assert.doesNotMatch(text, /ราคา|ใบเสนอราคา|฿|ติดตาม(?!ผล)|เร่ง/)
})

test('the subject topic is editable; a material with no ticked candidate is left out', () => {
  const rows = buildRows({ materials, evaluations: [ev('a1', 'm1', { coa: 'gap', manufacturer: 'Maker One' })], events: [] })
  const g = replyGroups(rows)
  assert.match(puReply([...g, { name: 'Material Z', rows: [] }], { topic: 'สถานะ' }), /^เรื่อง: \*ตอบเรื่องสถานะ Material A\*$/m)
})

test('a request text with its own English dates reads them in Thai and gets no second date', () => {
  const rows = buildRows({ materials, evaluations: [ev('a1', 'm1', { coa: 'pass', manufacturer: 'Maker One' })], events: [
    req('q1', 'a1', '2026-11-03', 'Confirmation of the manufacturer (asked 28-10-26); MSDS and QC sample (asked 03-11-26)'),
    req('q2', 'a1', '2026-11-04', 'Solubility; ISO 9001 (first asked 20-08-26)'),
  ] })
  const [w] = candidateParts(rows[0]).waits
  assert.equal(w, 'รอจาก PU: Confirmation of the manufacturer (ขอไว้ 28/10/69); MSDS and QC sample (ขอไว้ 03/11/69) / Solubility; ISO 9001 (ขอไว้ครั้งแรก 20/08/69)')
})

test('the after-CoA clause: only while the CoA has not passed, once, and not for a source already on the AVL', () => {
  const one = (e, events = []) => candidateParts(buildRows({ materials, evaluations: [ev('a1', 'm1', e)], events })[0])
  assert.equal(one({ coa: 'gap' }).after, 'หลัง CoA ผ่านจึงจะขอ GMP, MSDS และตัวอย่าง')
  assert.equal(one({ coa: 'pass' }).after, null)
  assert.equal(one({ coa: 'gap', avl_listed: true }).after, null)
  assert.equal(one({ coa: 'gap', tracker: { coa: 'gap', request_sent: '261101', request_asked: 'CoA for the current lot' } }).waits[0], 'รอจาก PU: CoA for the current lot (ขอไว้ 01/11/69)')
})

test('other open states: a failed CoA sent back, a fail waiting to close, waiting on another party, nothing set yet', () => {
  const one = (e, events = []) => candidateParts(buildRows({ materials, evaluations: [ev('a1', 'm1', e)], events })[0])
  const back = one({ tracker: { coa: 'fail', request_sent: '261106', request_asked: 'A corrected spec' } })
  assert.equal(back.status, 'CoA *ไม่ผ่าน* ตามเอกสารที่ส่งมา')
  assert.equal(back.after, null)
  assert.equal(one({ coa: 'fail' }).status, 'CoA *ไม่ผ่าน* จะปิดการประเมินเป็นไม่อนุมัติ')
  assert.equal(one({ coa: 'pass', docs: 'pass', qc: 'approved' }).status, 'CoA, GMP และตัวอย่าง QC *ผ่านแล้ว* รอลงนามผลการคัดเลือก')
  assert.deepEqual(one({ coa: 'pass' }, [req('q', 'a1', '2026-09-03', 'Final decision after the trial batch', { party: 'QA, PD' })]).waits, ['รอจาก QA, PD: Final decision after the trial batch (ขอไว้ 03/09/69)'])
  assert.equal(one({ file_name: null, verdict_line: null }).status, 'RD กำลังประเมินเอกสาร')
  // A file but no CoA result in Vetted: a placeholder to fill in, never a guess.
  assert.equal(one({}).status, '[ใส่ผลการประเมิน: ยังไม่ได้บันทึกผล CoA ใน Vetted]')
})

test('closed: Not approved ignores leftover requests; Closed says AVL; approved with an estimated date gives none', () => {
  const one = (e, events = []) => candidateParts(buildRows({ materials, evaluations: [ev('a1', 'm1', e)], events })[0])
  const no = one({ coa: 'fail', outcome: 'not_approved' }, [req('q', 'a1', '2026-11-01', 'Something')])
  assert.equal(no.status, 'CoA *ไม่ผ่าน* ปิดการประเมินแล้ว ไม่มีอะไรรอเพิ่ม')
  assert.deepEqual(no.waits, [])
  assert.equal(one({ outcome: 'not_approved' }).status, 'CoA *ไม่ผ่าน* ปิดการประเมินแล้ว ไม่มีอะไรรอเพิ่ม') // CoA fail inferred
  assert.equal(one({ outcome: 'closed', avl_listed: true }).status, 'ปิดการประเมินแล้ว (ผู้ผลิตรายนี้อยู่ใน AVL อยู่แล้ว) ไม่มีอะไรรอเพิ่ม')
  assert.equal(one({ outcome: 'approved' }).status, 'ผลการคัดเลือก *อนุมัติ* ลงนามแล้ว')
})

test('groups: one per material and grade, open materials first', () => {
  const rows = buildRows({ materials, evaluations: [
    ev('a1', 'm1', { outcome: 'approved', manufacturer: 'Maker One' }),
    ev('b1', 'm2', { coa: 'gap', grade: 'Fine', manufacturer: 'Maker Two' }),
    ev('b2', 'm2', { coa: 'gap', grade: 'Coarse', manufacturer: 'Maker Three' }),
  ], events: [] })
  assert.deepEqual(replyGroups(rows).map(g => [g.name, g.open]), [['Material B Coarse', true], ['Material B Fine', true], ['Material A', false]])
})
