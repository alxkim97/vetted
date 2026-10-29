// Pure parsing of comparison-file names and contents. No fs here, so it's
// easy to test (test/parse.test.js).

// The 3-tier PU stamp plus the two closed states (formal Selection Form outcome).
export const STAMPS = ['pass', 'gap', 'fail', 'closed_ok', 'closed_no']

const STAMP_WORDS = {
  pass: 'pass', 'ผ่าน': 'pass',
  gap: 'gap', 'ขาด': 'gap', confirm: 'gap', missing: 'gap',
  fail: 'fail', 'ไม่ผ่าน': 'fail',
  closed_ok: 'closed_ok', 'closed-approved': 'closed_ok', 'closed approved': 'closed_ok', approved: 'closed_ok',
  closed_no: 'closed_no', 'closed-not-approved': 'closed_no', 'closed not approved': 'closed_no', 'not approved': 'closed_no', 'ไม่อนุมัติ': 'closed_no',
}
export const normStamp = v => STAMP_WORDS[String(v ?? '').trim().toLowerCase()] ?? null

const YES = /^(y|yes|true|ใช่)$/i
const NO = /^(n|no|false|ไม่)$/i

// <!-- rm-tracker
// stamp: ขาด
// candidate: Supplier A
// ...
// -->
// An HTML comment, so it stays out of the PDF export.
export function parseTracker(text) {
  const m = text.match(/<!--\s*rm-tracker\b([\s\S]*?)-->/i)
  if (!m) return null
  const out = {}
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^\s*([a-z_]+)\s*:\s*(.*?)\s*$/i)
    if (!kv || !kv[2]) continue
    out[kv[1].toLowerCase()] = kv[2]
  }
  if (out.stamp) out.stamp = normStamp(out.stamp) ?? out.stamp
  if (out.kind) out.kind = /api|active/i.test(out.kind) ? 'api' : /excip/i.test(out.kind) ? 'excipient' : null
  if (out.avl_listed != null) out.avl_listed = YES.test(out.avl_listed) ? true : NO.test(out.avl_listed) ? false : null
  if (out.verdict_date) out.verdict_date = toIsoDate(out.verdict_date)
  return out
}

// First bold/quoted line under the "Overall Verdict" heading, as plain text.
// Older files put the verdict only in a count table — those return null.
export function verdictLine(text) {
  const lines = text.split(/\r?\n/)
  const at = lines.findIndex(l => /^#{1,4}\s.*overall verdict/i.test(l))
  if (at < 0) return null
  for (const raw of lines.slice(at + 1)) {
    const l = raw.trim()
    if (!l) continue
    if (/^#{1,4}\s/.test(l) || l.startsWith('|')) return null
    const plain = l.replace(/^>\s*/, '').replace(/\*\*|__|\*/g, '').trim()
    return plain.length > 320 ? plain.slice(0, 317).trimEnd() + '…' : plain
  }
  return null
}

// A stamp the verdict line spells out in so many words, offered in the app as
// a one-click suggestion — never applied on its own. null when it's not explicit.
export function suggestStamp(line) {
  const l = String(line ?? '')
  if (/closed\s*[—-]+\s*not approved|ไม่อนุมัติ|\bnot approved\b/i.test(l)) return 'closed_no'
  if (/closed\s*[—-]+\s*approved/i.test(l)) return 'closed_ok'
  if (/ไม่ผ่าน/.test(l)) return 'fail'
  if (/ขาด/.test(l)) return 'gap'
  if (/ผ่าน/.test(l)) return 'pass'
  if (/^fail\b/i.test(l)) return 'fail'
  if (/^confirm\b/i.test(l)) return 'gap'
  return null
}

// "(R.4_260727)" → { rev: 4, revDate: '2026-07-27' }
export function revOf(name) {
  const m = name.match(/\(R\.(\d+)_(\d{6})\)/i)
  return m ? { rev: Number(m[1]), revDate: toIsoDate(m[2]) } : { rev: null, revDate: null }
}

// YYMMDD → YYYY-MM-DD. Accepts an ISO date unchanged.
export function toIsoDate(s) {
  const v = String(s ?? '').trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v
  const m = v.match(/^(\d{2})(\d{2})(\d{2})$/)
  if (!m || +m[2] < 1 || +m[2] > 12 || +m[3] < 1 || +m[3] > 31) return null
  return `20${m[1]}-${m[2]}-${m[3]}`
}

export const isComparisonFile = name =>
  /\.md$/i.test(name) && /coa[ _]comparison/i.test(name) && !/\bvs\b/i.test(name)

// The bracketed name right before "CoA Comparison", e.g.
// "Etoricoxib (Supplier B) CoA Comparison (R.2_261027).md" → "Supplier B".
// Skips a bracket that's already part of the material folder name
// ("Magnesium Hydroxide (Heavy)").
export function nameParen(fileName, materialFolder) {
  const m = fileName.match(/\(([^()]+)\)\s*coa[ _]comparison/i)
  if (!m) return null
  return materialFolder.includes(`(${m[1]})`) ? null : m[1].trim()
}

// Grade/type and candidate from the folders between the material folder and
// the file (Folder Structure Convention in CLAUDE.md):
//   Material\file                          → no grade, candidate from filename
//   Material\Candidate\file                → candidate
//   Material\Grade\file                    → grade (HPMC\E15, PVP\K30, Nitrofurazone\USP Grade)
//   Material\Grade\Candidate\file          → both
export function gradeAndCandidate(segs, fileName, materialFolder) {
  const paren = nameParen(fileName, materialFolder)
  const isGrade = s => /grade/i.test(s ?? '')
  if (segs.length === 0) return { grade: null, candidate: paren && !isGrade(paren) ? paren : null }
  if (segs.length >= 2) return { grade: segs[0], candidate: segs[segs.length - 1] }
  const [seg] = segs
  if (paren && paren === seg && !isGrade(seg)) return { grade: null, candidate: seg }
  if (paren && paren !== seg && !isGrade(paren)) return { grade: seg, candidate: paren }
  return { grade: seg, candidate: null }
}

// Item codes 1000xxx are actives and 1001xxx excipients in APm's numbering
// (e.g. 1000042 Paracetamol, 1001044 Magnesium Stearate). A guess only — a
// tracker block or the app overrides it.
export const kindFromItemCode = code =>
  /^1000\d{3}$/.test(code ?? '') ? 'api' : /^1001\d{3}$/.test(code ?? '') ? 'excipient' : null
