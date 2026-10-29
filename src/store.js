import { buildRows, STATUS } from './model.js'

const PREFS_KEY = 'vt_prefs'
const CACHE_KEY = 'vt_cache'
const load = (k, d) => { try { return { ...d, ...JSON.parse(localStorage.getItem(k) || '{}') } } catch { return d } }

export const state = {
  session: null,
  member: null,
  loaded: false,
  scanning: false,
  view: 'home',
  homeDay: null,
  data: { materials: [], evaluations: [], events: [], lastRun: null },
  rows: [],
  prefs: load(PREFS_KEY, { theme: 'system', root: '', sort: 'activity', showOld: false, moreCols: false }),
  filter: { group: 'all', sub: null, kind: 'all', company: '', q: '' },
}

export function savePrefs(patch) {
  Object.assign(state.prefs, patch)
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(state.prefs)) } catch {}
}

export function setData(data) {
  state.data = data
  state.rows = buildRows(data)
  state.loaded = true
}
export const rebuild = () => { state.rows = buildRows(state.data) }

export function cacheData() { try { localStorage.setItem(CACHE_KEY, JSON.stringify(state.data)) } catch {} }
export function restoreCache() {
  try { const d = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null'); if (d?.evaluations) { setData(d); return true } } catch {}
  return false
}
export const clearCache = () => { try { localStorage.removeItem(CACHE_KEY) } catch {} }

// Status groups behind the four tiles. "Old" = verdict only in a count table.
export const GROUPS = {
  action: ['fail', 'gap', 'awaiting', 'untagged'],
  pass: ['pass'],
  closed: ['closed_ok', 'closed_no'],
}
const isClosed = r => GROUPS.closed.includes(r.status)
// Closed and old-format rows stay out of the way unless asked for.
export const inBase = r => state.prefs.showOld || (!isClosed(r) && r.status !== 'unreadable')

export function groupOf(r, group) {
  if (group === 'closed') return isClosed(r)
  if (!inBase(r)) return false
  return group === 'all' || GROUPS[group].includes(r.status)
}

// Rows after the tiles and toolbar filters (API/excipient, company, search).
export function filteredRows() {
  const { group, sub, kind, company, q } = state.filter
  const needle = q.trim().toLowerCase()
  const rows = state.rows.filter(r =>
    (needle ? true : groupOf(r, group)) &&
    (!sub || r.status === sub) &&
    (kind === 'all' || r.kind === kind || (kind === 'unset' && !r.kind)) &&
    (!company || r.manufacturer === company || r.supplier === company) &&
    (!needle || [r.materialName, r.grade, r.candidate, r.manufacturer, r.supplier, r.itemCode, r.fileName].some(v => String(v ?? '').toLowerCase().includes(needle))))
  return sortRows(rows)
}

export function sortRows(rows) {
  const by = state.prefs.sort
  const c = rows.slice()
  if (by === 'material') c.sort((a, b) => (a.materialName + (a.grade || '') + (a.candidate || '')).localeCompare(b.materialName + (b.grade || '') + (b.candidate || '')))
  else if (by === 'status') c.sort((a, b) => STATUS[a.status].order - STATUS[b.status].order || (b.lastActivity || '').localeCompare(a.lastActivity || ''))
  else if (by === 'waiting') c.sort((a, b) => (b.waitingDays ?? -1) - (a.waitingDays ?? -1) || (b.ageDays ?? -1) - (a.ageDays ?? -1))
  else c.sort((a, b) => (b.lastActivity || '').localeCompare(a.lastActivity || ''))
  return c
}

export const companies = () => [...new Set(state.rows.flatMap(r => [r.manufacturer, r.supplier]).filter(Boolean))].sort()
