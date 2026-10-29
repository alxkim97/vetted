// Builds src/demo-scan.json for `npm run demo`: a real scan of the RM folder
// shaped like the Supabase rows, with the stamps the verdict lines spell out
// already accepted, plus a few example timeline entries marked "(example)".
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { scanFolder } from '../lib/scanner.js'
import { suggestStamp } from '../lib/parse.js'
import { ROOT } from './env.js'

const scan = scanFolder(process.argv[2])
const now = new Date().toISOString()
const materials = scan.materials.map(m => ({ id: randomUUID(), folder: m.folder, name: m.name, kind: null, products: [], notes: null }))
const mat = Object.fromEntries(materials.map(m => [m.folder, m]))
const evaluations = scan.evaluations.map(e => ({
  id: randomUUID(), material_id: mat[e.material_folder].id, folder: e.folder, grade: e.grade, candidate: e.candidate,
  file_name: e.file_name, rev: e.rev, rev_date: e.rev_date, first_rev_date: e.first_rev_date, tracker: e.tracker, verdict_line: e.verdict_line,
  candidate_name: null, stamp: suggestStamp(e.verdict_line), supplier: null, manufacturer: null, avl_listed: null, item_code: null, next_action: null, notes: null,
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
const add = (e, kind, daysAgo, fields) => {
  const d = new Date(Date.now() - daysAgo * 864e5).toISOString().slice(0, 10)
  events.push({ id: randomUUID(), material_id: e.material_id, evaluation_id: e.id, kind, event_date: d, what: null, party: null, note: null, closed_on: null, source: 'app', source_ref: null, created_at: now, ...fields })
}
open.forEach((e, i) => {
  add(e, 'message_sent', 3 + i * 9, { party: i === 1 ? 'Manager' : 'PU', note: '(example) CoA verdict sent; asked for GMP and MSDS before the QC sample.' })
  add(e, 'docs_requested', 3 + i * 9, { party: 'PU', what: '(example) GMP certificate, MSDS' })
})

const out = { materials, evaluations, events, lastRun: { trigger: 'demo', started_at: now, finished_at: now, ok: true, materials: materials.length, evaluations: evaluations.length, events_added: scan.events.length } }
writeFileSync(join(ROOT, 'src', 'demo-scan.json'), JSON.stringify(out, null, 1))
console.log(`src/demo-scan.json: ${materials.length} materials, ${evaluations.length} evaluations, ${events.length} events`)
