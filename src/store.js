import { buildRows, STATUS, parseProduct, PROJECTS } from './model.js'

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
  prefs: load(PREFS_KEY, { theme: 'system', root: '', sort: 'activity', showOld: false, moreCols: false, issuesOnly: false }),
  filter: { group: 'all', sub: null, kind: 'all', company: '', product: '', project: '', q: '' },
  projectOf: {}, // product name → rm_products.project
  // Full evaluation page: which one, where Back goes, loaded files by
  // evaluation id, the Thai → English glossary, sections opened or closed by hand.
  evalId: null,
  backView: 'register',
  docs: {},
  glossary: null,
  secOpen: new Map(),
}

export function savePrefs(patch) {
  Object.assign(state.prefs, patch)
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(state.prefs)) } catch {}
}

export function setData(data) {
  state.data = data
  state.rows = buildRows(data)
  state.projectOf = Object.fromEntries((data.products || []).map(p => [p.name, p.project]))
  state.loaded = true
}
const inProject = (names, project) => !project || names.some(n => state.projectOf[n] === project)
export const materialInProject = m => inProject((m.products || []).map(s => parseProduct(s).name), state.filter.project)
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

// Toolbar filters (API/excipient, company, project, product). The tiles count within these too.
export function inToolbar(r) {
  const { kind, company, product, project } = state.filter
  return (kind === 'all' || r.kind === kind || (kind === 'unset' && !r.kind)) &&
    (!company || r.manufacturer === company || r.supplier === company) &&
    inProject(r.products.map(p => p.name), project) &&
    (!product || r.products.some(p => p.name === product))
}

// Rows after the tiles, toolbar filters and search.
export function filteredRows() {
  const { group, sub, q } = state.filter
  const needle = q.trim().toLowerCase()
  const rows = state.rows.filter(r =>
    (needle ? true : groupOf(r, group)) &&
    (!sub || r.status === sub) &&
    inToolbar(r) &&
    (!needle || [r.materialName, r.grade, r.candidate, r.manufacturer, r.supplier, r.itemCode, r.fileName, ...r.products.map(p => p.name)].some(v => String(v ?? '').toLowerCase().includes(needle))))
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
export const products = () => [...new Set(state.data.materials.flatMap(m => (m.products || []).map(s => parseProduct(s).name)))].sort()
// Products by project for the dropdown, limited to the picked project; ungrouped last.
export function productGroups() {
  const { project } = state.filter
  const groups = [...Object.keys(PROJECTS), ''].map(k => [k, products().filter(n => (state.projectOf[n] || '') === k)])
  return groups.filter(([k, names]) => names.length && (!project || k === project))
}
// The project segmented control only shows once rm_products has rows.
export const hasProjects = () => (state.data.products || []).length > 0
