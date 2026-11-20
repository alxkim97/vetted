import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { planFiling, applyPlan } from '../lib/filein.js'
import { formWords } from '../src/model.js'

// A throwaway RM folder and inbox per test. Made-up names only (public repo).
function setup() {
  const base = mkdtempSync(join(tmpdir(), 'filein-'))
  const root = join(base, 'RM'), scan = join(base, 'scan')
  mkdirSync(join(root, 'Material A', 'Supplier A', 'Document', '261101'), { recursive: true })
  mkdirSync(join(root, 'Material B', 'Document', '261101'), { recursive: true }) // flat layout
  mkdirSync(scan)
  writeFileSync(join(scan, 'Scan0001.pdf'), 'form scan')
  writeFileSync(join(scan, 'IMG_0001.jpeg'), 'photo')
  return { base, root, scan, sources: [scan] }
}
const FORM = '261116 Material A Selection Form FR-QA-PC-069 + CoA (Supplier A, Reviewer Annotated - CoA ผ่าน).pdf'
const item = (s, over = {}) => ({ src: join(s.scan, 'Scan0001.pdf'), name: FORM, dest: 'Material A\\Supplier A\\Document\\261116', ...over })

test('dry run: plans a copy and a rename, changes nothing', () => {
  const s = setup()
  const plan = planFiling({ items: [item(s)] }, s)
  assert.equal(plan.ok, true)
  const [x] = plan.items
  assert.equal(x.copy, true)
  assert.equal(x.rename, true)
  assert.deepEqual(x.verdict, ['pass'])
  assert.ok(x.flags.includes('NEW DATE FOLDER'))
  assert.ok(existsSync(join(s.scan, 'Scan0001.pdf')))
  assert.ok(!existsSync(join(s.root, 'Material A', 'Supplier A', 'Document', '261116')))
})

test('apply: copy lands, original renamed in place, log written; a rerun is a no-op', () => {
  const s = setup()
  const logFile = join(s.base, 'log.jsonl')
  const r = applyPlan(planFiling({ items: [item(s)] }, s), { logFile })
  assert.equal(r.error, null)
  const copy = join(s.root, 'Material A', 'Supplier A', 'Document', '261116', FORM)
  assert.equal(readFileSync(copy, 'utf8'), 'form scan')
  assert.ok(existsSync(join(s.scan, FORM)))
  assert.ok(!existsSync(join(s.scan, 'Scan0001.pdf')))
  assert.equal(readFileSync(logFile, 'utf8').trim().split('\n').length, 2)
  // Same manifest again: found under its new name, already copied, nothing to do.
  const again = planFiling({ items: [item(s)] }, s)
  assert.equal(again.ok, true)
  assert.ok(again.items[0].flags.includes('DONE'))
  assert.deepEqual(applyPlan(again).done, [])
})

test('one scan copied to two folders is renamed once', () => {
  const s = setup()
  mkdirSync(join(s.root, 'Material A', 'Supplier B', 'Document'), { recursive: true })
  const plan = planFiling({ items: [item(s), item(s, { dest: 'Material A\\Supplier B\\Document\\261116' })] }, s)
  assert.equal(plan.ok, true)
  const r = applyPlan(plan)
  assert.equal(r.error, null)
  assert.deepEqual(r.done.map(d => d.step), ['copied', 'copied', 'renamed'])
})

test('never overwrites a different file already in the Document folder', () => {
  const s = setup()
  const dir = join(s.root, 'Material A', 'Supplier A', 'Document', '261116')
  mkdirSync(dir)
  writeFileSync(join(dir, FORM), 'something else')
  const plan = planFiling({ items: [item(s)] }, s)
  assert.equal(plan.ok, false)
  assert.match(plan.items[0].errors.join(), /different file/)
  assert.throws(() => applyPlan(plan), /nothing was changed/)
  assert.equal(readFileSync(join(dir, FORM), 'utf8'), 'something else')
})

test('refuses bad names and destinations', () => {
  const s = setup()
  const errs = over => planFiling({ items: [item(s, over)] }, s).items[0].errors.join(' | ')
  assert.match(errs({ name: 'Material A Form.pdf' }), /start with the received date/)
  assert.match(errs({ name: '261116 Material_A Form.pdf' }), /underscore/)
  assert.match(errs({ name: '261116 Material A Form (R.1_261116).pdf' }), /revision marker/)
  assert.match(errs({ name: '261116 Material A Form.jpeg' }), /extension/)
  assert.match(errs({ dest: '..\\Elsewhere\\Document\\261116' }), /outside the RM folder/)
  assert.match(errs({ dest: 'Material A\\Supplier A\\Docs\\261116' }), /must end in/)
  assert.match(errs({ dest: 'Material A\\Supplier A\\Document\\261399' }), /must end in/)
  assert.match(errs({ dest: 'Material A\\Supplier A\\Old\\Document\\261116' }), /Old/)
  assert.match(errs({ src: join(s.base, 'Scan0001.pdf') }), /not inside/)
  assert.match(errs({ src: join(s.scan, 'Missing.pdf') }), /not found/)
})

test('a new candidate or material folder must be asked for', () => {
  const s = setup()
  const dest = 'Material A\\Supplier C\\Document\\261116'
  assert.match(planFiling({ items: [item(s, { dest })] }, s).items[0].errors.join(), /newCandidate/)
  const ok = planFiling({ items: [item(s, { dest, newCandidate: true })] }, s)
  assert.equal(ok.ok, true)
  assert.ok(ok.items[0].flags.some(f => /NEW CANDIDATE/.test(f)))
  assert.match(planFiling({ items: [item(s, { dest: 'Material Z\\Document\\261116' })] }, s).items[0].errors.join(), /newMaterial/)
})

test('warns: flat layout, date mismatch, form with no verdict word, HEIC', () => {
  const s = setup()
  writeFileSync(join(s.scan, 'IMG_0002.HEIC'), 'heic')
  const plan = planFiling({ items: [
    item(s, { dest: 'Material B\\Supplier A\\Document\\261116', newCandidate: true }),
    { src: join(s.scan, 'IMG_0001.jpeg'), name: '261115 Material A CoA (Supplier A, Photo).jpeg', dest: 'Material A\\Supplier A\\Document\\261116' },
    { src: join(s.scan, 'IMG_0002.HEIC'), name: '261116 Material A Selection Form (Supplier A, Reviewer Annotated).HEIC', dest: 'Material A\\Supplier A\\Document\\261116' },
  ] }, s)
  assert.equal(plan.ok, true)
  assert.match(plan.items[0].warnings.join(), /flat layout/)
  assert.match(plan.items[1].warnings.join(), /differs from the Document folder date/)
  assert.match(plan.items[2].warnings.join(), /no verdict word/)
  assert.match(plan.items[2].warnings.join(), /convert it first/)
})

test('two items onto one file, or one file under two names, are refused', () => {
  const s = setup()
  const twoOnOne = planFiling({ items: [item(s), { src: join(s.scan, 'IMG_0001.jpeg'), name: FORM.replace('.pdf', '.jpeg'), dest: 'Material A\\Supplier A\\Document\\261116' }, item(s)] }, s)
  assert.equal(twoOnOne.ok, false)
  const twoNames = planFiling({ items: [item(s), item(s, { name: FORM.replace('CoA ผ่าน', 'CoA ขาด'), dest: 'Material B\\Document\\261116' })] }, s)
  assert.match(twoNames.items[0].errors.join(), /different names/)
  assert.deepEqual(readdirSync(s.scan).sort(), ['IMG_0001.jpeg', 'Scan0001.pdf'])
})

test('formWords reads the verdict words Vetted dates stages from', () => {
  assert.deepEqual(formWords('261116 Material A Selection Form (Supplier A, Reviewer Annotated - CoA ผ่าน, GMP ขาด).pdf'), ['pass', 'gap'])
  assert.deepEqual(formWords('261116 Material A Selection Form (Supplier A, Reviewer Annotated - CoA ไม่ผ่าน).pdf'), ['fail'])
  assert.deepEqual(formWords('261116 Material A Selection Form (Supplier A, Reviewer Annotated).pdf'), [])
  assert.deepEqual(formWords('261116 Material A CoA (Supplier A).pdf'), [])
})
