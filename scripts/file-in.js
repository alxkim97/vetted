// Files new scans and sample photos into the RM folder from a manifest
// (format at the top of lib/filein.js). A dry run unless --apply.
//
//   node scripts/file-in.js <manifest.json>            show what would happen, change nothing
//   node scripts/file-in.js <manifest.json> --apply    copy, check, rename in place
//   add --json for machine-readable output, --root "<RM folder>" to point elsewhere
//
// Copies never overwrite; nothing is deleted or moved. Each copy and rename is
// appended to <RM folder>\_Admin\Inbox Log\YYMMDD File-in Log.jsonl.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { planFiling, applyPlan } from '../lib/filein.js'
import { DEFAULT_ROOT } from '../lib/scanner.js'

const args = process.argv.slice(2)
const arg = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null }
const file = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--root')
if (!file) { console.error('Usage: node scripts/file-in.js <manifest.json> [--apply] [--json] [--root "<RM folder>"]'); process.exit(1) }
const root = arg('--root') || process.env.RM_ROOT || DEFAULT_ROOT
const apply = args.includes('--apply'), json = args.includes('--json')

let manifest
try { manifest = JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, '')) } catch (e) { console.error(`Can't read ${file}: ${e.message}`); process.exit(1) }
let plan
try { plan = planFiling(manifest, { root }) } catch (e) { console.error(e.message); process.exit(1) }

const yymmdd = new Date(Date.now() + 7 * 3600e3).toISOString().slice(2, 10).replace(/-/g, '') // Bangkok
const result = apply && plan.ok ? applyPlan(plan, { logFile: join(root, '_Admin', 'Inbox Log', `${yymmdd} File-in Log.jsonl`) }) : null

if (json) {
  console.log(JSON.stringify({ ok: plan.ok, applied: !!result, result, items: plan.items.map(({ n, from, name, destRel, copy, rename, flags, warnings, errors, verdict }) => ({ n, from, name, dest: destRel, copy, rename, flags, warnings, errors, verdict })) }, null, 2))
} else {
  const WORD = { pass: 'ผ่าน', gap: 'ขาด', fail: 'ไม่ผ่าน' }
  for (const x of plan.items) {
    console.log(`\n${x.n}. ${x.from ?? x.src}`)
    if (x.name) console.log(`   name  ${x.name}`)
    if (x.destRel) console.log(`   to    ${x.destRel}`)
    const tags = [...x.flags, ...(x.verdict ? [`form says: ${x.verdict.map(v => WORD[v]).join(', ') || 'no verdict word'}`] : [])]
    if (tags.length) console.log(`   ${tags.map(t => `[${t}]`).join(' ')}`)
    for (const w of x.warnings) console.log(`   check  ${w}`)
    for (const e of x.errors) console.log(`   ERROR  ${e}`)
  }
  const copies = plan.items.filter(x => x.copy).length, renames = plan.items.filter(x => x.rename).length
  const errors = plan.items.reduce((s, x) => s + x.errors.length, 0), warns = plan.items.reduce((s, x) => s + x.warnings.length, 0)
  console.log(`\n${plan.items.length} item${plan.items.length === 1 ? '' : 's'} · ${copies} to copy · ${renames} to rename · ${warns} to check · ${errors} error${errors === 1 ? '' : 's'}`)
  if (!plan.ok) console.log(apply ? 'Nothing was changed: fix the errors first.' : 'Fix the errors before --apply.')
  else if (!result) console.log('Dry run: nothing changed. Run again with --apply to file them.')
  else {
    for (const d of result.done) console.log(`   ${d.step.padEnd(7)} ${d.file}`)
    console.log(result.error ? `STOPPED: ${result.error}` : `Done: ${result.done.filter(d => d.step === 'copied').length} copied, ${result.done.filter(d => d.step === 'renamed').length} renamed.`)
  }
}
process.exit(!plan.ok || result?.error ? 1 : 0)
