// The Part 2 comparison table in the QC-sheet layout (format set 261117).
// One row per test, one column per source, each source cell = limit, then the
// result from that source's lot in bold on the next line. Pure, no fs; shared
// by the app's Comparison tab and the PDF renderer (tested in test/cmp.test.js).
//
//   | No. | Test | Reference spec<br>USP 43<br>monograph | APm spec<br>In-house<br>QC S0000001 | Incumbent: Supplier A<br>USP 43<br>lot A123 | Candidate: Supplier B<br>edition not stated<br>lot B456 | Verdict |
//   | 3 | Water | NMT 0.5% | NMT 0.5%<br>**0.2%** | ... | ... | **Pass** Note 4 |
//   | 4.1 | Identification A | Positive | —<br>**Not tested** | ... | ... | **Pass** Note 3 |
//   | | **Outside the USP 43 monograph** | | | | | |
//   | 6 | Bulk density | — | 0.3 to 0.5 g/mL<br>**0.41** | ... | —<br>**Not on CoA** | Info Note 6 |
//
// A limit of "—" (or empty) means the source has no such test: its box is
// left unticked. The divider row starts the tests outside the monograph.
import { plain, toneOf } from './doc.js'

export const SOURCE_KINDS = [
  ['ref', /^reference\b/i, 'Reference'],
  ['apm', /^apm\b/i, 'APm'],
  ['inc', /^incumbent\b/i, 'Incumbent'],
  ['cand', /^candidate\b/i, 'Candidate'],
]
const splitBr = s => String(s ?? '').split(/<br\s*\/?>/i).map(x => x.trim())
const EMPTY = /^(—|–|-|n\/a)?$/i
const RESULT = /^\*\*(.+)\*\*$/
// "Not tested", "Not reported", "Not on CoA": no result to show, so no result bar.
export const isNoResult = s => /^(not\b|no result\b|missing\b)/i.test(plain(s))

// Header "Incumbent: Supplier A<br>USP 43<br>lot A123" → name, edition, lot.
function headCol(h, ci) {
  const [first, ed = '', lot = ''] = splitBr(h)
  const name = plain(first)
  const kind = SOURCE_KINDS.find(([, re]) => re.test(name))?.[0]
  if (!kind) return null
  return { ci, kind, name, ed: plain(ed), lot: plain(lot) }
}

// A source cell: limit lines, then an optional bold result line.
export function cellOf(text) {
  const parts = splitBr(text)
  let result = ''
  const last = parts[parts.length - 1]
  if (parts.length > 1 && RESULT.test(last)) result = last.match(RESULT)[1].trim()
  else if (parts.length === 1 && RESULT.test(last)) { result = last.match(RESULT)[1].trim(); parts[0] = '' }
  const spec = (result && parts.length > 1 ? parts.slice(0, -1) : parts).filter(p => p !== '').join('<br>')
  const has = !EMPTY.test(plain(spec))
  return { has, spec: has ? spec : '', result, noResult: !!result && isNoResult(result) }
}

// "**Confirm (!)** Note 5" → word, tone, rest.
export function verdictOf(text) {
  const t = String(text ?? '').trim()
  const bold = t.match(/^\*\*([^*]+)\*\*\s*(.*)$/)
  const word = plain(bold ? bold[1] : t.split(/\s+(?=Note\b)/)[0]).replace(/\s*\(!\)\s*$/, '').trim()
  const rest = plain(bold ? bold[2] : t.slice(word.length)).trim().replace(/^[—–:-]\s*/, '')
  return { word, tone: toneOf(word) ?? (/^info\b/i.test(word) ? 'info' : null), rest }
}

// ── Older files: the 9-column table (spec and result in separate columns) ──
// "Test | Reference criteria (USP 43) | APm criteria | Incumbent spec (…) |
// Candidate spec (…) | APm QC result (…) | Incumbent result | Candidate result
// (…) | Verdict", any order. Drawn in the new layout by pairing each party's
// spec and result columns. Only the app does this; the PDF prints older files
// as they are. Returns null when any column can't be placed.
const NAMES = { ref: 'Reference spec', apm: 'APm spec', inc: 'Incumbent', cand: 'Candidate' }
// a spec cell that says the source has no such test
const NO_SPEC = /^(—|–|-|n\/a\b|not (stated|in\b|on\b|listed|specified|applicable|tested|reported|given|provided)|none\b|no (spec|limit|test)\b|absent\b)/i
// last bracket of a header, nested ones included: "(Batch IBF(I)/0126003)"
const paren = h => (plain(h).match(/\((.*)\)\s*$/)?.[1] ?? '').trim()
const REF = /^(reference|official|current\s+(usp|bp|ep)|usp|nf\b|bp|ep\b|ph\.?\s*eur|jpe?\b)/i
const RESULT_WORD = /\b(results?|verification)\b/i

// One header → { role, part, party }. Supplier-named headers ("Alpha
// (incumbent) spec", "Beta result") get their party name; who is incumbent
// and who is candidate is settled once the whole header is read.
function legacyRole(h) {
  const t = plain(splitBr(h)[0])
  if (/^(#|no\.?)$/.test(t)) return { role: 'no' }
  if (/^(test|parameter)\b/i.test(t)) return { role: 'test' }
  if (/^(verdict|status)\b/i.test(t)) return { role: 'verdict' }
  if (REF.test(t)) return { role: 'ref' }
  const part = RESULT_WORD.test(t) ? 'result' : 'spec'
  // "APm QC result (incumbent, …)" is APm's; "Incumbent result (… / APm QC)" is the incumbent's
  if (/^apm\b/i.test(t)) return { role: 'apm', part }
  if (/\bincumbent\b/i.test(t)) return { role: 'inc', part, party: partyOf(t) }
  if (/\bcandidate\b/i.test(t)) return { role: 'cand', part, party: partyOf(t) }
  if (/\bapm\b/i.test(t)) return { role: 'apm', part }
  if (/\b(spec|specification|criteria|results?)\b/i.test(t)) return { role: 'party', part, party: partyOf(t) }
  return null
}
// "Alpha (incumbent) spec" → "Alpha"; "Incumbent spec (1000000)" → ""
function partyOf(t) {
  const name = t.replace(/\s*\(.*\)/g, '').replace(/[,—–].*$/, '')
    .replace(/\b(incumbent|candidate|spec(ification)?|criteria|results?|csm|coa)\b/gi, '').replace(/\s+/g, ' ').trim()
  return name
}

export function legacyTable(b) {
  if (b?.type !== 'table') return null
  const info = b.head.map(legacyRole)
  if (info.includes(null)) return null
  // supplier-named columns: the word incumbent/candidate wins, else order (first = incumbent)
  // "Tianpu result" joins "Tianpu spec, candidate"
  info.forEach(x => {
    if (x.role !== 'party') return
    const same = info.find(y => (y.role === 'inc' || y.role === 'cand') && y.party && y.party.toLowerCase() === x.party.toLowerCase())
    if (same) x.role = same.role
  })
  const named = [...new Set(info.filter(x => x.role === 'party').map(x => x.party))]
  const taken = new Set(info.filter(x => x.role === 'inc' || x.role === 'cand').map(x => x.role))
  const free = ['inc', 'cand'].filter(k => !taken.has(k))
  if (named.length > free.length) return null
  named.forEach((p, k) => info.forEach(x => { if (x.role === 'party' && x.party === p) x.role = free[k] }))
  const at = (role, part) => info.findIndex(x => x.role === role && (!part || x.part === part))
  const testCol = at('test'), verdictCol = at('verdict'), noCol = at('no')
  if (testCol < 0 || verdictCol < 0 || at('cand') < 0 || at('ref') < 0) return null
  // one spec and one result column per party at most
  for (const k of ['apm', 'inc', 'cand']) for (const p of ['spec', 'result']) if (info.filter(x => x.role === k && x.part === p).length > 1) return null
  const cols = []
  info.forEach((x, ci) => { if (x.role === 'ref') cols.push({ kind: 'ref', name: NAMES.ref, ed: plain(splitBr(b.head[ci])[0]).replace(/\s*\b(criteria|reference)\b\s*/gi, ' ').replace(/[()]/g, '').trim(), lot: '', spec: ci, result: -1 }) })
  for (const k of ['apm', 'inc', 'cand']) {
    const spec = at(k, 'spec'), result = at(k, 'result')
    if (spec < 0 && result < 0) continue
    const party = (spec >= 0 ? info[spec].party : info[result].party) || ''
    const ed = spec >= 0 ? paren(b.head[spec]) : ''
    const lot = result >= 0 ? paren(b.head[result]) : ''
    cols.push({ kind: k, name: party && k !== 'apm' ? `${NAMES[k]}: ${party}` : NAMES[k], ed, lot: lot === ed ? '' : lot, spec, result })
  }
  const rows = b.rows.map((r, ri) => {
    const v = verdictOf(r[verdictCol])
    const cells = cols.map(c => {
      const spec = c.spec >= 0 ? (r[c.spec] ?? '').trim() : ''
      const result = c.result >= 0 ? (r[c.result] ?? '').trim().replace(/^\*\*(.+)\*\*$/, '$1') : ''
      const has = !!plain(spec) && !NO_SPEC.test(plain(spec))
      return { kind: c.kind, has, spec: has ? spec : '', result: plain(result) ? result : '', noResult: !!plain(result) && (isNoResult(result) || /^see\b/i.test(plain(result))) }
    })
    return { ri, no: noCol >= 0 ? plain(r[noCol]) || String(ri + 1) : String(ri + 1), test: r[testCol] ?? '', cells, verdict: v, tone: b.tones?.[ri] ?? v.tone }
  })
  return { cols: cols.map(({ kind, name, ed, lot }) => ({ kind, name, ed, lot })), noCol, testCol, verdictCol, rows, legacy: true }
}

// Returns null when the table isn't in this layout (older 9-column files).
export function cmpTable(b) {
  if (b?.type !== 'table') return null
  const head = b.head.map(h => plain(splitBr(h)[0]))
  const noCol = head.findIndex(h => /^no\.?$/i.test(h))
  const testCol = head.findIndex(h => /^test\b/i.test(h))
  const verdictCol = head.findIndex(h => /^verdict\b/i.test(h))
  const cols = b.head.map((h, ci) => headCol(h, ci)).filter(Boolean)
  if (testCol < 0 || verdictCol < 0 || !cols.some(c => c.kind === 'cand') || !cols.some(c => c.kind === 'ref')) return null
  // the older layout splits each party into "spec" and "result" columns
  if (head.some(h => /\bresult\b/i.test(h))) return null
  const rows = b.rows.map((r, ri) => {
    const others = r.filter((c, ci) => ci !== testCol && plain(c))
    if (!others.length && /^\*\*.+\*\*$/.test(r[testCol] ?? '')) return { divider: plain(r[testCol]), ri }
    const v = verdictOf(r[verdictCol])
    return {
      ri, no: noCol >= 0 ? plain(r[noCol]) : String(ri + 1), test: r[testCol] ?? '',
      cells: cols.map(c => ({ kind: c.kind, ...cellOf(r[c.ci]) })),
      verdict: v, tone: b.tones?.[ri] ?? v.tone,
    }
  })
  return { cols, noCol, testCol, verdictCol, rows }
}

// Which source has which test, split at the divider row: monograph tests first,
// then the additional ones. Each group counts the ticks per source.
export function tickSummary(t) {
  const groups = [{ name: 'Mandatory: monograph tests', rows: [] }]
  for (const r of t.rows) {
    if (r.divider) groups.push({ name: 'Additional tests', rows: [] })
    else groups[groups.length - 1].rows.push(r)
  }
  const live = groups.filter(g => g.rows.length)
  const count = rows => t.cols.map((c, k) => rows.filter(r => r.cells[k].has).length)
  const all = live.flatMap(g => g.rows)
  return { groups: live.map(g => ({ ...g, counts: count(g.rows) })), counts: count(all), total: all.length }
}
