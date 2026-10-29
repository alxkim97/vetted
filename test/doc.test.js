import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseDoc, toneOf, cellGap, issuesOf, tally, toEnglish } from '../lib/doc.js'

const MD = `# Material X — Supplier A — CoA Comparison (R.0_261001)
<!-- rm-tracker
stamp: ขาด
-->

**Operative reference:** USP39-NF34

## Sources

| Document | Path |
|---|---|
| Candidate CoA | Document\\261001 |

## Part 2 — Full Comparison

| # | Test | Reference criteria | Candidate result | Verdict |
|---|---|---|---|---|
| 1 | Assay | 98.0-102.0% | 99.6% | **Pass** (Note 1) |
| 2 | Identification B | Conforms | Not reported | **Missing** (Note 2) |
| 3 | Water | NMT 0.5% | 0.7% | **Fail** |
| 4 | Residue | NMT 0.1% | 0.05% | **Pass (incumbent). Missing for candidate** |

## Notes

1. **Note 1** — fine.
   continues here.
2. **Note 2** — no ID result.

## Overall Verdict

**Confirm, ask for extra info (ขาด).**

| Status | Count | Items |
|---|---|---|
| **Pass** | 1 | Assay |

## Supporting Documents Status

| Document | Status | Notes |
|---|---|---|
| GMP certificate | Missing | — |
| MSDS | Pending — requested after CoA | — |
| CoA | On file | — |
`

test('sections, tables and lists', () => {
  const d = parseDoc(MD)
  assert.equal(d.title, 'Material X — Supplier A — CoA Comparison (R.0_261001)')
  assert.deepEqual(d.sections.map(s => s.kind), ['header', 'sources', 'part2', 'notes', 'verdict', 'docs'])
  const t = d.sections[2].blocks[0]
  assert.equal(t.rows.length, 4)
  assert.equal(t.verdictCol, 4)
  assert.deepEqual(t.tones, ['pass', 'missing', 'fail', 'missing'])
  assert.deepEqual(d.sections[3].blocks[0].items, ['**Note 1** — fine. continues here.', '**Note 2** — no ID result.'])
  assert.ok(d.sections[4].blocks.find(b => b.type === 'table').isCount)
})

test('verdict and status words, worst wins', () => {
  assert.equal(toneOf('**Pass / Pass** (Note 2)'), 'pass')
  assert.equal(toneOf('**Fail/Missing** (Note 3)'), 'fail')
  assert.equal(toneOf('Not submitted'), 'missing')
  assert.equal(toneOf('On file, expired'), 'confirm')
  assert.equal(toneOf('Pending — requested after CoA'), 'pending')
  assert.equal(toneOf('Reviewed — ไม่ผ่าน'), 'fail')
  assert.equal(toneOf('N/A (Note 7)'), 'na')
  assert.equal(toneOf('Pass — no failure'), 'pass')
  assert.equal(toneOf("**Pass** for candidate; **Fail** for the incumbent's own result"), 'pass')
  assert.ok(cellGap('**Not reported**'))
  assert.ok(!cellGap('99.6%'))
})

test('issues and tally', () => {
  const d = parseDoc(MD)
  assert.deepEqual(issuesOf(d).map(i => [i.tone, i.label, i.text]), [
    ['missing', 'Identification B', 'Reference criteria: Conforms · Candidate result: Not reported'],
    ['fail', 'Water', 'Reference criteria: NMT 0.5% · Candidate result: 0.7%'],
    ['missing', 'Residue', 'Pass (incumbent). Missing for candidate'],
    ['missing', 'GMP certificate', 'Missing'],
  ])
  assert.deepEqual(tally(d), { fail: 1, missing: 2, confirm: 0, pass: 1, docsMissing: 1 })
})

test('English: whole words only, glosses collapse', () => {
  assert.equal(toEnglish('signature blocks (ผู้ประเมิน/ผู้อนุมัติ)'), 'signature blocks (Evaluator/Approver)')
  assert.equal(toEnglish('marked ผ่าน (Pass), signed'), 'marked Pass, signed')
  assert.equal(toEnglish('บริษัท เคมีคอล จำกัด'), 'บริษัท เคมีคอล Co., Ltd.')
  assert.equal(toEnglish('บริษัท เคมีคอล จำกัด', { 'บริษัท เคมีคอล จำกัด': 'Chemical Co., Ltd.' }), 'Chemical Co., Ltd.')
  assert.equal(toEnglish('**฿630/kg**'), '**฿630/kg**')
})
