import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildRows } from '../src/model.js'
import { chatPrompt, puMessage, facts, asksFor } from '../src/handoff.js'
import { parseDoc } from '../lib/doc.js'

const materials = [{ id: 'm', name: 'Material A', products: ['Product X · 2000001'] }]
const ev = (id, date, kind, extra = {}) => ({ id, evaluation_id: 'a', material_id: 'm', kind, event_date: date, closed_on: null, ...extra })
const base = { id: 'a', material_id: 'm', file_name: 'x.md', verdict_line: 'x', rev: 1, rev_date: '2026-10-28', first_rev_date: '2026-10-28', tracker: {}, folder: 'Material A/Maker' }

test('station line: train at Docs while PU has the request; time counted from the CoA pass', () => {
  const [r] = buildRows({ materials, evaluations: [{ ...base, coa: 'pass', avl_listed: false }], events: [
    ev('d', '2026-10-27', 'docs_received'), ev('s', '2026-10-28', 'stage', { what: 'coa', note: 'pass' }), ev('q', '2026-10-30', 'docs_requested', { what: 'GMP', party: 'PU' }),
  ] })
  assert.equal(r.status, 'in_progress')
  assert.deepEqual(r.stations.map(s => s.state), ['done', 'done', 'now', 'ahead', 'ahead'])
  assert.equal(r.stations[1].date, '2026-10-28')
  assert.equal(r.stations[1].est, false)
  assert.equal(r.stations[2].since, '2026-10-28')
  assert.deepEqual(r.since, { date: '2026-10-30', est: false })   // In progress since the request
  assert.equal(r.holder.who, 'PU')
})

test('stage dates fall back to estimates, marked as such', () => {
  const [r] = buildRows({ materials, evaluations: [{ ...base, coa: 'gap' }], events: [ev('d', '2026-10-20', 'docs_received')] })
  assert.equal(r.status, 'missing')
  assert.equal(r.stations[1].state, 'now')
  assert.equal(r.stations[1].result, 'Missing')
  assert.deepEqual(r.stageDates.coa, { date: '2026-10-28', est: true })
  assert.equal(r.stations[0].state, 'skipped')                   // AVL never checked
  assert.equal(r.holder.you, true)
})

test('closed early: decision is the stop, unreached stations are skipped', () => {
  const [r] = buildRows({ materials, evaluations: [{ ...base, coa: 'fail', outcome: 'not_approved' }], events: [ev('o', '2026-11-04', 'stage', { what: 'outcome', note: 'not_approved' })] })
  assert.deepEqual(r.stations.map(s => s.state), ['skipped', 'done', 'skipped', 'skipped', 'now'])
  assert.deepEqual(r.since, { date: '2026-11-04', est: false })
  assert.equal(r.holder.closed, true)
})

const BODY = `# Material A — Maker — CoA Comparison (R.1_261028)

**Operative reference (APm Criteria):** **BP 2024**, taken from APm's own documents:
- **SD-QC-001-2000001 (R1)**, APm's controlled spec.

**Candidate edition:** Maker's CoA cites "BP 2026 and IH Specification." Informational.

| Quotation | file | ฿630/kg, 100 kg | 3 |

## Part 2 — Comparison

| Test | Reference | Candidate | Verdict |
|---|---|---|---|
| Assay | 99-101% | 99.8% | Pass |
| Water | NMT 0.5% | Not reported | Missing |
`

test('file facts: operative reference, spec code, cited edition, price', () => {
  const f = facts(BODY)
  assert.equal(f.ref, 'BP 2024')
  assert.equal(f.spec, 'SD-QC-001-2000001 R1')
  assert.equal(f.candEdition, 'BP 2026 and IH Specification.')
  assert.equal(f.price, '630')
})

test('PU message in the golden form; asks follow the stages', () => {
  const [r] = buildRows({ materials, evaluations: [{ ...base, coa: 'gap', item_code: '2000001', manufacturer: 'Maker Ltd', supplier: 'Distributor Co' }], events: [] })
  const doc = parseDoc(BODY)
  const m = puMessage(r, { body: BODY, doc, link: 'https://x/#/v/t/e/a' })
  const lines = m.text.split('\n')
  assert.equal(lines[0], 'เรื่อง: ลดต้นทุนสารตั้งต้น - Material A (2000001, Product X) แหล่งใหม่: Maker Ltd')
  assert.match(m.text, /ผลเป็น ขาด \(ผ่าน 1\/2 หัวข้อ, ขาดข้อมูล 1 หัวข้อ\)/)
  assert.match(m.text, /Maker Ltd \(ผ่าน Distributor Co\) ฿630\/kg/)
  assert.match(m.text, /- BP 2024 = มาตรฐานหลัก ตาม spec APm \(SD-QC-001-2000001 R1\)/)
  assert.match(m.text, /PU: ขอเพิ่มดังนี้ครับ\n- ข้อมูลใน CoA ที่ยังขาด: Water/)
  assert.equal(lines[lines.length - 1], 'ดูรายละเอียด: https://x/#/v/t/e/a')
  const pass = { ...r, stages: { coa: 'pass' } }
  assert.deepEqual(asksFor(pass, doc), ['เอกสาร GMP', 'ตัวอย่างสำหรับ QC'])
  assert.deepEqual(asksFor({ ...r, stages: { coa: 'pass', docs: 'pass', qc: 'approved' } }, doc), [])
})

test('CoA all Pass but documents missing: the message says so and asks for the documents', () => {
  const body = `## Part 2 — Comparison\n\n| Test | Verdict |\n|---|---|\n| Assay | Pass |\n\n## Supporting documents\n\n| Document | Status |\n|---|---|\n| GMP certificate | Missing |\n| APm controlled spec | Missing |\n`
  const [r] = buildRows({ materials, evaluations: [{ ...base, coa: 'gap', manufacturer: 'Maker Ltd' }], events: [] })
  const m = puMessage(r, { body, doc: parseDoc(body) })
  assert.match(m.text, /ผลเป็น ขาด: CoA ผ่านทุกหัวข้อ \(1\/1\) แต่เอกสารยังไม่ครบ/)
  assert.deepEqual(m.asks, ['เอกสารที่ยังขาด: GMP certificate'])
})

test('chat prompt names the next revision and the operative reference', () => {
  const [r] = buildRows({ materials, evaluations: [base], events: [ev('d', '2026-10-27', 'docs_received', { source_ref: 'Material A/Maker/Document/261027', what: '1 file: 261027 Material A Selection Form.pdf' })] })
  const p = chatPrompt(r, { body: BODY, root: 'C:\\RM', siblings: [] })
  assert.match(p, /Don't build R\.2 yet/)
  assert.match(p, /Operative reference: BP 2024, taken from APm's own documents\. Check/)
  assert.match(p, /AVL for the manufacturer \(to be confirmed from the scan\)/)
  assert.match(p, /261027 Material A Selection Form\.pdf/)
  assert.match(p, /C:\\RM\\CLAUDE\.md/)
})

test('approved: CoA, Docs and QC show as passed, inferred, when they were never recorded', () => {
  const [r] = buildRows({ materials, evaluations: [{ ...base, outcome: 'approved' }], events: [ev('o', '2026-11-05', 'stage', { what: 'outcome', note: 'approved' })] })
  assert.deepEqual(r.stations.map(s => s.state), ['skipped', 'done', 'done', 'done', 'now'])
  assert.deepEqual(r.stations.slice(1, 4).map(s => [s.result, s.inferred]), [['Pass', true], ['Pass', true], ['Approved', true]])
})
