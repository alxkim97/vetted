// Log a tracking event from a chat (or the terminal) without opening the app.
//
//   node scripts/rm-log.js <action> --material "<name>" [--candidate "<name>"] [options]
//
// Actions:
//   message    a message sent        --party "PU (K. Am)" --note "what was said"
//   requested  documents requested   --what "GMP, MSDS, 50 g sample" --party "PU"
//   received   documents received    --what "GMP certificate" [--close all]  (closes open requests)
//   verdict    CoA verdict issued    --stamp ขาด --what "one-line reason" [--next "next action"]
//   note       free note             --note "..."
//   set        update fields only    --stamp --supplier --manufacturer --avl yes|no --item 1000048 --next "..."
//   open       list open document requests (all materials if --material is left out)
//
// Common: --date YYMMDD (default today). --material and --candidate match any
// part of the folder or candidate name; ambiguous matches are listed, nothing is written.
import { serviceClient } from './env.js'
import { normStamp, toIsoDate } from '../lib/parse.js'

const [action, ...rest] = process.argv.slice(2)
const opt = {}
for (let i = 0; i < rest.length; i++) if (rest[i].startsWith('--')) opt[rest[i].slice(2)] = rest[i + 1]?.startsWith('--') || rest[i + 1] == null ? true : rest[++i]

const ACTIONS = { message: 'message_sent', requested: 'docs_requested', received: 'docs_received', verdict: 'verdict', note: 'note' }
if (!action || !(action in ACTIONS || action === 'set' || action === 'open')) {
  console.error('Usage: node scripts/rm-log.js <message|requested|received|verdict|note|set|open> --material "<name>" …  (see the top of this file)')
  process.exit(1)
}
const fail = msg => { console.error(msg); process.exit(1) }
const { supa } = serviceClient()
const must = ({ data, error }) => { if (error) fail(error.message); return data }
const today = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10) // Bangkok date
const date = opt.date ? toIsoDate(opt.date) || fail(`--date ${opt.date} isn't YYMMDD`) : today

const mats = must(await supa.from('rm_materials').select('id,folder').is('removed_at', null))
const evals = must(await supa.from('rm_evaluations').select('id,folder,material_id,grade,candidate,candidate_name,tracker').is('removed_at', null))
const label = e => [mats.find(m => m.id === e.material_id)?.folder, e.grade, e.tracker?.candidate || e.candidate_name || e.candidate].filter(Boolean).join(' / ')

if (action === 'open') {
  let q = supa.from('rm_events').select('id,evaluation_id,material_id,event_date,what,party').eq('kind', 'docs_requested').is('closed_on', null).order('event_date')
  const rows = must(await q)
  if (!rows.length) { console.log('No open document requests.'); process.exit(0) }
  for (const r of rows) {
    const e = evals.find(x => x.id === r.evaluation_id)
    const days = Math.round((Date.parse(today) - Date.parse(r.event_date)) / 864e5)
    console.log(`${r.event_date}  ${String(days).padStart(3)} d  ${e ? label(e) : mats.find(m => m.id === r.material_id)?.folder}  ·  ${r.what || ''}${r.party ? `  (to ${r.party})` : ''}  [${r.id.slice(0, 8)}]`)
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

// Field updates (set, and verdict --stamp / --next)
const patch = {}
if (opt.stamp) patch.stamp = normStamp(opt.stamp) || fail(`--stamp ${opt.stamp}: use ผ่าน / ขาด / ไม่ผ่าน / closed-approved / closed-not-approved`)
if (opt.next) patch.next_action = opt.next
if (action === 'set') {
  if (opt.supplier) patch.supplier = opt.supplier
  if (opt.manufacturer) patch.manufacturer = opt.manufacturer
  if (opt.item) patch.item_code = opt.item
  if (opt.avl) patch.avl_listed = /^y/i.test(opt.avl)
}
if (Object.keys(patch).length) {
  if (!ev) fail(`${mat.folder} has no evaluation row to update — run a scan first`)
  must(await supa.from('rm_evaluations').update(patch).eq('id', ev.id))
  console.log(`Updated ${label(ev)}: ${Object.keys(patch).join(', ')}`)
}
if (action === 'set') process.exit(0)

const row = {
  material_id: mat.id, evaluation_id: ev?.id ?? null, kind: ACTIONS[action], event_date: date, source: 'chat',
  what: opt.what === true ? null : opt.what ?? (action === 'verdict' && opt.stamp ? opt.stamp : null),
  party: opt.party === true ? null : opt.party ?? null,
  note: opt.note === true ? null : opt.note ?? null,
}
must(await supa.from('rm_events').insert(row))
console.log(`Logged ${action} for ${ev ? label(ev) : mat.folder} on ${date}`)

if (action === 'received' && opt.close) {
  let q = supa.from('rm_events').select('id').eq('kind', 'docs_requested').is('closed_on', null).eq('material_id', mat.id)
  if (ev) q = q.eq('evaluation_id', ev.id)
  let ids = must(await q).map(r => r.id)
  if (opt.close !== 'all' && opt.close !== true) ids = ids.filter(id => id.startsWith(opt.close))
  if (ids.length) must(await supa.from('rm_events').update({ closed_on: date }).in('id', ids))
  console.log(`Closed ${ids.length} open request${ids.length === 1 ? '' : 's'}`)
}
