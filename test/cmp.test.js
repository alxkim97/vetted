import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseDoc, tally, listTree, issuesOf } from '../lib/doc.js'
import { cmpTable, cellOf, verdictOf, tickSummary } from '../lib/cmp.js'
import { renderHtml, overallWord } from '../lib/render.js'

const MD = `# Material Y — Supplier B — CoA Comparison (R.0_261117)

## Part 2 — Full Comparison

| No. | Test | Reference spec<br>USP 43<br>monograph | APm spec<br>USP 39<br>QC S0000001 | Incumbent: Supplier A<br>USP 43<br>lot A1 | Candidate: Supplier B<br>edition not stated<br>lot B1 | Verdict |
|---|---|---|---|---|---|---|
| 1 | Assay | 98.0 to 102.0% | Same as Reference<br>**99.8%** | 98.0 to 102.0%<br>**100.1%** | 98.5 to 101.5%<br>**99.6%** | **Pass** |
| 2.1 | Identification A (IR) | Conforms to standard | IR<br>**Complies** | —<br>**Not reported** | IR<br>**Conforms** | **Pass** Note 2 |
| 2.2 | Identification B | Positive | — | Positive<br>**Complies** | —<br>**Not on CoA** | **Missing** Note 3 |
| 3 | Water | NMT 0.5% | NMT 0.5%<br>**0.2%** | NMT 0.5%<br>**0.3%** | NMT 1.0%<br>**0.4%** | **Fail** Note 4 |
| | **Outside the USP 43 monograph** | | | | | |
| 4 | Bulk density | — | — | — | 0.3 to 0.5 g/mL<br>**0.41 g/mL** | Info |

## Notes

1. **First note.**
   - detail a
     - deeper
   - detail b
2. **Second note.**

## Overall Verdict

**FAIL — water spec wider than USP 43.**
`

test('cmpTable reads the QC-sheet layout', () => {
  const doc = parseDoc(MD)
  const b = doc.sections.find(s => s.kind === 'part2').blocks.find(x => x.type === 'table')
  const t = cmpTable(b)
  assert.ok(t)
  assert.deepEqual(t.cols.map(c => c.kind), ['ref', 'apm', 'inc', 'cand'])
  assert.deepEqual(t.cols[2], { ci: 4, kind: 'inc', name: 'Incumbent: Supplier A', ed: 'USP 43', lot: 'lot A1' })
  const [r1, r21, r22, r3, div, r4] = t.rows
  assert.equal(r1.no, '1')
  assert.deepEqual(r1.cells.map(c => c.has), [true, true, true, true])
  assert.equal(r1.cells[1].result, '99.8%')
  assert.equal(r21.cells[2].has, false)
  assert.equal(r21.cells[2].noResult, true)
  assert.deepEqual(r22.cells.map(c => c.has), [true, false, true, false])
  assert.equal(r22.tone, 'missing')
  assert.equal(r3.tone, 'fail')
  assert.equal(div.divider, 'Outside the USP 43 monograph')
  assert.equal(r4.verdict.word, 'Info')
  assert.equal(r4.tone, 'info')
})

test('the older nine-column layout is not mistaken for the new one', () => {
  const old = parseDoc(`## Part 2 — Full Comparison

| Test | Reference criteria (USP 43) | APm Criteria (USP 39) | Incumbent spec (USP 43) | Candidate spec (USP 43) | APm QC result (USP 39) | Incumbent result (USP 43) | Candidate result (USP 43) | Verdict |
|---|---|---|---|---|---|---|---|---|
| Assay | 98-102% | Same | 98-102% | 98-102% | 99% | 100% | 99% | **Pass** |
`)
  assert.equal(cmpTable(old.sections[0].blocks[0]), null)
})

test('cells, verdicts and the tick summary', () => {
  assert.deepEqual(cellOf('NMT 0.5%<br>**0.2%**'), { has: true, spec: 'NMT 0.5%', result: '0.2%', noResult: false })
  assert.deepEqual(cellOf('—'), { has: false, spec: '', result: '', noResult: false })
  assert.deepEqual(cellOf('**Not tested**'), { has: false, spec: '', result: 'Not tested', noResult: true })
  assert.deepEqual(cellOf('Line 1<br>line 2<br>**R**'), { has: true, spec: 'Line 1<br>line 2', result: 'R', noResult: false })
  assert.deepEqual(verdictOf('**Confirm (!)** Note 5'), { word: 'Confirm', tone: 'confirm', rest: 'Note 5' })
  const t = cmpTable(parseDoc(MD).sections.find(s => s.kind === 'part2').blocks[0])
  const s = tickSummary(t)
  assert.deepEqual(s.groups.map(g => [g.name, g.rows.length, g.counts]), [
    ['Mandatory: monograph tests', 4, [4, 3, 3, 3]],
    ['Additional tests', 1, [0, 0, 0, 1]],
  ])
  assert.deepEqual(s.counts, [4, 3, 3, 4])
})

test('counts and issues still come from the Verdict column', () => {
  const doc = parseDoc(MD)
  const c = tally(doc)
  assert.deepEqual([c.pass, c.missing, c.fail, c.confirm], [2, 1, 1, 0])
  assert.deepEqual(issuesOf(doc).map(i => [i.tone, i.label]), [['missing', 'Identification B'], ['fail', 'Water']])
})

test('nested lists keep their shape', () => {
  const doc = parseDoc(MD)
  const list = doc.sections.find(s => s.kind === 'notes').blocks[0]
  const tree = listTree(list)
  assert.equal(tree.length, 2)
  assert.equal(tree[0].num, 1)
  assert.deepEqual(tree[0].children.map(n => n.text), ['detail a', 'detail b'])
  assert.deepEqual(tree[0].children[0].children.map(n => n.text), ['deeper'])
  assert.equal(tree[1].num, 2)
})

test('the PDF page: overall word, coloured Part 2, nested notes', () => {
  assert.equal(overallWord(parseDoc(MD)), 'FAIL')
  const html = renderHtml(MD)
  assert.match(html, /<span class="overall">FAIL<\/span>/)
  assert.match(html, /<table class="cmp">/)
  assert.match(html, /<th class="inc"[^>]*>Incumbent: Supplier A<small class="ed">USP 43<\/small><small>lot A1<\/small>/)
  assert.match(html, /<span class="rs none">Not reported<\/span>/)
  assert.match(html, /<tr class="flag"><td class="no">2\.2<b class="bang">!<\/b>/)
  assert.match(html, /<li value="1"><b>First note.<\/b><ul><li>detail a<ul><li>deeper<\/li><\/ul><\/li><li>detail b<\/li><\/ul><\/li>/)
})
