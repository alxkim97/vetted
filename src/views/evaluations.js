// Evaluations: one list. Five status chips and search up front; project,
// product, type and company behind Filters; view and columns behind View.
// Headers sort (click), filter (funnel) and move (drag); the layout is remembered.
import { state, savePrefs, CHIPS, inToolbar, matches, activeFilters, companies, productGroups, hasProjects } from '../store.js'
import { STATUS, PROJECTS, fmtDate, waitTone, productNames, daysBetween, todayIso } from '../model.js'
import { esc, icon } from '../ui.js'
import { pill, miniLine } from '../parts.js'

const dash = '<span class="nil">—</span>'
const stationIdx = r => r.stations.findIndex(s => s.state === 'now')
const sinceDays = r => r.since?.date ? daysBetween(r.since.date, todayIso()) : null

// id, header, cell, sort value, filter value (null = no funnel), shown by default
export const COLUMNS = [
  { id: 'material', label: 'Material', cell: r => `<div class="mat">${esc(r.materialName)}</div>${r.grade ? `<div class="sub2">${esc(r.grade)}</div>` : ''}`, sort: r => `${r.materialName} ${r.grade || ''}`, filter: r => r.materialName, on: true },
  { id: 'candidate', label: 'Candidate', cell: r => r.candidate ? esc(r.candidate) : '<span class="nil">not set</span>', sort: r => r.candidate || '', filter: r => r.candidate || '(not set)', on: true },
  { id: 'manufacturer', label: 'Manufacturer', cell: r => r.manufacturer || r.supplier ? `${esc(r.manufacturer || '')}${r.supplier && r.supplier !== r.manufacturer ? `<div class="sub2">via ${esc(r.supplier)}</div>` : ''}` : dash, sort: r => r.manufacturer || '', filter: r => r.manufacturer || '(not set)' },
  { id: 'status', label: 'Status', cell: r => pill(r), sort: r => STATUS[r.status].order, filter: r => STATUS[r.status].label, on: true, cls: 'c-center' },
  { id: 'where', label: 'Where it is', cell: r => miniLine(r), sort: stationIdx, filter: r => r.stations[stationIdx(r)]?.label ?? '', on: true },
  { id: 'since', label: 'In status', cell: r => sinceDays(r) != null ? `<span class="days">${sinceDays(r)} d</span>` : dash, sort: r => sinceDays(r) ?? -1, cls: 'c-center' },
  { id: 'waiting', label: 'Waiting', cell: r => r.waitingDays != null ? `<span class="wait w-${waitTone(r.waitingDays)}">${r.waitingDays} d</span>` : dash, sort: r => r.waitingDays ?? -1, on: true, cls: 'c-center' },
  { id: 'with', label: 'With · asked for', cell: r => r.holder.closed || r.status === 'unreadable' ? dash : r.holder.you ? '<span class="muted">You (RD)</span>' : `<span class="clamp2">${esc(r.holder.who)}${r.holder.what?.length ? ` · <span class="muted">${esc(r.holder.what.join('; '))}</span>` : ''}</span>`, sort: r => r.holder.who, filter: r => r.holder.closed ? 'Closed' : r.holder.you ? 'You (RD)' : r.holder.who, on: true },
  { id: 'next', label: 'Next', cell: r => r.nextAction ? `<span class="clamp2" title="${esc(r.nextAction)}">${esc(r.nextAction)}</span>` : r.nextStep ? `<span class="muted clamp2">${esc(r.nextStep)}</span>` : dash, sort: r => r.nextAction || r.nextStep || '', on: true, cls: 'c-next' },
  { id: 'item', label: 'Item code', cell: r => r.itemCode ? `<span class="mono">${esc(r.itemCode)}</span>` : dash, sort: r => r.itemCode || '', filter: r => r.itemCode || '(not set)' },
  { id: 'type', label: 'Type', cell: r => r.kind ? (r.kind === 'api' ? 'API' : 'Excipient') : dash, sort: r => r.kind || '', filter: r => r.kind ? (r.kind === 'api' ? 'API' : 'Excipient') : '(not set)' },
  { id: 'products', label: 'Products', cell: r => productNames(r.products).map(esc).join(', ') || dash, sort: r => productNames(r.products).join(), filter: r => productNames(r.products), cls: 'c-next' },
  { id: 'docsIn', label: 'Docs in', cell: r => r.firstDocs ? `<span class="mono">${fmtDate(r.firstDocs)}</span>` : dash, sort: r => r.firstDocs || '' },
  { id: 'rev', label: 'Rev', cell: r => r.rev != null ? `<span class="mono">R.${r.rev} · ${fmtDate(r.revDate)}</span>` : dash, sort: r => r.revDate || '' },
  { id: 'lastMsg', label: 'Last message', cell: r => r.lastMessage ? `<div class="mono">${fmtDate(r.lastMessage.event_date)}${r.lastMessage.party ? ` · ${esc(r.lastMessage.party)}` : ''}</div><div class="sub2 clip">${esc(r.lastMessage.note || r.lastMessage.what || '')}</div>` : dash, sort: r => r.lastMessage?.event_date || '', cls: 'c-msg' },
]
const byId = Object.fromEntries(COLUMNS.map(c => [c.id, c]))

// Column order and visibility from prefs; columns added in later versions join at the end.
export function columnOrder() {
  const saved = (state.prefs.cols || []).filter(id => byId[id])
  return [...saved, ...COLUMNS.map(c => c.id).filter(id => !saved.includes(id))]
}
// prefs.hidden null = the default set (columns without on: true stay hidden).
const hiddenIds = () => state.prefs.hidden ?? COLUMNS.filter(c => !c.on).map(c => c.id)
const isShown = id => !hiddenIds().includes(id)
export const visibleColumns = () => columnOrder().filter(isShown).map(id => byId[id])
export function setShown(id, on) {
  const hidden = hiddenIds().filter(x => x !== id)
  if (!on) hidden.push(id)
  savePrefs({ hidden })
}

const filterVals = (c, r) => [].concat(c.filter(r))
// Rows behind the status chips: toolbar filters, search and column filters.
function baseRows() {
  const cf = state.prefs.colFilters || {}
  return state.rows.filter(r => inToolbar(r) && matches(r, state.filter.q) &&
    Object.entries(cf).every(([id, vals]) => !vals?.length || !byId[id] || filterVals(byId[id], r).some(v => vals.includes(v))))
}
const inChips = r => !state.filter.chips.length || state.filter.chips.some(k => CHIPS.find(c => c[0] === k)[3].includes(r.status))

export function visibleRows() {
  const rows = baseRows().filter(inChips)
  const s = state.prefs.sort
  const c = s && byId[s.col]
  const cmp = (a, b) => { const x = c.sort(a), y = c.sort(b); return typeof x === 'number' ? x - y : String(x).localeCompare(String(y)) }
  rows.sort(c ? (a, b) => (s.dir === 'desc' ? -cmp(a, b) : cmp(a, b)) : (a, b) => STATUS[a.status].order - STATUS[b.status].order || (b.lastActivity || '').localeCompare(a.lastActivity || ''))
  if (state.prefs.groupBy === 'material') rows.sort((a, b) => a.materialName.localeCompare(b.materialName))
  return rows
}

// Distinct values for one column's filter, counted within the other filters.
export function columnValues(id) {
  const c = byId[id]
  const counts = new Map()
  for (const r of state.rows.filter(r => inToolbar(r) && matches(r, state.filter.q))) for (const v of filterVals(c, r)) counts.set(v, (counts.get(v) || 0) + 1)
  return [...counts].sort((a, b) => String(a[0]).localeCompare(String(b[0])))
}

const FILTER_LABEL = { project: 'Project', product: 'Product', kind: 'Type', company: 'Company' }
const filterValueLabel = (k, v) => k === 'project' ? PROJECTS[v] : k === 'kind' ? { api: 'API', excipient: 'Excipient', unset: 'Not set' }[v] : v

// Filters dropdown: four selects, applied as they change.
export function filtersMenuHtml() {
  const f = state.filter
  const sel = (id, label, opts) => `<label class="menu-field">${label}<span class="select-box"><select id="${id}">${opts}</select></span></label>`
  return `
    <p class="menu-head">Filters</p>
    ${hasProjects() ? sel('f-project', 'Project', [['', 'All projects'], ...Object.entries(PROJECTS)].map(([v, l]) => `<option value="${v}"${f.project === v ? ' selected' : ''}>${l}</option>`).join('')) : ''}
    ${sel('f-product', 'Product', `<option value="">Any product</option>${productGroups().map(([k, names]) => {
      const opts = names.map(x => `<option${f.product === x ? ' selected' : ''}>${esc(x)}</option>`).join('')
      return hasProjects() ? `<optgroup label="${esc(PROJECTS[k] || 'Other')}">${opts}</optgroup>` : opts
    }).join('')}`)}
    ${sel('f-kind', 'Type', [['', 'API and excipient'], ['api', 'API'], ['excipient', 'Excipient'], ['unset', 'Not set']].map(([v, l]) => `<option value="${v}"${f.kind === v ? ' selected' : ''}>${l}</option>`).join(''))}
    ${sel('f-company', 'Manufacturer or supplier', `<option value="">Any company</option>${companies().map(x => `<option${f.company === x ? ' selected' : ''}>${esc(x)}</option>`).join('')}`)}
    <div class="menu-foot"><button class="btn ghost small" data-act="clear-filters">Clear all</button></div>`
}

export function viewMenuItems() {
  const g = state.prefs.groupBy
  return [
    { head: 'Rows' },
    { label: 'Per candidate', act: 'group-by', value: 'candidate', on: g !== 'material' },
    { label: 'By material', act: 'group-by', value: 'material', on: g === 'material', hint: 'Candidates under each material' },
    { sep: true },
    { head: 'Columns' },
    ...columnOrder().map(id => ({ label: byId[id].label, act: 'col-toggle', value: id, on: isShown(id) })),
    { sep: true },
    { label: 'Reset columns and sorting', act: 'col-reset' },
  ]
}

export function colFilterMenuHtml(id) {
  const vals = columnValues(id)
  const on = state.prefs.colFilters?.[id] || []
  return `
    <p class="menu-head">${esc(byId[id].label)}: show only</p>
    <div class="menu-list">${vals.map(([v, n]) => `<button type="button" class="menu-item${on.includes(v) ? ' on' : ''}" data-act="colf" data-id="${id}" data-value="${esc(v)}">
      <span class="menu-check">${on.includes(v) ? icon('check', 14) : ''}</span><span>${esc(v)}</span><b class="menu-n">${n}</b></button>`).join('')}</div>
    ${on.length ? `<div class="menu-foot"><button class="btn ghost small" data-act="colf-clear" data-id="${id}">Show all</button></div>` : ''}`
}

function toolbar() {
  const base = baseRows()
  const f = state.filter
  const pills = [
    ...activeFilters().map(k => `<button class="chip-tag x" data-act="clear-filter" data-value="${k}">${FILTER_LABEL[k]}: ${esc(filterValueLabel(k, f[k]))} ${icon('x', 12)}</button>`),
    ...Object.entries(state.prefs.colFilters || {}).filter(([id, v]) => v?.length && byId[id]).map(([id, v]) => `<button class="chip-tag x" data-act="colf-clear" data-id="${id}">${esc(byId[id].label)}: ${esc(v.join(', '))} ${icon('x', 12)}</button>`),
  ]
  const nFilters = activeFilters().length
  return `
    <div class="toolbar">
      <div class="chips5" role="group" aria-label="Status">
        ${CHIPS.map(([k, label, tone, statuses]) => `<button class="schip t-${tone}${f.chips.includes(k) ? ' on' : ''}" data-act="chip" data-value="${k}" aria-pressed="${f.chips.includes(k)}"><i></i>${label} <b>${base.filter(r => statuses.includes(r.status)).length}</b></button>`).join('')}
      </div>
      <label class="search"><span class="search-ico">${icon('search', 16)}</span><input type="search" id="search-input" placeholder="Search material, candidate, item code" value="${esc(f.q)}" autocomplete="off"><span class="kbd" aria-hidden="true">/</span></label>
      <div class="tb-right">
        <button class="btn surface" data-menu="filters">${icon('filter', 15)} Filters${nFilters ? ` <span class="badge">${nFilters}</span>` : ''} ${icon('chevDown', 14)}</button>
        <button class="btn surface" data-menu="view">${icon('columns', 15)} View ${icon('chevDown', 14)}</button>
        <button class="btn surface" data-menu="export">${icon('download', 15)} Export ${icon('chevDown', 14)}</button>
      </div>
    </div>
    ${pills.length ? `<div class="active-filters"><span>Showing only</span>${pills.join('')}</div>` : ''}`
}

function head(cols) {
  const s = state.prefs.sort
  const cf = state.prefs.colFilters || {}
  return `<thead><tr><th class="rn"></th>${cols.map(c => {
    const sorted = s?.col === c.id
    return `<th class="${c.cls || ''}${sorted ? ' sorted' : ''}${cf[c.id]?.length ? ' filtered' : ''}" draggable="true" data-col="${c.id}">
      <span class="th-in"><button class="th-sort" data-act="sort" data-value="${c.id}" title="Sort by ${esc(c.label)}">${esc(c.label)}${sorted ? icon(s.dir === 'desc' ? 'sortDown' : 'sortUp', 13) : ''}</button>
      ${c.filter ? `<button class="th-filter" data-menu="colf-${c.id}" aria-label="Filter ${esc(c.label)}">${icon('filter', 12)}</button>` : ''}</span></th>`
  }).join('')}</tr></thead>`
}

export function renderEvaluations() {
  const rows = visibleRows()
  const cols = visibleColumns()
  const grouped = state.prefs.groupBy === 'material'
  let body = '', last = null, n = 0
  rows.forEach((r, i) => {
    if (grouped && r.material.id !== last) {
      last = r.material.id
      const mine = rows.filter(x => x.material.id === last)
      const prods = productNames(mine.flatMap(x => x.products))
      body += `<tr class="group"><td colspan="${cols.length + 1}"><b>${esc(r.materialName)}</b><span>${mine.length} candidate${mine.length === 1 ? '' : 's'}${r.kind ? ` · ${r.kind === 'api' ? 'API' : 'Excipient'}` : ''}${prods.length ? ` · used in ${prods.length} product${prods.length === 1 ? '' : 's'}` : ''}</span></td></tr>`
    }
    body += `<tr class="t-${STATUS[r.status].tone}${i === state.sel ? ' sel' : ''}" data-act="evaluation" data-id="${r.id}" data-i="${i}" tabindex="-1">
      <td class="rn">${++n}</td>${cols.map(c => `<td class="${c.cls || ''}">${c.cell(r)}</td>`).join('')}</tr>`
  })
  return `
    ${toolbar()}
    <div class="sheet">
      <table class="grid">
        ${head(cols)}
        <tbody>${rows.length ? body : `<tr><td colspan="${cols.length + 1}" class="empty-row">Nothing matches. Turn off a chip or clear the filters.</td></tr>`}</tbody>
      </table>
    </div>
    <p class="foot-note">${rows.length} of ${state.rows.length} shown${state.prefs.sort ? ` · sorted by ${esc(byId[state.prefs.sort.col]?.label || '')}` : ''}. Hover a status for how long it has been there. Drag a header to move a column; ↑ ↓ to move between rows, Enter to open.</p>`
}

// CSV of exactly what's on screen. UTF-8 BOM so Excel shows Thai correctly.
export function exportCsv() {
  const rows = visibleRows()
  const head = ['Material', 'Grade', 'Candidate', 'Manufacturer', 'Supplier', 'Type', 'Item code', 'Products', 'Status', 'In status since', 'At station', 'Waiting (d)', 'Open requests', 'Next action', 'Notes', 'Docs in', 'Rev', 'Rev date', 'Folder']
  const q = v => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }
  const lines = rows.map(r => [r.materialName, r.grade, r.candidate, r.manufacturer, r.supplier, r.kind, r.itemCode, productNames(r.products).join('; '), STATUS[r.status].label,
    fmtDate(r.since?.date), r.stations[stationIdx(r)]?.label, r.waitingDays, r.openRequests.map(x => (x.topic === 'form' ? '[form] ' : '') + (x.what || '')).join('; '),
    r.nextAction || r.nextStep, r.raw.notes, fmtDate(r.firstDocs), r.rev != null ? `R.${r.rev}` : '', fmtDate(r.revDate), r.folder].map(q).join(','))
  const blob = new Blob(['﻿' + [head.join(','), ...lines].join('\r\n')], { type: 'text/csv;charset=utf-8' })
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `Vetted ${new Date().toISOString().slice(2, 10).replace(/-/g, '')}.csv` })
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}
