import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseDoc } from '../lib/doc.js'
import { legacyTable, cmpTable } from '../lib/cmp.js'

const table = md => parseDoc(`## Part 2 — Full Comparison\n\n${md}`).sections[0].blocks[0]

test('the 9-column table pairs each party\'s spec and result', () => {
  const b = table(`| Test | Reference criteria (USP39-NF34) | APm criteria | Incumbent spec (1000000) | Candidate spec (X-104) | APm QC result (1000000, 4 lots) | Incumbent result | Candidate result (Batch 24021902) | Verdict |
|---|---|---|---|---|---|---|---|---|
| Appearance | White powder | Same as Reference | Same wording | Powder | Complied | See APm QC result | powder, white | **Confirm** *(Note 3)* |
| Solubility | Soluble in alkali | Same as Reference | Same wording | Not stated | Complied | See APm QC result | Not reported | **Missing** (routine) |
| Assay | 99.0–100.5% | Same as Reference | Same | ≥97.0% | 100.1% | See APm QC result | 98.8% | **Fail** — spec wider, result below 99.0% |`)
  assert.equal(cmpTable(b), null)
  const t = legacyTable(b)
  assert.deepEqual(t.cols, [
    { kind: 'ref', name: 'Reference spec', ed: 'USP39-NF34', lot: '' },
    { kind: 'apm', name: 'APm spec', ed: '', lot: '1000000, 4 lots' },
    { kind: 'inc', name: 'Incumbent', ed: '1000000', lot: '' },
    { kind: 'cand', name: 'Candidate', ed: 'X-104', lot: 'Batch 24021902' },
  ])
  const [a, s, as] = t.rows
  assert.deepEqual(a.cells.map(c => c.has), [true, true, true, true])
  assert.equal(a.cells[1].result, 'Complied')
  assert.equal(a.cells[2].noResult, true) // "See APm QC result" is a pointer, not a result
  assert.deepEqual(s.cells[3], { kind: 'cand', has: false, spec: '', result: 'Not reported', noResult: true })
  assert.deepEqual([a.tone, s.tone, as.tone], ['confirm', 'missing', 'fail'])
  assert.equal(as.verdict.rest, 'spec wider, result below 99.0%')
})

test('supplier-named columns: the word incumbent/candidate wins, else first = incumbent', () => {
  const named = legacyTable(table(`| # | Test | USP39/NF34 criteria | Alpha spec | Alpha result | APm QC result (S1) | Beta spec | Beta result | Verdict |
|---|---|---|---|---|---|---|---|---|
| 1 | Assay | 98–102% | 98–102% | 99% | 100% | 97–103% | 99% | **Fail** |`))
  assert.deepEqual(named.cols.map(c => [c.kind, c.name]), [['ref', 'Reference spec'], ['apm', 'APm spec'], ['inc', 'Incumbent: Alpha'], ['cand', 'Candidate: Beta']])
  assert.equal(named.rows[0].no, '1')
  const worded = legacyTable(table(`| Test | USP39 reference | Gamma spec, incumbent CSM (ref. USP 39) | Gamma/APm QC result | Delta spec, candidate | Delta result | Verdict |
|---|---|---|---|---|---|---|
| Assay | 98–102% | 98–102% | 100% | 98–102% | 99% | **Pass** |`))
  assert.deepEqual(worded.cols.map(c => [c.kind, c.name]), [['ref', 'Reference spec'], ['apm', 'APm spec'], ['inc', 'Incumbent: Gamma'], ['cand', 'Candidate: Delta']])
  assert.equal(worded.rows[0].cells[3].result, '99%')
})

test('tables that do not fit stay in the old view', () => {
  // a second APm results column (APm testing the candidate) has no place
  assert.equal(legacyTable(table(`| Test | USP39 reference | Alpha spec | Alpha result | APm QC result (incumbent) | Beta spec | Beta result | APm QC verification (candidate) | Verdict |
|---|---|---|---|---|---|---|---|---|
| Assay | 98–102% | 98–102% | 99% | 100% | 98–102% | 99% | 99% | **Pass** |`)), null)
  // not a comparison table
  assert.equal(legacyTable(table(`| Column | Source | Edition stated |
|---|---|---|
| Reference | Monograph | USP 43 |`)), null)
})
