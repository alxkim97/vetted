import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { planFiling, applyPlan } from '../lib/filein.js'
import { scanFolder, SAMPLE_NAME } from '../lib/scanner.js'
import { buildRows, sampleOf, isSamplePhoto } from '../src/model.js'
import { healthCheck } from '../src/health.js'

// Sample photos sit in the candidate's flat Sample\ folder, dated by their
// name. Made-up names only (public repo).
const PHOTO = '261118 Material A Sample (Maker A, Lot L1, 100 g) - 1.jpeg'

function setup() {
  const base = mkdtempSync(join(tmpdir(), 'sample-'))
  const root = join(base, 'RM'), inbox = join(base, 'dumpout')
  mkdirSync(join(root, 'Material A', 'Maker A', 'Document', '261110'), { recursive: true })
  writeFileSync(join(root, 'Material A', 'Maker A', 'Document', '261110', '261110 Material A Selection Form FR-QA-PC-069 + CoA (Maker A).pdf'), 'form')
  writeFileSync(join(root, 'Material A', 'Maker A', 'Material A (Maker A) CoA Comparison (R.0_261111).md'), '<!-- rm-tracker\ncoa: ผ่าน\n-->\n**Overall Verdict: PASS**\n')
  mkdirSync(inbox)
  writeFileSync(join(inbox, '261118 IMG_0001.jpeg'), 'photo')
  writeFileSync(join(inbox, 'Scan0001.pdf'), 'scan')
  return { base, root, inbox, sources: [inbox] }
}

test('file-in: a sample photo goes to the flat <Candidate>\\Sample and nowhere else', () => {
  const s = setup()
  const ok = planFiling({ items: [{ src: join(s.inbox, '261118 IMG_0001.jpeg'), name: PHOTO, dest: 'Material A\\Maker A\\Sample' }] }, s)
  assert.equal(ok.ok, true, ok.items[0].errors.join())
  assert.ok(ok.items[0].flags.includes('NEW SAMPLE FOLDER'))
  assert.equal(applyPlan(ok).error, null)
  assert.ok(existsSync(join(s.root, 'Material A', 'Maker A', 'Sample', PHOTO)))

  const s2 = setup()
  assert.match(planFiling({ items: [{ src: join(s2.inbox, '261118 IMG_0001.jpeg'), name: PHOTO, dest: 'Material A\\Maker A\\Document\\261118' }] }, s2).items[0].errors.join(), /go in .*Sample/)
  assert.match(planFiling({ items: [{ src: join(s2.inbox, '261118 IMG_0001.jpeg'), name: '261118 Material A Label.jpeg', dest: 'Material A\\Maker A\\Sample' }] }, s2).items[0].errors.join(), /sample photo is named/)
  assert.match(planFiling({ items: [{ src: join(s2.inbox, 'Scan0001.pdf'), name: '261118 Material A Sample Note (Maker A) - 1.pdf', dest: 'Material A\\Maker A\\Sample' }] }, s2).items[0].errors.join(), /only photos/)
  assert.match(planFiling({ items: [{ src: join(s2.inbox, '261118 IMG_0001.jpeg'), name: PHOTO, dest: 'Material A\\Maker Z\\Sample' }] }, s2).items[0].errors.join(), /no folder Material A\\Maker Z/)
})

test('scanner: Sample\\ photos are listed, dated by name, and make no "documents received" entry', () => {
  const s = setup()
  const dir = join(s.root, 'Material A', 'Maker A', 'Sample')
  mkdirSync(dir)
  writeFileSync(join(dir, PHOTO), 'p')
  writeFileSync(join(dir, 'IMG_0002.jpeg'), 'no date')
  const scan = scanFolder(s.root, { avlFile: null })
  assert.equal(scan.evaluations.length, 1)
  assert.equal(scan.events.length, 1) // the 261110 Document folder only
  const photo = scan.files.find(f => f.sample)
  assert.equal(photo.doc_date, '2026-11-18')
  assert.equal(photo.rel, `Material A/Maker A/Sample/${PHOTO}`)
  assert.equal(photo.eval_folder, 'Material A/Maker A')
  assert.ok(isSamplePhoto(photo.rel))
  assert.equal(scan.skipped.length, 1)
  assert.ok(!scan.files.some(f => f.name === 'IMG_0002.jpeg'))
  assert.ok(SAMPLE_NAME.test(PHOTO))
})

const ask = (date, closed = null) => ({ id: 'q', kind: 'docs_requested', topic: 'sample', party: 'PU', event_date: date, what: '100 g sample', closed_on: closed })
const photos = dates => dates.map((d, i) => ({ name: `p${i}.jpeg`, doc_date: d }))

test('sampleOf flags photos dated on or after the open request, and only then', () => {
  assert.deepEqual(sampleOf([ask('2026-11-12')], {}, {}, '2026-11-20', photos(['2026-11-18', '2026-11-19'])).photo, { date: '2026-11-18', count: 2 })
  assert.equal(sampleOf([ask('2026-11-12')], {}, {}, '2026-11-20', photos(['2026-11-01'])).photo, null) // older photo, other sample
  assert.equal(sampleOf([ask('2026-11-12', '2026-11-18')], {}, {}, '2026-11-20', photos(['2026-11-18'])).photo, null) // already received
  assert.equal(sampleOf([], {}, {}, '2026-11-20', photos(['2026-11-18'])), null) // no request to flag against
})

test('Needs a look lists a filed sample photo against the open request', () => {
  const materials = [{ id: 'm', name: 'Material A', products: [] }]
  const evaluation = { id: 'a', material_id: 'm', file_name: 'Material A (Maker A) CoA Comparison (R.0_261111).md', verdict_line: 'x', rev: 0, rev_date: '2026-11-11', first_rev_date: '2026-11-11', folder: 'Material A/Maker A', tracker: { coa: 'pass' } }
  const events = [{ ...ask('2026-11-12'), evaluation_id: 'a', material_id: 'm' }]
  const files = [{ id: 'f', evaluation_id: 'a', rel: `Material A/Maker A/Sample/${PHOTO}`, name: PHOTO, doc_date: '2026-11-18' }]
  const rows = buildRows({ materials, evaluations: [evaluation], events, files })
  const hit = healthCheck(rows, files).find(x => x.rule === 'sample_photo_open')
  assert.ok(hit)
  assert.match(hit.reason, /18-11-26/)
  // The same photo in Document\ is not a sample photo.
  const rows2 = buildRows({ materials, evaluations: [evaluation], events, files: [{ ...files[0], rel: `Material A/Maker A/Document/261118/${PHOTO}` }] })
  assert.ok(!healthCheck(rows2, []).some(x => x.rule === 'sample_photo_open'))
})
