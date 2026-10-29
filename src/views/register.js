// The main grid: one row per candidate evaluation, spreadsheet-style.
// Six columns by default; "More columns" brings back the rest.
import { state, filteredRows, companies, productGroups, hasProjects, groupOf, inToolbar, GROUPS } from '../store.js'
import { STATUS, PROJECTS, fmtDate, waitTone, productNames } from '../model.js'
import { esc, icon } from '../ui.js'

export const pill = s => `<span class="stamp t-${STATUS[s].tone}">${esc(STATUS[s].label)}</span>`

// Lower the Cost / Added later / … — shared by Register and Materials.
export const projectSeg = () => hasProjects() ? `
  <div class="seg small" role="group" aria-label="Project">
    ${[['', 'All products'], ...Object.entries(PROJECTS)].map(([v, l]) => `<button type="button" class="${state.filter.project === v ? 'on' : ''}" data-act="project" data-value="${v}">${l}</button>`).join('')}
  </div>` : ''
const dash = '<span class="nil">—</span>'
const days = d => d == null ? dash : `<span class="num">${d}</span><span class="unit">d</span>`

const TILES = [
  ['action', 'Needs action', 'amber'],
  ['pass', 'Pass', 'green'],
  ['closed', 'Closed', 'slate'],
  ['all', 'All open', ''],
]

function toolbar() {
  const f = state.filter
  const base = state.rows.filter(inToolbar)
  const count = g => base.filter(r => groupOf(r, g)).length
  const subs = f.group === 'action' ? GROUPS.action.map(s => [s, base.filter(r => groupOf(r, 'action') && r.status === s).length]).filter(([, n]) => n) : []
  return `
    <section class="tally" aria-label="Filter by status">
      ${TILES.map(([g, label, tone]) => `
        <button class="tally-item${tone ? ` t-${tone}` : ' all'}${f.group === g ? ' on' : ''}" data-act="group" data-value="${g}">
          <b>${count(g)}</b><span>${g === 'all' && state.prefs.showOld ? 'All' : label}</span></button>`).join('')}
    </section>
    ${subs.length ? `<div class="subs">${subs.map(([s, n]) => `<button class="sub-chip${f.sub === s ? ' on' : ''}" data-act="sub" data-value="${s}">${esc(STATUS[s].label)} <b>${n}</b></button>`).join('')}</div>` : ''}
    <div class="filters">
      ${projectSeg()}
      <div class="seg small" role="group" aria-label="API or excipient">
        ${[['all', 'All'], ['api', 'API'], ['excipient', 'Excipient']].map(([v, l]) => `<button type="button" class="${f.kind === v ? 'on' : ''}" data-act="kind" data-value="${v}">${l}</button>`).join('')}
      </div>
      <label class="select-box">
        <select id="company" aria-label="Manufacturer or supplier">
          <option value="">Any manufacturer / supplier</option>
          ${companies().map(x => `<option${f.company === x ? ' selected' : ''}>${esc(x)}</option>`).join('')}
        </select></label>
      <label class="select-box${f.product ? ' on' : ''}">${icon('box', 15)}
        <select id="product" aria-label="Product">
          <option value="">Any product</option>
          ${productGroups().map(([k, names]) => {
            const opts = names.map(x => `<option${f.product === x ? ' selected' : ''}>${esc(x)}</option>`).join('')
            return hasProjects() ? `<optgroup label="${esc(PROJECTS[k] || 'Other')}">${opts}</optgroup>` : opts
          }).join('')}
        </select></label>
      <label class="toggle"><input type="checkbox" id="show-old" ${state.prefs.showOld ? 'checked' : ''}> Show closed &amp; old</label>
      <label class="toggle"><input type="checkbox" id="more-cols" ${state.prefs.moreCols ? 'checked' : ''}> More columns</label>
      <div class="filters-right">
        <label class="select-box">
          <select id="sort" aria-label="Sort">
            ${[['activity', 'Latest first'], ['waiting', 'Longest waiting'], ['status', 'By status'], ['material', 'Material A–Z']].map(([v, l]) => `<option value="${v}"${state.prefs.sort === v ? ' selected' : ''}>${l}</option>`).join('')}
          </select></label>
        <button class="icon-btn" data-act="export" title="Export these rows to CSV (opens in Excel)" aria-label="Export CSV">${icon('download', 18)}</button>
      </div>
    </div>`
}

// [header, cell renderer, class, only with "More columns"]
const COLUMNS = [
  ['Material', r => `<div class="mat">${esc(r.materialName)}</div>${r.grade ? `<div class="sub2">${esc(r.grade)}</div>` : ''}`, 'c-mat'],
  ['Candidate', r => r.candidate ? esc(r.candidate) : '<span class="nil">not set</span>'],
  ['Manufacturer', r => r.manufacturer || r.supplier ? `${esc(r.manufacturer || '')}${r.supplier && r.supplier !== r.manufacturer ? `<div class="sub2">via ${esc(r.supplier)}</div>` : ''}` : dash, '', true],
  ['AVL', r => r.avl == null ? dash : r.avl ? '<span class="avl yes">AVL</span>' : '<span class="avl no">New</span>', 'c-avl', true],
  ['Stamp', r => pill(r.status)],
  ['Docs in', r => r.firstDocs ? fmtDate(r.firstDocs) : dash, 'mono', true],
  ['To verdict', r => days(r.daysToVerdict), 'c-num', true],
  ['Open for', r => days(r.ageDays), 'c-num'],
  ['Waiting on docs', r => r.waitingDays != null ? `<span class="wait w-${waitTone(r.waitingDays)}">${r.waitingDays} d${r.openRequests.length > 1 ? ` · ${r.openRequests.length} asks` : ''}</span>` : dash],
  ['Last message', r => r.lastMessage ? `<div class="mono">${fmtDate(r.lastMessage.event_date)}${r.lastMessage.party ? ` · ${esc(r.lastMessage.party)}` : ''}</div><div class="sub2 clip">${esc(r.lastMessage.note || r.lastMessage.what || '')}</div>` : dash, 'c-msg', true],
  ['Rev', r => r.rev != null ? `R.${r.rev} <span class="nil">·</span> ${fmtDate(r.revDate)}` : dash, 'mono', true],
  ['Next action', r => r.nextAction ? esc(r.nextAction) : dash, 'c-next'],
]

export function renderRegister() {
  const rows = filteredRows()
  const cols = COLUMNS.filter(c => !c[3] || state.prefs.moreCols)
  return `
    ${toolbar()}
    <div class="sheet${state.prefs.moreCols ? ' wide' : ''}">
      <table class="grid">
        <thead><tr><th class="rn"></th>${cols.map(([h, , cls]) => `<th class="${cls || ''}">${h}</th>`).join('')}</tr></thead>
        <tbody>
          ${rows.length ? rows.map((r, i) => `
            <tr class="t-${STATUS[r.status].tone}" data-act="open" data-id="${r.id}" tabindex="0">
              <td class="rn">${i + 1}</td>${cols.map(([, cell, cls]) => `<td class="${cls || ''}">${cell(r)}</td>`).join('')}
            </tr>`).join('') : `<tr><td colspan="${cols.length + 1}" class="empty-row">Nothing here. ${state.prefs.showOld ? 'Clear the search or pick another tile.' : 'Tick “Show closed & old” to include those.'}</td></tr>`}
        </tbody>
      </table>
    </div>`
}

// CSV of exactly what's on screen, every column. UTF-8 BOM so Excel shows Thai correctly.
export function exportCsv() {
  const rows = filteredRows()
  const head = ['Material', 'Grade', 'Candidate', 'Manufacturer', 'Supplier', 'AVL', 'Kind', 'Item code', 'Products', 'Stamp', 'Verdict line', 'Docs in', 'Days to verdict', 'Open for (d)', 'Waiting (d)', 'Open requests', 'Last message', 'Rev', 'Rev date', 'Next action', 'Folder']
  const q = v => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }
  const lines = rows.map(r => [r.materialName, r.grade, r.candidate, r.manufacturer, r.supplier, r.avl == null ? '' : r.avl ? 'Yes' : 'No', r.kind, r.itemCode, productNames(r.products).join('; '), STATUS[r.status].label, r.verdictLine,
    fmtDate(r.firstDocs), r.daysToVerdict, r.ageDays, r.waitingDays, r.openRequests.map(x => x.what).join('; '),
    r.lastMessage ? `${fmtDate(r.lastMessage.event_date)} ${r.lastMessage.party || ''}: ${r.lastMessage.note || r.lastMessage.what || ''}` : '', r.rev != null ? `R.${r.rev}` : '', fmtDate(r.revDate), r.nextAction, r.folder].map(q).join(','))
  const blob = new Blob(['﻿' + [head.join(','), ...lines].join('\r\n')], { type: 'text/csv;charset=utf-8' })
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `Vetted ${new Date().toISOString().slice(2, 10).replace(/-/g, '')}.csv` })
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}
