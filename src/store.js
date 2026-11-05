import { buildRows, parseProduct, PROJECTS } from './model.js'

const PREFS_KEY = 'vt_prefs'
const CACHE_KEY = 'vt_cache'
const load = (k, d) => { try { return { ...d, ...JSON.parse(localStorage.getItem(k) || '{}') } } catch { return d } }

export const state = {
  session: null,
  member: null,
  loaded: false,
  scanning: false,
  // overview | evaluations | evaluation | settings, from the address (#/…)
  view: 'overview',
  tab: 'summary',
  homeDay: null,
  data: { materials: [], evaluations: [], events: [], lastRun: null },
  rows: [],
  prefs: load(PREFS_KEY, {
    theme: 'system', root: '', issuesOnly: false,
    // Evaluations table: column order, hidden columns, sort, per-column filters
    cols: null, hidden: null, sort: null, colFilters: {}, groupBy: 'candidate',
    turn: 'verdict', uploadFiles: true,
  }),
  // Status chips (none on = every row) and the filters behind the Filters button.
  filter: { chips: [], q: '', project: '', product: '', kind: '', company: '' },
  projectOf: {}, // product name → rm_products.project
  sel: -1,       // keyboard-selected row on Evaluations
  showNotEval: false,
  // Evaluation page: which one, loaded comparison files by evaluation id,
  // the Thai → English glossary, sections opened or closed by hand.
  evalId: null,
  docs: {},
  glossary: null,
  secOpen: new Map(),
  // View-only share link: the token from #/v/<token>/…, no editing anywhere.
  viewToken: null,
  shares: null,
}
export const readOnly = () => !!state.viewToken

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
export const rebuild = () => { state.rows = buildRows(state.data) }

export function cacheData() { if (readOnly()) return; try { localStorage.setItem(CACHE_KEY, JSON.stringify(state.data)) } catch {} }
export function restoreCache() {
  try { const d = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null'); if (d?.evaluations) { setData(d); return true } } catch {}
  return false
}
export const clearCache = () => { try { localStorage.removeItem(CACHE_KEY) } catch {} }

// The five status chips use the RM Evaluation Status List's words. Missing
// gathers everything that is Alex's move (Fail and "No file yet" too); the
// row's own pill still says which.
export const CHIPS = [
  ['missing', 'Missing', 'amber', ['missing', 'fail', 'awaiting', 'untagged']],
  ['in_progress', 'In progress', 'blue', ['in_progress']],
  ['approved', 'Approved', 'green', ['approved']],
  ['not_approved', 'Not approved', 'red', ['not_approved']],
  ['closed', 'Closed', 'ink', ['closed']],
]
export const YOUR_MOVE = CHIPS[0][3]
export const CLOSED = ['approved', 'not_approved', 'closed']

// Project, product, type and company: the filters behind the Filters button.
export function inToolbar(r) {
  const { kind, company, product, project } = state.filter
  return (!kind || r.kind === kind || (kind === 'unset' && !r.kind)) &&
    (!company || r.manufacturer === company || r.supplier === company) &&
    inProject(r.products.map(p => p.name), project) &&
    (!product || r.products.some(p => p.name === product))
}
export const activeFilters = () => ['project', 'product', 'kind', 'company'].filter(k => state.filter[k])

export const matches = (r, q) => {
  const needle = q.trim().toLowerCase()
  return !needle || [r.materialName, r.grade, r.candidate, r.manufacturer, r.supplier, r.itemCode, r.fileName, ...r.products.map(p => p.name)]
    .some(v => String(v ?? '').toLowerCase().includes(needle))
}

export const companies = () => [...new Set(state.rows.flatMap(r => [r.manufacturer, r.supplier]).filter(Boolean))].sort()
export const products = () => [...new Set(state.data.materials.flatMap(m => (m.products || []).map(s => parseProduct(s).name)))].sort()
// Products by project for the dropdown, limited to the picked project; ungrouped last.
export function productGroups() {
  const { project } = state.filter
  const groups = [...Object.keys(PROJECTS), ''].map(k => [k, products().filter(n => (state.projectOf[n] || '') === k)])
  return groups.filter(([k, names]) => names.length && (!project || k === project))
}
export const hasProjects = () => (state.data.products || []).length > 0
