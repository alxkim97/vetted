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
  const rest = plain(bold ? bold[2] : t.slice(word.length)).trim()
  return { word, tone: toneOf(word) ?? (/^info\b/i.test(word) ? 'info' : null), rest }
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
