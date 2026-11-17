// A comparison .md → one printable HTML page (A4 landscape), the PDF that goes
// next to the .md. Part 2 in the QC-sheet layout gets the coloured source
// bands; every other table prints as a plain grid. Built to survive a
// grayscale print: sources are split by heavy rules and named in the header,
// and each verdict differs in symbol and outline, not only in colour.
// Pure, no fs (scripts/render-pdf.js writes and prints it).
import { parseDoc, tally, plain, listTree } from './doc.js'
import { cmpTable } from './cmp.js'

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
export function inline(s) {
  return esc(s)
    .replace(/&lt;br\s*\/?&gt;/gi, '<br>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/(^|[^*\w])\*([^*\n]+)\*(?!\w)/g, '$1<i>$2</i>')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
}

const KIND_CLASS = { ref: 'ref', apm: 'apm', inc: 'inc', cand: 'cand' }
const SYMBOL = { pass: '✓ ', confirm: '! ', missing: '– ', fail: '✕ ' }
const FLAG = ['confirm', 'missing', 'fail']
const box = on => `<i class="box${on ? ' on' : ''}"></i>`

export function verdictPill(v, tone) {
  const t = tone || v.tone || 'other'
  return `<span class="vd t-${t}">${SYMBOL[t] ?? ''}${esc(v.word)}</span>${v.rest ? `<span class="vnote">${esc(v.rest)}</span>` : ''}`
}

function cmpHtml(t) {
  const n = t.cols.length
  const srcW = (100 - 4 - 14 - 10) / n
  const head = `<tr><th class="plain" style="width:4%">No.</th><th class="plain" style="width:14%">Test</th>${t.cols.map(c =>
    `<th class="${KIND_CLASS[c.kind]}" style="width:${srcW.toFixed(2)}%">${esc(c.name)}${c.ed ? `<small class="ed">${esc(c.ed)}</small>` : ''}${c.lot ? `<small>${esc(c.lot)}</small>` : ''}</th>`).join('')
  }<th class="vh" style="width:10%">Verdict</th></tr>`
  const body = t.rows.map(r => {
    if (r.divider) return `<tr class="div"><td colspan="${n + 3}">${esc(r.divider)}</td></tr>`
    const flag = FLAG.includes(r.tone)
    const cells = r.cells.map(c => `<td class="src ${KIND_CLASS[c.kind]}"><div class="cell"><span class="tk">${box(c.has)}</span><div class="tx">${
      c.spec ? `<span>${inline(c.spec)}</span>` : ''}${
      c.result ? `<span class="rs${c.noResult ? ' none' : ''}">${inline(c.result)}</span>` : ''}${
      !c.spec && !c.result ? '<span class="dash">—</span>' : ''}</div></div></td>`).join('')
    return `<tr${flag ? ' class="flag"' : ''}><td class="no">${esc(r.no)}${flag ? '<b class="bang">!</b>' : ''}</td><td class="test">${inline(r.test)}</td>${cells}<td class="vcell${flag ? ' fl' : ''}">${verdictPill(r.verdict, r.tone)}</td></tr>`
  }).join('')
  return `<table class="cmp"><thead>${head}</thead><tbody>${body}</tbody></table>
    <p class="legend"><span>${box(true)} the source has this test</span><span><b class="rbar">bold line</b> = result from that source's lot</span><span><b class="bang">!</b> = needs a decision</span></p>`
}

function gridHtml(b) {
  const v = b.verdictCol
  return `<table class="grid"><thead><tr>${b.head.map((h, i) => `<th${i === v ? ' class="v"' : ''}>${inline(h)}</th>`).join('')}</tr></thead><tbody>${
    b.rows.map(r => `<tr>${b.head.map((h, i) => `<td${i === v ? ' class="v"' : ''}>${inline(r[i] ?? '')}</td>`).join('')}</tr>`).join('')}</tbody></table>`
}

function listHtml(nodes) {
  const ordered = nodes[0]?.num != null
  const tag = ordered ? 'ol' : 'ul'
  return `<${tag}>${nodes.map(n => `<li${ordered && n.num != null ? ` value="${n.num}"` : ''}>${inline(n.text)}${n.children.length ? listHtml(n.children) : ''}</li>`).join('')}</${tag}>`
}

function blockHtml(b) {
  switch (b.type) {
    case 'table': { const t = cmpTable(b); return t ? cmpHtml(t) : gridHtml(b) }
    case 'h': return `<h3>${inline(b.text)}</h3>`
    case 'quote': return `<blockquote>${inline(b.text).replace(/\n/g, '<br>')}</blockquote>`
    case 'code': return `<pre>${esc(b.text)}</pre>`
    case 'list': return listHtml(listTree(b))
    default: return /^\*\*[^*]{1,60}:\*\*/.test(b.text) ? `<p class="kv">${inline(b.text)}</p>` : `<p>${inline(b.text)}</p>`
  }
}

// "PENDING — no Fail and no Missing; ..." → "PENDING"
export function overallWord(doc) {
  const sec = doc.sections.find(s => s.kind === 'verdict')
  const p = sec?.blocks.find(b => b.type === 'p')
  const m = plain(p?.text ?? '').match(/^([A-Z][A-Z/ ]*[A-Z])(?=\s*[—–:(,.-]|\s*$)/)
  return m ? m[1].trim() : null
}

export const CSS = `
@page { size: A4 landscape; margin: 11mm 10mm 13mm;
  @bottom-left { content: var(--doc-title, ""); }
  @bottom-right { content: "Page " counter(page) " of " counter(pages); font: 8pt 'Segoe UI', Arial, sans-serif; color: #444; } }
* { box-sizing: border-box; }
body { margin: 0; color: #111; font: 11pt/1.45 'Segoe UI', 'Leelawadee UI', Tahoma, Arial, sans-serif; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
h1 { font-size: 17pt; margin: 0 0 6px; letter-spacing: -.01em; }
h2 { font-size: 14pt; margin: 22px 0 10px; padding-bottom: 4px; border-bottom: 2px solid #111; break-after: avoid-page; }
h3 { font-size: 11.5pt; margin: 14px 0 6px; break-after: avoid-page; }
p, li { margin: 0 0 6px; orphans: 3; widows: 3; }
b, strong { font-weight: 700; color: #000; }
/* one topic per block: "AVL status:", "Drug product:" … with clear space between */
p.kv { margin: 0 0 4px; padding-top: 9px; border-top: 1px solid #d0d0d0; }
p.kv > b:first-child { font-weight: 800; }
p.kv + ul, p.kv + ol { margin-top: 2px; }
.sum + p.kv { border-top: 0; padding-top: 2px; }
ul, ol { margin: 0 0 8px; padding-left: 22px; }
li > ul, li > ol { margin: 2px 0 3px; }
ol > li { margin-top: 4px; }
code { font: 8.8pt Consolas, monospace; }
blockquote { margin: 0 0 6px; padding: 4px 10px; border-left: 3px solid #888; color: #333; }
pre { font: 8.5pt Consolas, monospace; white-space: pre-wrap; background: #f4f4f4; padding: 6px; }
.sum { display: flex; flex-wrap: wrap; gap: 6px 16px; align-items: center; margin: 4px 0 12px; padding: 7px 0; border-top: 2px solid #111; border-bottom: 2px solid #111; font-size: 11pt; }
.overall { background: #ffe600; border: 2px solid #111; font-weight: 800; padding: 1px 10px; letter-spacing: .04em; }
.cnt b { font-family: Consolas, monospace; font-size: 10.5pt; }
table { width: 100%; border-collapse: collapse; margin: 4px 0 8px; }
thead { display: table-header-group; }
tr { break-inside: avoid-page; }
table.grid { font-size: 9.6pt; table-layout: auto; }
.grid th, .grid td { border: 1px solid #999; padding: 3px 5px; vertical-align: top; text-align: left; overflow-wrap: anywhere; }
.grid th { background: #d9d9d9; }
.grid td.v { font-weight: 600; }
/* Part 2 in the QC-sheet layout */
table.cmp { table-layout: fixed; font-size: 9.6pt; line-height: 1.3; }
.cmp th, .cmp td { border: 1px solid #8a8a8a; padding: 0; vertical-align: top; }
.cmp th { font-size: 9.6pt; font-weight: 700; text-align: center; vertical-align: middle; padding: 4px 4px; line-height: 1.2; }
.cmp th small { display: block; font-weight: 500; font-size: 7.6pt; font-family: Consolas, monospace; }
.cmp th small.ed { font-family: inherit; font-weight: 600; font-size: 8pt; }
.cmp th.plain { background: #d4d4d4; } .cmp th.ref { background: #d4d4d4; } .cmp th.apm { background: #8db4ec; }
.cmp th.inc { background: #ffe08a; } .cmp th.cand { background: #b7dba5; } .cmp th.vh { background: #6fdc6f; }
.cmp th.ref, .cmp th.apm, .cmp th.inc, .cmp th.cand, .cmp th.vh, .cmp td.src, .cmp td.vcell { border-left: 2px solid #111; }
.cmp td.no { text-align: center; padding: 3px 2px; font: 8.4pt Consolas, monospace; }
.cmp td.test { padding: 3px 5px; font-weight: 600; }
.cell { display: grid; grid-template-columns: 17px 1fr; min-height: 100%; }
.tk { display: flex; justify-content: center; padding-top: 4px; }
td.ref .tk { background: #ececec; } td.apm .tk { background: #dfeafb; } td.inc .tk { background: #fff3cc; } td.cand .tk { background: #e2f1d9; }
.tx { padding: 3px 5px; display: flex; flex-direction: column; gap: 1px; min-width: 0; overflow-wrap: anywhere; }
.rs { font-weight: 700; border-left: 2px solid #111; padding-left: 4px; margin-top: 1px; }
.rs.none { border-left: 0; padding-left: 0; }
.dash { color: #999; }
.box { display: inline-block; width: 10px; height: 10px; border: 1.3px solid #222; border-radius: 2px; background: #fff; position: relative; flex: none; }
.box.on::after { content: ""; position: absolute; left: 2.3px; top: -.5px; width: 3px; height: 6.5px; border: solid #111; border-width: 0 1.7px 1.7px 0; transform: rotate(40deg); }
.cmp tr.div td { background: #efefef; font-size: 8pt; font-weight: 700; text-transform: uppercase; letter-spacing: .06em; color: #333; padding: 2px 6px; border-left: 1px solid #8a8a8a; }
.cmp tr.flag td { border-top: 2px solid #111; border-bottom: 2px solid #111; }
.cmp td.vcell { padding: 3px 5px; }
.cmp td.vcell.fl { background: #ffe600; }
.vd { display: inline-block; white-space: nowrap; font-weight: 700; font-size: 8.6pt; padding: 0 6px; border-radius: 3px; border: 1.2px solid #111; background: #fff; }
.vd.t-pass { background: #d8f5d8; }
.vd.t-confirm { background: #ffe600; border-width: 2.4px; font-weight: 800; }
.vd.t-missing { border-style: dashed; }
.vd.t-fail { background: #111; color: #fff; }
.vd.t-info, .vd.t-na, .vd.t-other { border-color: #999; color: #444; font-weight: 500; }
.vnote { display: block; font: 7.8pt Consolas, monospace; color: #444; margin-top: 2px; }
.bang { display: inline-block; margin-left: 3px; background: #111; color: #fff; border-radius: 50%; width: 11px; height: 11px; line-height: 11px; text-align: center; font-size: 8px; vertical-align: 1px; }
.legend { display: flex; flex-wrap: wrap; gap: 4px 16px; font-size: 8pt; color: #444; margin: -2px 0 8px; }
.legend .box { vertical-align: -1px; margin-right: 3px; }
.rbar { border-left: 2px solid #111; padding-left: 3px; color: #111; }
`

export function renderHtml(md) {
  const doc = parseDoc(md)
  const t = tally(doc)
  const word = overallWord(doc)
  const title = doc.title ?? 'CoA comparison'
  const sum = `<div class="sum">${word ? `<span class="overall">${esc(word)}</span>` : ''}<span class="cnt"><b>${t.pass}</b> Pass &nbsp; <b>${t.confirm}</b> Confirm &nbsp; <b>${t.missing}</b> Missing &nbsp; <b>${t.fail}</b> Fail</span></div>`
  const body = doc.sections.map(s => `${s.kind === 'header' ? '' : `<h2>${inline(s.heading)}</h2>`}${s.blocks.map(blockHtml).join('')}`).join('')
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(plain(title))}</title>
<style>${CSS.replace('var(--doc-title, "")', `"${plain(title).replace(/["\\]/g, '')}"; font: 8pt 'Segoe UI', Arial, sans-serif; color: #444`)}</style></head>
<body><h1>${inline(title)}</h1>${sum}${body}</body></html>`
}
