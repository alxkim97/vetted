// QA's Approved Vendor List of starting materials (FR-QA-PC-055), read-only.
// One row per material + manufacturer (+ supplier). A row whose Next
// Evaluation is "-" was cancelled or failed; every other row counts as listed.
import { readFileSync, statSync } from 'node:fs'
import { readSheet } from './xlsx.js'

const AVL_NAME = '3.QA-Shared\\7.AVL\\FR-QA-PC-055 (R0) Approved Vendor List of Starting material-Apm.xlsm'
// Z: as mapped on the work PC, then the same share by network path (a
// scheduled task may not see mapped drives).
export const DEFAULT_AVL = [`Z:\\${AVL_NAME}`, `\\\\apmacc\\apm_group$\\${AVL_NAME}`]

const iso = d => d.toISOString().slice(0, 10)
// Excel serial day, "dd-mm-yy", or "yyyy-mm-dd…"; the sheet's 1900-12-31 placeholder is no date.
export function avlDate(v) {
  const s = String(v ?? '').trim()
  if (/^\d+(\.\d+)?$/.test(s)) return +s > 1000 ? iso(new Date(Date.UTC(1899, 11, 30) + Math.floor(+s) * 864e5)) : null
  let m = s.match(/^(\d{1,2})-(\d{1,2})-(\d{2})$/)
  if (m) return `20${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  return m && m[1] > '1900' ? `${m[1]}-${m[2]}-${m[3]}` : null
}

// Null when the file can't be reached (Z: not mapped, working from home):
// the scan then leaves the last result alone.
export function readAvl(files = DEFAULT_AVL) {
  let st, file
  for (const f of [files].flat().filter(Boolean)) { try { st = statSync(f); file = f; break } catch { /* next */ } }
  if (!st) return null
  const rows = readSheet(readFileSync(file))
  const h = rows.findIndex(r => r.some(c => /material name/i.test(c ?? '')) && r.some(c => /manufacturer/i.test(c ?? '')))
  if (h < 0) return null
  const col = re => rows[h].findIndex(c => re.test(String(c ?? '')))
  const [cMat, cMfr, cDate, cNext] = [col(/material name/i), col(/manufacturer/i), col(/date of evaluation/i), col(/next evaluation/i)]
  const list = rows.slice(h + 1).filter(r => r[cMat] && r[cMfr]).map(r => ({
    material: String(r[cMat]).replace(/\s+/g, ' ').trim(),
    manufacturer: String(r[cMfr]).replace(/\s+/g, ' ').trim(),
    date: avlDate(r[cDate]),
    active: String(r[cNext] ?? '').trim() !== '-',
  }))
  return { file, fileDate: iso(new Date(st.mtimeMs + 7 * 3600e3)), rows: list }
}

// ── Matching ──
const words = s => String(s ?? '').toLowerCase().normalize('NFKD').replace(/[^\w\s%]+/g, ' ').match(/[a-z0-9]+/g) || []
const MAT_STOP = new Set(['usp', 'bp', 'ep', 'nf', 'jp', 'grade', 'powder', 'the', 'of', 'and'])
const CO_STOP = new Set(('co ltd limited pvt private inc llc gmbh kg sa spa s l corporation corp company pharmaceutical pharmaceuticals pharma ' +
  'chemical chemicals chem industries industry group labs lab laboratories laboratory the and pt ag bv b v nv n se unit plc ' +
  'international products product drugs fine organics i ii iii').split(' '))
const GRADES = new Set(['heavy', 'light', 'micronized', 'micronised', 'regular', 'coarse', 'fine', 'granular', 'dense', 'powder'])
const set = (s, stop) => new Set(words(s).filter(w => !stop.has(w)))
const eq = (a, b) => a.size > 0 && a.size === b.size && [...a].every(x => b.has(x))
const within = (a, b) => a.size > 0 && [...a].every(x => b.has(x))
const parts = s => {
  const inside = [...String(s).matchAll(/\(([^)]*)\)/g)].map(m => m[1]).join(' ')
  return { all: set(s, MAT_STOP), core: set(String(s).replace(/\([^)]*\)/g, ' '), MAT_STOP), paren: set(inside, MAT_STOP) }
}

// 'same': clearly the same material (word order and punctuation aside; a
// bracketed grade must agree). 'near': one name holds the other, e.g.
// "Aluminium Hydroxide … Co-Dried Gel" for "Dried Aluminium Hydroxide Gel".
export function materialMatch(ours, theirs) {
  const a = parts(ours), b = parts(theirs)
  if (eq(a.all, b.all) || (eq(a.core, b.core) && (!a.paren.size || !b.paren.size))) return 'same'
  // (Heavy) against (Light): a different grade, not a near miss.
  const grade = p => p.size > 0 && [...p].every(w => GRADES.has(w))
  if (eq(a.core, b.core) && grade(a.paren) && grade(b.paren)) return null
  if (within(a.core, b.all) || within(b.core, a.all)) return 'near'
  return null
}
// 'same': every distinctive word of one name is in the other ("Corvo Labs"
// / "Corvo Labs Limited Unit-III"). 'near': only the first word agrees.
export function companyMatch(ours, theirs) {
  const a = set(ours, CO_STOP), b = set(theirs, CO_STOP)
  if (within(a, b) || within(b, a)) return 'same'
  const first = words(ours).find(w => !CO_STOP.has(w))
  return first && b.has(first) ? 'near' : null
}

// One candidate against the list. listed: true / false, or null when a row
// looks close but not certain, for Alex to confirm once in Settings.
export function matchAvl(avl, { material, grade, manufacturer }) {
  const base = { file_date: avl.fileDate }
  // "Kerry / Sheffield": either name may be the one on the list.
  const names = String(manufacturer ?? '').split(/\s*\/\s*/).filter(Boolean)
  if (!names.length) return { ...base, listed: null, reason: 'no manufacturer name' }
  const ours = [material, grade].filter(Boolean).join(' ')
  const company = mfr => names.map(n => companyMatch(n, mfr)).sort((x, y) => (x === 'same' ? 0 : x ? 1 : 2) - (y === 'same' ? 0 : y ? 1 : 2))[0]
  const hits = avl.rows.map(r => ({ ...r, m: materialMatch(ours, r.material), c: company(r.manufacturer) })).filter(r => r.m && r.c)
  const sure = hits.filter(r => r.m === 'same' && r.c === 'same')
  const row = r => ({ material: r.material, manufacturer: r.manufacturer, date: r.date, active: r.active })
  const latest = list => list.slice().sort((x, y) => String(x.date ?? '').localeCompare(String(y.date ?? ''))).pop()
  if (sure.some(r => r.active)) { const r = latest(sure.filter(x => x.active)); return { ...base, listed: true, ...row(r) } }
  if (sure.length) { const r = latest(sure); return { ...base, listed: false, cancelled: true, ...row(r) } }
  if (hits.length) return { ...base, listed: null, review: hits.map(row) }
  return { ...base, listed: false }
}
