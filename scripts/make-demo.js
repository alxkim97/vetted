// Builds src/demo-scan.json for `npm run demo`: a real scan of the RM folder
// shaped like the Supabase rows, with the stamps the verdict lines spell out
// already accepted, plus a few example timeline entries marked "(example)".
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { scanFolder } from '../lib/scanner.js'
import { suggestStamp, stampToStages } from '../lib/parse.js'
import { ROOT } from './env.js'

const scan = scanFolder(process.argv[2])
const now = new Date().toISOString()
const materials = scan.materials.map(m => ({ id: randomUUID(), folder: m.folder, name: m.name, kind: null, products: [], notes: null }))
const mat = Object.fromEntries(materials.map(m => [m.folder, m]))
const evaluations = scan.evaluations.map(e => ({
  id: randomUUID(), material_id: mat[e.material_folder].id, folder: e.folder, grade: e.grade, candidate: e.candidate,
  file_name: e.file_name, rev: e.rev, rev_date: e.rev_date, first_rev_date: e.first_rev_date, tracker: e.tracker, verdict_line: e.verdict_line,
  candidate_name: null, stamp: suggestStamp(e.verdict_line), supplier: null, manufacturer: null, avl_listed: null, item_code: null, next_action: null, notes: null,
  coa: null, docs: null, qc: null, outcome: null, ...stampToStages(suggestStamp(e.verdict_line)),
}))
const ev = Object.fromEntries(evaluations.map(e => [e.folder, e]))
const events = scan.events.map(x => ({
  id: randomUUID(), material_id: mat[x.material_folder].id, evaluation_id: x.eval_folder ? ev[x.eval_folder].id : null,
  kind: x.kind, event_date: x.event_date, what: x.what, party: null, note: null, closed_on: null, source: 'scan', source_ref: x.source_ref, created_at: now,
}))

// A few example timeline entries, marked "(example)", on the first open
// evaluations so the demo shows durations and waiting. Kept generic on purpose:
// this repo is public, so no supplier names or item codes live in it.
const open = evaluations.filter(e => ['gap', 'pass'].includes(e.stamp)).slice(0, 3)
const evidence = []
const add = (e, kind, daysAgo, fields) => {
  const d = new Date(Date.now() - daysAgo * 864e5).toISOString().slice(0, 10)
  const row = { id: randomUUID(), material_id: e.material_id, evaluation_id: e.id, kind, event_date: d, what: null, party: null, note: null, closed_on: null, topic: null, source: 'app', source_ref: null, created_at: now, ...fields }
  events.push(row)
  return row
}
// A stand-in for a LINE screenshot: the demo stub serves the path itself as the image.
const shot = (title, lines) => 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="640" height="420"><rect width="640" height="420" fill="#2b2b33"/><rect x="250" y="40" width="360" height="${60 + lines.length * 34}" rx="18" fill="#86d97a"/><text x="272" y="78" font-family="Segoe UI,Arial" font-size="20" font-weight="700" fill="#1d2b1a">${title}</text>${lines.map((l, i) => `<text x="272" y="${116 + i * 34}" font-family="Segoe UI,Arial" font-size="18" fill="#1d2b1a">${l}</text>`).join('')}<text x="560" y="${130 + lines.length * 34}" font-family="Segoe UI,Arial" font-size="14" fill="#9a9aa6">16.15</text></svg>`)
open.forEach((e, i) => {
  const msg = add(e, 'message_sent', 3 + i * 9, { party: i === 1 ? 'Manager' : 'PU', note: '(example) CoA verdict sent; asked for GMP and MSDS before the QC sample.' })
  add(e, 'docs_requested', 3 + i * 9, { party: 'PU', what: '(example) GMP certificate, MSDS' })
  if (i === 0) evidence.push({ id: randomUUID(), event_id: msg.id, path: shot('(example) Request to PU', ['CoA: Pass', 'Please send:', '- GMP certificate', '- MSDS']), file_name: '(example) LINE screenshot.png', created_at: now })
})
// One Missing row with only a paperwork request (doesn't count as In progress),
// and one further along: CoA and documents passed, waiting on the QC sample.
const more = evaluations.filter(e => e.coa && !open.includes(e) && !e.outcome)
if (more[0]) { more[0].coa = 'gap'; add(more[0], 'docs_requested', 1, { party: 'PU', what: '(example) Signed Selection Form', topic: 'form' }) }
if (more[1]) { Object.assign(more[1], { coa: 'pass', docs: 'pass', avl_listed: false }) }
// v0.9 examples: a QC sample at each step, and valid-until dates near and far.
const ago = n => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10)
const yymmdd = n => ago(-n).slice(2).replace(/-/g, '')
if (more[1]) {
  add(more[1], 'docs_requested', 14, { party: 'PU', what: '(example) QC sample 300 g with the CoA of the sampled lot', topic: 'sample', closed_on: ago(8) })
  add(more[1], 'docs_requested', 6, { party: 'QC', what: '(example) QC analysis request (FR-PR-PC-006)', topic: 'sample' })
  more[1].tracker = { ...more[1].tracker, gmp_valid_to: yymmdd(24), iso_valid_to: yymmdd(700) }
}
if (open[0]) { add(open[0], 'docs_requested', 3, { party: 'PU', what: '(example) QC sample 500 g', topic: 'sample' }); open[0].tracker = { ...open[0].tracker, quotation_valid_to: yymmdd(-4) } }
if (open[1]) open[1].tracker = { ...open[1].tracker, fssc_valid_to: yymmdd(52) }

// The comparison files themselves, for the full evaluation page.
const docs = Object.fromEntries(scan.evaluations.filter(e => e.body).map(e => [ev[e.folder].id, e.body]))
// The documents in each candidate's Document folders (listed, not uploaded).
const files = scan.files.map(f => ({ id: randomUUID(), rel: f.rel, name: f.name, doc_date: f.doc_date, size: f.size, mtime: f.mtime, path: null,
  material_id: mat[f.material_folder].id, evaluation_id: f.eval_folder ? ev[f.eval_folder]?.id ?? null : null }))
const out = { materials, evaluations, events, evidence, files, docs, lastRun: { trigger: 'demo', started_at: now, finished_at: now, ok: true, materials: materials.length, evaluations: evaluations.length, events_added: scan.events.length } }
writeFileSync(join(ROOT, 'src', 'demo-scan.json'), JSON.stringify(out, null, 1))
console.log(`src/demo-scan.json: ${materials.length} materials, ${evaluations.length} evaluations, ${events.length} events`)
