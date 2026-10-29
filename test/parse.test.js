import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseTracker, verdictLine, revOf, gradeAndCandidate, suggestStamp, isComparisonFile, normStamp } from '../lib/parse.js'

test('tracker block', () => {
  const t = parseTracker('# X\n<!-- rm-tracker\nstamp: ขาด\ncandidate: Supplier A\navl_listed: yes\nkind: Excipient\nverdict_date: 261008\n-->\n')
  assert.deepEqual(t, { stamp: 'gap', candidate: 'Supplier A', avl_listed: true, kind: 'excipient', verdict_date: '2026-10-08' })
  assert.equal(parseTracker('no block'), null)
  assert.equal(normStamp('ไม่ผ่าน'), 'fail')
})

test('verdict line: bold line under the heading, null for a count table', () => {
  assert.equal(verdictLine('## 7. Overall Verdict\n\n**Pass on the CoA (ผ่าน).** More.\n'), 'Pass on the CoA (ผ่าน). More.')
  assert.equal(verdictLine('## Overall Verdict\n\n| Status | Count |\n'), null)
  assert.equal(verdictLine('> **PROVISIONAL — mostly CONFIRM**\n'), null)
})

test('revision from file name', () => {
  assert.deepEqual(revOf('Etoricoxib (Supplier B) CoA Comparison (R.2_261027).md'), { rev: 2, revDate: '2026-10-27' })
})

test('grade and candidate from folders', () => {
  assert.deepEqual(gradeAndCandidate(['Supplier B'], 'Etoricoxib (Supplier B) CoA Comparison (R.2_261027).md', 'Etoricoxib'), { grade: null, candidate: 'Supplier B' })
  assert.deepEqual(gradeAndCandidate(['E15'], 'HPMC E15 CoA Comparison 260701 (R.1_260703).md', 'HPMC (Hypromellose)'), { grade: 'E15', candidate: null })
  assert.deepEqual(gradeAndCandidate(['USP Grade'], 'Nitrofurazone (USP Grade) CoA Comparison (R.5_260828).md', 'Nitrofurazone'), { grade: 'USP Grade', candidate: null })
  assert.deepEqual(gradeAndCandidate(['PH101', 'Supplier C'], 'MCC Supplier C CoA Comparison 260716 (R.5_260716).md', 'Microcrystalline Cellulose'), { grade: 'PH101', candidate: 'Supplier C' })
  assert.deepEqual(gradeAndCandidate([], 'Magnesium Hydroxide (Heavy) CoA Comparison 260821 (R.1_260821).md', 'Magnesium Hydroxide (Heavy)'), { grade: null, candidate: null })
  assert.deepEqual(gradeAndCandidate([], 'Diclofenac Diethylamine (Supplier D) CoA Comparison 261028 (R.1_261028).md', 'Diclofenac Diethylamine'), { grade: null, candidate: 'Supplier D' })
})

test('comparison files only', () => {
  assert.ok(isComparisonFile('eugenol_coa_comparison_260901 (R.8_260903).md'))
  assert.ok(!isComparisonFile('260727 LLP vs LP Monograph and CoA Comparison.md'))
  assert.ok(!isComparisonFile('Simethicone USP Edition and Item Variation Comparison (R.0_261008).md'))
})

test('stamp suggestions only when the line says it', () => {
  assert.equal(suggestStamp('Pass on the CoA, but ask for extra info before requesting a QC sample (ขาด).'), 'gap')
  assert.equal(suggestStamp('Pass on the CoA (ผ่าน), conditional on PU confirming'), 'pass')
  assert.equal(suggestStamp('CLOSED — NOT APPROVED (formal, 21-07-26).'), 'closed_no')
  assert.equal(suggestStamp('CLOSED — APPROVED (via RD-requested waiver'), 'closed_ok')
  assert.equal(suggestStamp('FAIL — 1 critical Fail (pH)'), 'fail')
  assert.equal(suggestStamp('Confirm — not yet an unconditional Pass.'), 'gap')
  assert.equal(suggestStamp('All 12 formal USP39 Hypromellose monograph tests covered'), null)
})
