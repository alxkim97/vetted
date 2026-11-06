// Intake check for one material folder. Read-only: reads the AVL and the
// evaluation folders, prints a short checklist, never writes or moves anything.
//   npm run check -- "<material folder or candidate folder>"
//   npm run check -- "Material A"      (name looked up under the evaluation root)
//   add --json for machine-readable output
import { readdirSync, existsSync, statSync } from 'node:fs'
import { join, resolve, basename, sep } from 'node:path'
import { readAvl } from '../lib/avl.js'
import { matchAvl } from '../lib/avl.js'
import { DEFAULT_ROOT } from '../lib/scanner.js'

const args = process.argv.slice(2)
const json = args.includes('--json')
const target = args.find(a => !a.startsWith('--'))
if (!target) { console.error('Usage: npm run check -- "<material folder>" [--json]'); process.exit(1) }

const ls = p => { try { return readdirSync(p, { withFileTypes: true }) } catch { return [] } }
const files = p => ls(p).filter(e => e.isFile()).map(e => e.name)
const subdirs = p => ls(p).filter(e => e.isDirectory()).map(e => e.name)
const SKIP = new Set(['Old', 'References', 'Document'])

// Resolve the argument to a material folder (first folder under the root).
let abs = existsSync(target) ? resolve(target) : join(DEFAULT_ROOT, target)
if (!existsSync(abs)) { console.error(`Not found: ${target}`); process.exit(1) }
const rel = abs.startsWith(DEFAULT_ROOT) ? abs.slice(DEFAULT_ROOT.length).split(sep).filter(Boolean) : [basename(abs)]
const materialName = rel[0]
const materialDir = abs.startsWith(DEFAULT_ROOT) ? join(DEFAULT_ROOT, materialName) : abs

// Candidate folders = the folders that hold a Document folder (grade folders sit above them).
const candidates = []
const walk = (dir, segs) => {
  const names = subdirs(dir)
  if (names.includes('Document')) { candidates.push({ dir, segs }); }
  for (const n of names) if (!SKIP.has(n)) walk(join(dir, n), [...segs, n])
}
walk(materialDir, [])
const onlyCand = rel.length > 1 ? candidates.filter(c => c.segs.join(sep).startsWith(rel.slice(1).join(sep))) : candidates

// References live at the material level or at the grade level (the folder above the candidate).
const refDirs = c => [join(materialDir, 'References'), ...c.segs.slice(0, -1).map((_, i) => join(materialDir, ...c.segs.slice(0, i + 1), 'References'))].filter(existsSync)
const pdfs = names => names.filter(n => /\.(pdf|png|jpe?g)$/i.test(n))
const edition = n => (n.match(/\(((?:USP|BP|EP|JP|IP)[^)]*)\)/i) || [])[1] || null

const avl = readAvl()
const report = { material: materialName, avl: avl ? { file: avl.file, date: avl.fileDate, rows: avl.rows.length } : null, candidates: [] }

for (const c of onlyCand) {
  const maker = c.segs[c.segs.length - 1]
  const refs = refDirs(c)
  const apmCoa = refs.flatMap(r => ls(r).filter(e => e.isDirectory() && /apm\s*co[a]/i.test(e.name)).flatMap(e => pdfs(files(join(r, e.name)))))
  const incumbent = [...refs.flatMap(r => pdfs(files(r))), ...pdfs(files(c.dir))].filter(n => /incumbent/i.test(n))
  const monograph = refs.flatMap(r => pdfs(files(r))).filter(n => /monograph/i.test(n))
  const description = refs.flatMap(r => pdfs(files(r))).filter(n => /description|solubility/i.test(n))
  const docsRoot = join(c.dir, 'Document')
  const packs = subdirs(docsRoot).sort().map(d => ({ date: d, files: pdfs(files(join(docsRoot, d))) }))
  const comparison = files(c.dir).filter(n => /CoA Comparison.*\.md$/i.test(n))
  const m = avl ? matchAvl(avl, { material: c.segs.length > 1 ? `${materialName}` : materialName, manufacturer: maker.replace(/\s*\(.*\)$/, '') }) : null
  report.candidates.push({ maker, path: c.segs.join('/'), avl: m, apmCoa, incumbent, monograph, description, editions: [...new Set([...monograph, ...description].map(edition).filter(Boolean))], packs, comparison })
}

if (json) { console.log(JSON.stringify(report, null, 2)); process.exit(0) }

const ok = '[ok]  ', gap = '[gap] ', ask = '[?]   '
const out = []
out.push(`Material   ${report.material}`)
out.push(avl ? `AVL file   ${basename(avl.file)}  (${avl.fileDate}, ${avl.rows.length} rows)` : 'AVL file   NOT REACHABLE (is Z: connected?)')
for (const c of report.candidates) {
  out.push('', `── ${c.maker}  (${c.path})`)
  const a = c.avl
  if (!a) out.push(`${ask}AVL         not checked`)
  else if (a.review) out.push(`${ask}AVL         close match, needs your confirmation: ${a.reason || ''}`)
  else if (a.listed) out.push(`${ok}AVL         LISTED as "${a.manufacturer}" (since ${a.date || '?'}) -> close the evaluation`)
  else out.push(`${ok}AVL         NOT LISTED -> continue the evaluation`)
  out.push(c.apmCoa.length ? `${ok}APm CoA     ${c.apmCoa.join('; ')}` : `${gap}APm CoA     none in References\\APm COA`)
  out.push(c.incumbent.length ? `${ok}Incumbent   ${c.incumbent.join('; ')}` : `${ask}Incumbent   none found by file name`)
  const last = c.packs[c.packs.length - 1]
  out.push(last ? `${ok}Candidate   ${c.packs.length} dated folder(s), latest ${last.date}: ${last.files.length} file(s)` : `${gap}Candidate   Document folder is empty`)
  out.push(c.monograph.length ? `${ok}Monograph   ${c.monograph.join('; ')}` : `${gap}Monograph   none in References`)
  out.push(c.description.length ? `${ok}Description ${c.description.join('; ')}` : `${gap}Description none in References`)
  if (c.editions.length) out.push(`            editions on file: ${c.editions.join(', ')}`)
  out.push(c.comparison.length ? `${ok}Comparison  ${c.comparison.join('; ')}` : `${ask}Comparison  none yet`)
}
out.push('', `Next: /rm-eval ${report.material}`)
console.log(out.join('\n'))
