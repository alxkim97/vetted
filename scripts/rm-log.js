// Log a tracking event from a chat (or the terminal) without opening the app.
//
//   node scripts/rm-log.js <action> --material "<name>" [--candidate "<name>"] [options]
//
// Actions:
//   message    a message sent        --party "PU (K. Am)" --note "what was said"
//   requested  documents requested   --what "GMP, MSDS, 50 g sample" --party "PU" [--form]
//                                    (--form = paperwork only, e.g. a signed Selection Form;
//                                     it doesn't move the row to In progress)
//   received   documents received    --what "GMP certificate" [--close all]  (closes open requests)
//   verdict    CoA verdict issued    --coa ขาด --what "one-line reason" [--next "next action"]
//   note       free note             --note "..."
//   set        update fields only    --coa --docs --qc --outcome --supplier --manufacturer
//                                    --avl confirmed|differs --item 1000048 --next "..."
//   attach     add images to an existing entry   --event <id or first 8 chars> --image <path>
//   open       list open requests (all materials if --material is left out)
//
// Stages: --coa pass|missing|fail · --docs pass|missing|fail|pending · --qc approved|not-approved
//         --outcome approved|not-approved|closed. The older --stamp still works (ผ่าน/ขาด/ไม่ผ่าน
//         set the CoA result, closed-approved/closed-not-approved set the outcome).
// Common: --date YYMMDD (default today). --image <path> (repeatable) attaches an evidence
// image (LINE screenshot, email, form scan) to the entry being logged. --material and
// --candidate match any part of the folder or candidate name; ambiguous matches are
// listed, nothing is written.
import { readFileSync } from 'node:fs'
import { basename, extname } from 'node:path'
import { randomUUID } from 'node:crypto'
import { serviceClient } from './env.js'
import { normStamp, normStage, stampToStages, toIsoDate, STAGE_KEYS } from '../lib/parse.js'

const [action, ...rest] = process.argv.slice(2)
const opt = { image: [] }
for (let i = 0; i < rest.length; i++) {
  if (!rest[i].startsWith('--')) continue
  const k = rest[i].slice(2)
  const v = rest[i + 1]?.startsWith('--') || rest[i + 1] == null ? true : rest[++i]
  if (k === 'image') opt.image.push(v); else opt[k] = v
}

const ACTIONS = { message: 'message_sent', requested: 'docs_requested', received: 'docs_received', verdict: 'verdict', note: 'note' }
if (!action || !(action in ACTIONS || ['set', 'open', 'attach'].includes(action))) {
  console.error('Usage: node scripts/rm-log.js <message|requested|received|verdict|note|set|attach|open> --material "<name>" …  (see the top of this file)')
  process.exit(1)
}
const fail = msg => { console.error(msg); process.exit(1) }
const { supa } = serviceClient()
const must = ({ data, error }) => { if (error) fail(error.message); return data }
const today = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10) // Bangkok date
const date = opt.date ? toIsoDate(opt.date) || fail(`--date ${opt.date} isn't YYMMDD`) : today

// Evidence images go to the private rm-evidence bucket, one rm_evidence row each.
const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' }
async function attachImages(ev, paths) {
  for (const file of paths) {
    if (file === true) fail('--image needs a file path')
    const ext = extname(file).toLowerCase()
    if (!MIME[ext]) fail(`${file}: only ${Object.keys(MIME).join(' ')} images`)
    const path = `${ev.evaluation_id || ev.material_id}/${ev.id}/${randomUUID()}${ext}`
    must(await supa.storage.from('rm-evidence').upload(path, readFileSync(file), { contentType: MIME[ext] }))
    must(await supa.from('rm_evidence').insert({ event_id: ev.id, path, file_name: basename(file) }))
    console.log(`Attached ${basename(file)}`)
  }
}

if (action === 'attach') {
  if (!opt.event || opt.event === true) fail('--event <id> is required (rm-log open shows the first 8 characters)')
  if (!opt.image.length) fail('--image <path> is required')
  const hits = must(await supa.from('rm_events').select('id,evaluation_id,material_id')).filter(x => x.id.startsWith(opt.event))
  if (hits.length !== 1) fail(`${hits.length} entries start with ${opt.event}`)
  await attachImages(hits[0], opt.image)
  process.exit(0)
}

const mats = must(await supa.from('rm_materials').select('id,folder').is('removed_at', null))
const evals = must(await supa.from('rm_evaluations').select('id,folder,material_id,grade,candidate,candidate_name,tracker').is('removed_at', null))
const label = e => [mats.find(m => m.id === e.material_id)?.folder, e.grade, e.tracker?.candidate || e.candidate_name || e.candidate].filter(Boolean).join(' / ')

if (action === 'open') {
  let q = supa.from('rm_events').select('id,evaluation_id,material_id,event_date,what,party,topic').eq('kind', 'docs_requested').is('closed_on', null).order('event_date')
  const rows = must(await q)
  if (!rows.length) { console.log('No open document requests.'); process.exit(0) }
  for (const r of rows) {
    const e = evals.find(x => x.id === r.evaluation_id)
    const days = Math.round((Date.parse(today) - Date.parse(r.event_date)) / 864e5)
    console.log(`${r.event_date}  ${String(days).padStart(3)} d  ${e ? label(e) : mats.find(m => m.id === r.material_id)?.folder}  ·  ${r.topic === 'form' ? '[form] ' : ''}${r.what || ''}${r.party ? `  (to ${r.party})` : ''}  [${r.id.slice(0, 8)}]`)
  }
  process.exit(0)
}

if (!opt.material) fail('--material is required')
const lc = s => String(s ?? '').toLowerCase()
const matHits = mats.filter(m => lc(m.folder).includes(lc(opt.material)))
if (!matHits.length) fail(`No material folder matches "${opt.material}"`)
if (matHits.length > 1) fail(`"${opt.material}" matches several materials:\n  ${matHits.map(m => m.folder).join('\n  ')}`)
const mat = matHits[0]
let cands = evals.filter(e => e.material_id === mat.id)
if (opt.candidate) cands = cands.filter(e => [e.folder, e.candidate, e.candidate_name, e.tracker?.candidate].some(v => lc(v).includes(lc(opt.candidate))))
if (cands.length > 1) fail(`Pick one with --candidate:\n  ${cands.map(label).join('\n  ')}`)
if (!cands.length && opt.candidate) fail(`No candidate under ${mat.folder} matches "${opt.candidate}"`)
const ev = cands[0] ?? null

// Field updates (set, and verdict --coa / --next)
const patch = {}
if (opt.stamp) Object.assign(patch, stampToStages(normStamp(opt.stamp) || fail(`--stamp ${opt.stamp}: use ผ่าน / ขาด / ไม่ผ่าน / closed-approved / closed-not-approved`)))
for (const k of STAGE_KEYS) {
  if (!opt[k]) continue
  const v = normStage(k, opt[k])
  if (v === undefined) fail(`--${k} ${opt[k]}: see the stage words at the top of this file`)
  patch[k] = v
}
if (opt.next) patch.next_action = opt.next
if (action === 'set') {
  if (opt.supplier) patch.supplier = opt.supplier
  if (opt.manufacturer) patch.manufacturer = opt.manufacturer
  if (opt.item) patch.item_code = opt.item
  if (opt.avl) patch.avl_listed = /^(y|confirmed)/i.test(opt.avl)
}
if (Object.keys(patch).length) {
  if (!ev) fail(`${mat.folder} has no evaluation row to update — run a scan first`)
  const old = must(await supa.from('rm_evaluations').select('coa,docs,qc,outcome,avl_listed').eq('id', ev.id).single())
  must(await supa.from('rm_evaluations').update(patch).eq('id', ev.id))
  console.log(`Updated ${label(ev)}: ${Object.keys(patch).join(', ')}`)
  // Each changed stage is also a dated stage entry (v0.7), so Vetted knows since when.
  const stages = [...STAGE_KEYS, 'avl_listed'].filter(k => k in patch && String(patch[k]) !== String(old[k]))
    .map(k => ({ material_id: mat.id, evaluation_id: ev.id, kind: 'stage', event_date: date, what: k === 'avl_listed' ? 'avl' : k, note: patch[k] == null ? null : String(patch[k]), source: 'chat' }))
  if (stages.length) {
    const { error } = await supa.from('rm_events').insert(stages)
    if (error) console.log(`(Stage dates not logged: ${error.message}. Run the v0.7.0 SQL.)`)
  }
}
if (action === 'set') process.exit(0)

const row = {
  material_id: mat.id, evaluation_id: ev?.id ?? null, kind: ACTIONS[action], event_date: date, source: 'chat',
  what: opt.what === true ? null : opt.what ?? (action === 'verdict' ? opt.coa ?? opt.stamp ?? null : null),
  party: opt.party === true ? null : opt.party ?? null,
  note: opt.note === true ? null : opt.note ?? null,
  ...(action === 'requested' && opt.form ? { topic: 'form' } : {}),
}
const logged = must(await supa.from('rm_events').insert(row).select('id,evaluation_id,material_id').single())
console.log(`Logged ${action} for ${ev ? label(ev) : mat.folder} on ${date}  [${logged.id.slice(0, 8)}]`)
await attachImages(logged, opt.image)

if (action === 'received' && opt.close) {
  let q = supa.from('rm_events').select('id').eq('kind', 'docs_requested').is('closed_on', null).eq('material_id', mat.id)
  if (ev) q = q.eq('evaluation_id', ev.id)
  let ids = must(await q).map(r => r.id)
  if (opt.close !== 'all' && opt.close !== true) ids = ids.filter(id => id.startsWith(opt.close))
  if (ids.length) must(await supa.from('rm_events').update({ closed_on: date }).in('id', ids))
  console.log(`Closed ${ids.length} open request${ids.length === 1 ? '' : 's'}`)
}
