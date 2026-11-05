// PDFs from the app: the status list (same table as the RM Evaluation Status
// List .md) and a one-page summary per evaluation. The desktop app saves a PDF
// straight into the RM folder; the web opens the print dialog (Save as PDF).
// Page numbers come from CSS page-margin boxes, so both routes get "Page X of Y".
import { state } from './store.js'
import { STATUS, fmtDate, todayIso, productNames } from './model.js'
import { tally, issuesOf } from '../lib/doc.js'
import { esc, toast } from './ui.js'

const yymmdd = () => todayIso().slice(2).replace(/-/g, '')
const CSS = title => `
  @page { size: A4 landscape; margin: 16mm 12mm 16mm;
    @top-left { content: "${title.replace(/"/g, '')}"; font: 9px Segoe UI, Arial, sans-serif; color: #555; }
    @bottom-right { content: "Page " counter(page) " of " counter(pages); font: 9px Segoe UI, Arial, sans-serif; color: #555; } }
  * { box-sizing: border-box; }
  body { margin: 0; font: 10.5px/1.4 'Segoe UI', 'Leelawadee UI', Tahoma, Arial, sans-serif; color: #111; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  p { margin: 0 0 6px; }
  .muted { color: #555; }
  table { width: 100%; border-collapse: collapse; margin-top: 8px; }
  th, td { border: 1px solid #bbb; padding: 4px 6px; text-align: left; vertical-align: top; }
  thead { display: table-header-group; }
  th { background: #eee; font-weight: 700; }
  tr { break-inside: avoid; }
  .n { text-align: right; width: 22px; color: #555; }
  .st { font-weight: 700; white-space: nowrap; }
  /* Status colours, as in the app: printed as a tinted cell so they survive greyscale too */
  .s-approved { color: #0b6b35; background: #e3f5ea; }
  .s-not_approved, .s-fail { color: #b3261e; background: #fde8e7; }
  .s-missing, .s-untagged { color: #7a5c00; background: #fff3bf; }
  .s-in_progress { color: #1a56c4; background: #e6eefc; }
  .s-closed { color: #111; background: #ececec; }
  .s-awaiting { color: #555; background: #f4f4f4; }
  .legend span { padding: 1px 7px; border-radius: 9px; }
  * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .legend { display: flex; flex-wrap: wrap; gap: 4px 14px; margin: 6px 0; }
  .legend b { margin-right: 3px; }
  .line { display: flex; gap: 0; margin: 10px 0; }
  .line div { flex: 1; border-top: 3px solid #111; padding-top: 4px; }
  .line div.ahead { border-top: 3px dashed #bbb; color: #777; }
  .line div.now { border-top-color: #e0a800; }
  .grid2 { display: grid; grid-template-columns: 1.4fr 1fr; gap: 14px; }
  dl { display: grid; grid-template-columns: 110px 1fr; gap: 3px 8px; margin: 0; }
  dt { color: #555; } dd { margin: 0; }
  .box { border: 1px solid #ccc; border-radius: 6px; padding: 8px 10px; margin-bottom: 8px; }
  .box h2 { font-size: 12px; margin: 0 0 6px; }`

async function output(html, { name, rel }) {
  if (window.electronAPI?.savePdf) {
    try {
      const saved = await window.electronAPI.savePdf({ html, name, rel, root: state.prefs.root || undefined })
      if (saved) toast(`Saved ${saved.split(/[\\/]/).pop()}`)
    } catch (e) { toast(e.message) }
    return
  }
  // Web: print a hidden frame; the browser's dialog offers Save as PDF.
  const f = Object.assign(document.createElement('iframe'), { style: 'position:fixed;right:0;bottom:0;width:0;height:0;border:0' })
  document.body.append(f)
  f.contentDocument.open(); f.contentDocument.write(html); f.contentDocument.close()
  setTimeout(() => { f.contentWindow.focus(); f.contentWindow.print(); setTimeout(() => f.remove(), 1000) }, 300)
}

// What the Note column says when no note was written in the app.
function autoNote(r) {
  const open = r.openRequests.filter(q => q.topic !== 'form')
  if (r.status === 'in_progress' && open.length) return `${open.map(q => q.what).filter(Boolean).join('; ') || 'Documents'} requested through ${open[0].party || 'PU'} ${fmtDate(open[0].event_date)}`
  if (r.stages.outcome) return r.nextAction || ''
  return r.nextAction || r.nextStep || ''
}

export function printStatusList(rows) {
  const list = rows.filter(r => r.status !== 'unreadable').slice()
    .sort((a, b) => a.materialName.localeCompare(b.materialName) || (a.manufacturer || a.candidate || '').localeCompare(b.manufacturer || b.candidate || ''))
  const title = `Raw Material Evaluation Status List (${fmtDate(todayIso())})`
  const counts = Object.entries(STATUS).map(([k, s]) => [k, s.label, list.filter(r => r.status === k).length]).filter(([, , n]) => n)
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>${CSS(title)}</style></head><body>
    <h1>Raw Material Evaluation Status List</h1>
    <p class="muted">APIs and excipients sent by PU for RD evaluation. Generated from Vetted on ${fmtDate(todayIso())}. Sorted A-Z by material.</p>
    <p class="legend">${counts.map(([k, l, n]) => `<span class="s-${k}"><b>${n}</b>${esc(l)}</span>`).join('')}<span><b>${list.length}</b>in total</span></p>
    <p class="muted"><b>Approved</b>: Selection Form approved, or a change control raised to add the source. <b>Not approved</b>: Selection Form not approved, or rejected. <b>Closed</b>: closed without a new approval (source already on the AVL, or a special case). <b>Missing</b>: evaluated; the request for the missing data has not been sent yet. <b>In progress</b>: request sent; waiting for the reply.</p>
    <table><thead><tr><th class="n">#</th><th>Material</th><th>Type</th><th>Item code</th><th>Manufacturer</th><th>Supplier</th><th>Status</th><th>Note</th></tr></thead><tbody>
    ${list.map((r, i) => `<tr><td class="n">${i + 1}</td><td>${esc([r.materialName, r.grade].filter(Boolean).join(' '))}</td><td>${r.kind === 'api' ? 'API' : r.kind === 'excipient' ? 'Excipient' : ''}</td>
      <td>${esc(r.itemCode || 'Not in file')}</td><td>${esc(r.manufacturer || r.candidate || '')}</td><td>${esc(r.supplier || '')}</td>
      <td class="st s-${r.status}">${esc(STATUS[r.status].label)}</td><td>${esc(r.raw.notes || autoNote(r))}</td></tr>`).join('')}
    </tbody></table></body></html>`
  return output(html, { name: 'status-list', rel: '' })
}

export function printEvaluation(r, doc, f = {}) {
  const t = doc ? tally(doc) : null
  const issues = doc ? issuesOf(doc) : []
  const title = `${r.materialName}${r.grade ? ` ${r.grade}` : ''} (${r.candidate || 'candidate'}) Evaluation Summary (${fmtDate(todayIso())})`
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>${CSS(title)}</style></head><body>
    <p class="muted">${esc([r.materialName, r.grade].filter(Boolean).join(' · '))}${r.itemCode ? ` · item ${esc(r.itemCode)}` : ''}</p>
    <h1>${esc(r.materialName)}${r.grade ? ` ${esc(r.grade)}` : ''} · ${esc(STATUS[r.status].label)}</h1>
    <div class="line">${r.stations.map(s => `<div class="${s.state}"><b>${esc(s.label)}</b><br>${esc(s.result || '')}<br><span class="muted">${s.date ? fmtDate(s.date) + (s.est ? '*' : '') : ''}</span></div>`).join('')}</div>
    <div class="grid2"><div>
      ${r.verdictLine ? `<div class="box"><h2>Verdict</h2><p>${esc(r.verdictLine)}</p></div>` : ''}
      ${t ? `<div class="box"><h2>CoA comparison</h2><p>Pass ${t.pass} · Missing ${t.missing} · Confirm ${t.confirm} · Fail ${t.fail} · Documents missing ${t.docsMissing}</p>
        ${issues.length ? `<table><tbody>${issues.slice(0, 14).map(x => `<tr><td class="st">${x.tone}</td><td><b>${esc(x.label)}</b> ${esc(x.text.slice(0, 160))}</td></tr>`).join('')}</tbody></table>` : ''}</div>` : ''}
      <div class="box"><h2>Timeline</h2><table><tbody>${r.events.filter(e => e.kind !== 'stage').slice(-12).reverse().map(e => `<tr><td>${fmtDate(e.event_date)}</td><td>${esc(e.kind.replace('_', ' '))}${e.party ? ` · ${esc(e.party)}` : ''}</td><td>${esc(e.what || e.note || '')}</td></tr>`).join('')}</tbody></table></div>
    </div><div>
      <div class="box"><h2>Facts</h2><dl>
        ${[['Manufacturer', r.manufacturer], ['Supplier', r.supplier], ['Price', f.price ? `฿${f.price}/kg` : null], ['Reference', f.opLine?.slice(0, 160)], ['Used in', productNames(r.products).join(', ')], ['Next', r.nextAction || r.nextStep], ['Notes', r.raw.notes], ['File', r.fileName]].filter(([, v]) => v).map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('')}
      </dl></div>
      ${r.openRequests.length ? `<div class="box"><h2>Open requests</h2>${r.openRequests.map(q => `<p>${esc(q.what || 'Documents')} · ${esc(q.party || 'PU')} · ${fmtDate(q.event_date)} (${q.days} d)</p>`).join('')}</div>` : ''}
    </div></div>
    <p class="muted">* date estimated from older timeline entries. Generated from Vetted on ${fmtDate(todayIso())}.</p>
  </body></html>`
  return output(html.replace('size: A4 landscape', 'size: A4 portrait'), { name: `${r.materialName}${r.candidate ? ` (${r.candidate})` : ''} Evaluation Summary (R.0_${yymmdd()}).pdf`, rel: r.folder })
}
