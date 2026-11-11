import './style.css'
import './register.css'
import './apple.css'
import './evaluation.css'
import './v7.css'
import './tools.css'
import './busy.js'
import { isConfigured } from './config.js'
import { getSession, onAuthChange, isMember, fetchAll, runScan, signOut, fetchDoc, fetchGlossary, fetchShares, createShare, revokeShare, fetchView, fetchViewDoc, purgeFiles } from './data.js'
import { state, savePrefs, setData, cacheData, restoreCache, clearCache, readOnly, rebuild } from './store.js'
import { esc, icon, toast, closeTopModal, modalOpen, openMenu, closeMenu, copyText } from './ui.js'
import { renderAuth, renderNotMember, renderNoTables } from './views/auth.js'
import { renderOverview, overviewSummary, overviewActions } from './views/overview.js'
import { openReply, openHealth } from './views/tools.js'
import { renderEvaluations, visibleRows, exportCsv, filtersMenuHtml, viewMenuItems, colFilterMenuHtml, setShown, columnOrder } from './views/evaluations.js'
import { renderEvaluation, evalAction, evalChange, evalSubmit, evalPaste, evalDrop, stageMenu, handoffMenu, copyPromptFor, hooks as evalHooks, TAB_IDS } from './views/evaluation.js'
import { renderSettings, scanSummary } from './views/settings.js'
import { setReceived, setStage } from './edits.js'
import { undo, redo, hooks as undoHooks, purgeOrphans } from './undo.js'
import { printStatusList } from './print.js'
import { viewLink } from './parts.js'
import { applyTheme, stampMark } from './theme.js'
import { initUpdateReload } from './swUpdate.js'
import { todayIso } from './model.js'

const root = document.getElementById('app')
const isDesktop = !!window.electronAPI?.isElectron

applyTheme(state.prefs.theme)

// ── Address: #/  #/evaluations  #/e/<id8>[/<tab>]  #/settings, and the same
// behind #/v/<token>/ for a manager's view-only link. ──
function parseHash() {
  let parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean)
  let token = null
  if (parts[0] === 'v' && parts[1]) { token = parts[1]; parts = parts.slice(2) }
  return { token, parts }
}
const pre = () => state.viewToken ? `#/v/${state.viewToken}` : '#'
const go = path => { location.hash = `${pre()}${path}` }

// A brief highlight that always clears (with animations off it would otherwise stay).
function flash(el) {
  el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash')
  clearTimeout(el._flashT); el._flashT = setTimeout(() => el.classList.remove('flash'), 1600)
}

// Where each list page was scrolled to when an evaluation was opened from it,
// so the back link lands in the same place.
const scrollMemo = {}

function route() {
  const { parts } = parseHash()
  const [page, id, tab] = parts
  closeMenu()
  const prevView = state.view
  if (page === 'e' && id && prevView !== 'evaluation' && state.lastHash) scrollMemo[state.lastHash] = window.scrollY
  if (page === 'e' && id) {
    const r = state.rows.find(x => x.id.startsWith(id))
    if (prevView !== 'evaluation' && state.lastHash) state.backHash = state.lastHash
    state.view = 'evaluation'
    state.tab = TAB_IDS.includes(tab) ? tab : 'summary'
    if (r && state.evalId !== r.id) { state.evalId = r.id; if (!state.docs[r.id]) loadDoc(r.id) }
    else if (!r) state.evalId = id // resolved after the data loads
  } else {
    state.view = page === 'evaluations' ? 'evaluations' : page === 'settings' && !readOnly() ? 'settings' : 'overview'
    state.lastHash = location.hash || '#/'
  }
  render()
  const back = prevView === 'evaluation' && page !== 'e' ? scrollMemo[location.hash || '#/'] : null
  if (back != null) {
    window.scrollTo(0, back)
    // The row you came from, briefly highlighted.
    const tr = state.evalId && document.querySelector(`tr[data-id="${state.evalId}"]`)
    if (tr) flash(tr)
  } else if (prevView !== state.view || page === 'e') window.scrollTo(0, 0)
}
window.addEventListener('hashchange', route)

// ── Boot ──
async function boot() {
  const { token } = parseHash()
  if (token) return bootView(token)
  if (import.meta.env.MODE === 'demo') { state.member = true; state.shares = [{ token: 'demo-link', created_at: new Date().toISOString() }]; return load() }
  if (!isConfigured()) { root.textContent = 'Supabase is not configured (src/config.js).'; return }
  state.session = await getSession()
  onAuthChange(session => {
    const was = state.session?.user?.id
    state.session = session
    if (session?.user?.id !== was) start()
  })
  start()
}

// A manager's link: everything read-only through api/view, no sign-in.
async function bootView(token) {
  state.viewToken = token
  state.member = true
  document.documentElement.classList.add('view-mode')
  root.innerHTML = `<div class="auth"><div class="auth-card"><div class="brand big"><span class="logo">${stampMark(26)}</span><span>Vetted</span></div><p class="auth-sub">Loading…</p></div></div>`
  try {
    const d = await fetchView(token)
    state.glossary = d.glossary || {}
    setData(d.data)
    state.shares = [{ token }]
    route()
  } catch (e) {
    root.innerHTML = `<div class="auth"><div class="auth-card"><div class="brand big"><span class="logo">${stampMark(26)}</span><span>Vetted</span></div><h2>${e.revoked ? 'Link turned off' : "Can't load"}</h2><p class="auth-sub">${esc(e.message)}</p></div></div>`
  }
}

async function start() {
  if (!state.session) { clearCache(); state.member = null; return renderAuth(root) }
  if (restoreCache()) { state.member = true; route() }
  try {
    state.member = await isMember(state.session.user.id)
  } catch (e) {
    if (!state.loaded) { root.innerHTML = `<div class="auth"><div class="auth-card"><h2>Can't reach Supabase</h2><p class="auth-sub">${esc(e.message)}</p><button class="btn primary" onclick="location.reload()">Retry</button></div></div>`; return }
    return toast('Offline · showing saved data')
  }
  if (!state.member) { clearCache(); return renderNotMember(root, state.session.user) }
  await load()
  loadShares()
  purgeOrphans(new Set((state.data.evidence || []).map(x => x.path)), purgeFiles)
}

async function load() {
  try {
    setData(await fetchAll())
    cacheData()
  } catch (e) {
    // 42P01 = relation does not exist → SETUP.md hasn't been run yet
    if (/42P01|does not exist|schema cache/i.test(`${e.code} ${e.message}`)) return renderNoTables(root, load)
    toast(e.message || 'Could not load')
  }
  route()
}

async function loadShares() {
  if (import.meta.env.MODE === 'demo') return
  try { state.shares = await fetchShares() } catch (e) { state.shares = { error: /rm_shares|42P01|PGRST205/.test(`${e.code} ${e.message}`) ? 'Run the v0.7.0 SQL in supabase/SETUP.md first.' : e.message } }
  render()
}

async function scan() {
  if (state.scanning) return
  state.scanning = true
  render()
  try {
    const r = await runScan(state.prefs.root || undefined, state.prefs.uploadFiles)
    toast(`Scanned ${r.evaluations} evaluations · ${r.events_added} new document folder${r.events_added === 1 ? '' : 's'}${r.uploaded ? ` · ${r.uploaded} file${r.uploaded === 1 ? '' : 's'} uploaded` : ''}`)
    state.scanning = false
    state.docs = {}
    await load()
  } catch (e) {
    state.scanning = false
    toast(e.message || 'Scan failed')
    render()
  }
}

async function loadDoc(id) {
  try {
    if (state.viewToken) {
      const d = await fetchViewDoc(state.viewToken, id)
      state.docs[id] = { body: d?.body ?? null, at: d?.updated_at ?? null }
    } else {
      const [doc, glossary] = await Promise.all([fetchDoc(id), state.glossary ?? fetchGlossary().catch(() => ({}))])
      state.glossary = glossary
      state.docs[id] = { body: doc?.body ?? null, at: doc?.updated_at ?? null }
    }
  } catch (e) {
    const missing = /rm_eval_docs|42P01|PGRST205/.test(`${e.code} ${e.message}`)
    state.docs[id] = { error: missing ? 'The rm_eval_docs table is not set up yet. Run the v0.3.0 SQL block in supabase/SETUP.md, then scan once.' : e.message }
  }
  if (state.view === 'evaluation' && state.evalId === id) render()
}

// ── Rendering ──
const NAV = [['overview', 'Overview', 'sun', ''], ['evaluations', 'Evaluations', 'grid', '/evaluations']]

function scanButton() {
  const run = state.data.lastRun
  const failed = run?.ok === false
  const when = run?.finished_at || run?.started_at
  const text = state.scanning ? 'Scanning…' : failed ? 'Scan failed' : when ? `Scanned ${timeAgo(when)}` : 'Never scanned'
  return isDesktop
    ? `<button class="scan-pill${state.scanning ? ' spinning' : ''}${failed ? ' failed' : ''}" data-act="scan" title="${esc(scanSummary(run))}" ${state.scanning ? 'disabled' : ''}>${icon('sync', 16)}<span>${text}</span></button>`
    : `<span class="scan-pill static${failed ? ' failed' : ''}" title="${esc(scanSummary(run))}">${icon('clock', 16)}<span>${text}</span></span>`
}
function timeAgo(iso) {
  const m = Math.round((Date.now() - new Date(iso)) / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h} h ago`
  return `${Math.round(h / 24)} d ago`
}

function pageHead() {
  if (state.view === 'evaluation' || state.view === 'evaluations') return ''
  if (state.view === 'overview') {
    const d = new Date(todayIso() + 'T00:00:00')
    return `<div class="page-head"><div><h1>${d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}</h1><p>${esc(overviewSummary())}</p></div>${overviewActions()}</div>`
  }
  return `<div class="page-head"><div><h1>Settings</h1></div></div>`
}

function content() {
  switch (state.view) {
    case 'evaluations': return renderEvaluations()
    case 'evaluation': return renderEvaluation()
    case 'settings': return renderSettings()
    default: return renderOverview()
  }
}

function shell() {
  const ro = readOnly()
  const on = state.view === 'evaluation' ? (state.backHash?.includes('evaluations') || !state.backHash ? 'evaluations' : 'overview') : state.view
  return `
    <div class="shell">
      <header class="topnav">
        <a class="brand" href="${pre()}/"><span class="logo">${stampMark(20)}</span><span>Vetted</span></a>
        <nav class="pills" aria-label="Pages">
          ${NAV.map(([v, label, ico, path]) => `<a class="pill${on === v ? ' on' : ''}" href="${pre()}${path || '/'}">${icon(ico, 17)}<span>${label}</span>${v === 'evaluations' ? `<b class="pill-n">${state.rows.length}</b>` : ''}</a>`).join('')}
        </nav>
        <div class="topnav-right">
          ${ro ? `<button type="button" class="round-btn" data-act="theme-cycle" aria-label="Theme: ${state.prefs.theme}. Click to change" title="Theme: ${state.prefs.theme}. Click to change">${icon(state.prefs.theme === 'dark' ? 'moon' : 'sun', 18)}</button><span class="view-only">${icon('eye', 14)} View only</span>` : `${scanButton()}
          <a class="round-btn${state.view === 'settings' ? ' on' : ''}" href="#/settings" aria-label="Settings" title="Settings">${icon('settings', 18)}</a>`}
        </div>
      </header>
      <main class="main">
        ${pageHead()}
        <div class="content view-${state.view}">${content()}</div>
        <p class="version">v${__APP_VERSION__} · Alex Kim${import.meta.env.MODE === 'demo' ? ' · demo data' : ''}${ro ? ' · view only' : ''}</p>
      </main>
    </div>`
}

function render() {
  if (!state.member) return
  // An #/e/<id8> opened before the data arrived
  if (state.view === 'evaluation' && state.evalId && !state.rows.some(x => x.id === state.evalId)) {
    const r = state.rows.find(x => x.id.startsWith(state.evalId))
    if (r) { state.evalId = r.id; if (!state.docs[r.id]) loadDoc(r.id) }
  }
  const active = document.activeElement
  const searchFocused = active?.id === 'search-input'
  const caret = searchFocused ? active.selectionStart : null
  const y = window.scrollY
  root.innerHTML = shell()
  window.scrollTo(0, y)
  if (searchFocused) { const inp = root.querySelector('#search-input'); if (inp) { inp.focus(); inp.setSelectionRange(caret, caret) } }
}
evalHooks.render = render
undoHooks.changed = () => { rebuild(); cacheData(); render() }

// Scroll to a row or note; open its folded section first (switching to Comparison if needed).
function jumpTo(elId) {
  const find = () => root.querySelector(`#${CSS.escape(elId)}`)
  if (!find() && state.tab !== 'comparison') { go(`/e/${state.evalId.slice(0, 8)}/comparison`); return setTimeout(() => jumpTo(elId), 60) }
  const el = find()
  if (!el) return
  const sec = el.closest('details')
  if (sec && !sec.open) sec.open = true
  el.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
  flash(el)
}

root.addEventListener('toggle', e => {
  if (e.target.matches?.('.fe-sec')) state.secOpen.set(`${state.evalId}:${e.target.dataset.sec}`, e.target.open)
}, true)

// Re-open a dropdown after its contents changed (column toggles, filters).
const reopen = (sel, fn) => { closeMenu(); const a = document.querySelector(`[data-menu="${sel}"]`); if (a) fn(a) }
const openFilters = a => openMenu(a, [], { html: filtersMenuHtml(), align: 'right' })
const openView = a => openMenu(a, viewMenuItems(), { align: 'right' })
const openColf = id => a => openMenu(a, [], { html: colFilterMenuHtml(id) })

function menuFor(el) {
  const m = el.dataset.menu
  if (m === 'filters') return openFilters(el)
  if (m === 'view') return openView(el)
  if (m === 'export') return openMenu(el, [{ label: 'Status list PDF', act: 'print-list', hint: 'Same table as the RM Evaluation Status List' }, { label: 'CSV for Excel', act: 'export', hint: 'The rows on screen, every column' }], { align: 'right' })
  if (m === 'handoff') return handoffMenu(el)
  if (m.startsWith('colf-')) return openColf(m.slice(5))(el)
  if (m.startsWith('stage-')) return stageMenu(el, m.slice(6))
}

// ── Clicks (document-wide: dropdown menus live outside #app) ──
document.addEventListener('click', async e => {
  const menuBtn = e.target.closest('[data-menu]')
  if (menuBtn) { e.preventDefault(); return menuFor(menuBtn) }
  const el = e.target.closest('[data-act]')
  if (!el) return
  const { act, id, value } = el.dataset
  try {
    if (state.view === 'evaluation' && await evalAction(act, el)) return
    switch (act) {
      case 'evaluation': return go(`/e/${id.slice(0, 8)}`)
      case 'go-pu': state.openPu = true; return go(`/e/${id.slice(0, 8)}`)
      case 'reply-pu': if (!readOnly()) openReply(); return
      case 'health-all': if (!readOnly()) openHealth(); return
      case 'copy-prompt': {
        const r = state.rows.find(x => x.id === id)
        if (!state.docs[id]) await loadDoc(id)
        return copyPromptFor(r)
      }
      case 'chip': {
        const c = state.filter.chips
        state.filter.chips = c.includes(value) ? c.filter(x => x !== value) : [...c, value]
        state.sel = -1
        return render()
      }
      case 'chip-only': state.filter.chips = [value]; return go('/evaluations')
      case 'clear-filter': state.filter[value] = ''; return render()
      case 'clear-filters': Object.assign(state.filter, { project: '', product: '', kind: '', company: '' }); closeMenu(); return render()
      case 'group-by': savePrefs({ groupBy: value }); closeMenu(); return render()
      case 'col-toggle': setShown(value, !el.classList.contains('on')); render(); return reopen('view', openView)
      case 'col-reset': savePrefs({ cols: null, hidden: null, sort: null, colFilters: {}, groupBy: 'candidate' }); closeMenu(); return render()
      case 'sort': {
        const s = state.prefs.sort
        savePrefs({ sort: s?.col !== value ? { col: value, dir: 'asc' } : s.dir === 'asc' ? { col: value, dir: 'desc' } : null })
        return render()
      }
      case 'colf': {
        const cf = { ...(state.prefs.colFilters || {}) }
        const list = cf[id] || []
        cf[id] = list.includes(value) ? list.filter(x => x !== value) : [...list, value]
        savePrefs({ colFilters: cf }); render(); return reopen(`colf-${id}`, openColf(id))
      }
      case 'colf-clear': { const cf = { ...(state.prefs.colFilters || {}) }; delete cf[id]; savePrefs({ colFilters: cf }); closeMenu(); return render() }
      case 'received': e.stopPropagation(); return await setReceived(id, true)
      case 'to-project': Object.assign(state.filter, { project: value, product: '', chips: [], q: '' }); return go('/evaluations')
      case 'not-eval': state.showNotEval = state.showNotEval === value ? false : value; return render()
      case 'day': state.homeDay = state.homeDay === value ? null : value; return render()
      case 'jump': return jumpTo(value)
      case 'note': return jumpTo(`note-${value}`)
      case 'issues-only': savePrefs({ issuesOnly: value === '1' }); return render()
      case 'print-list': closeMenu(); return printStatusList(visibleRows())
      case 'export': closeMenu(); return exportCsv()
      case 'scan': return scan()
      case 'theme': savePrefs({ theme: value }); applyTheme(value); return render()
      case 'theme-cycle': { const next = { system: 'light', light: 'dark', dark: 'system' }[state.prefs.theme] || 'light'; savePrefs({ theme: next }); applyTheme(next); return render() }
      case 'share-create': state.shares = [await createShare()]; return render()
      case 'share-copy': return copyText(viewLink(), 'View link copied')
      case 'avl-set': {
        const r = state.rows.find(x => x.id === id)
        if (r) await setStage(r, 'avl', value === 'true', `AVL ${value === 'true' ? 'Listed' : 'Not listed'}`)
        return
      }
      case 'share-revoke': {
        await revokeShare(value)
        state.shares = [await createShare()]
        toast('Old link turned off · new link made')
        return render()
      }
      case 'update': return window.electronAPI?.checkForUpdates()
      case 'signout': await signOut(); return
    }
  } catch (err) { toast(err.message || String(err)) }
})

document.addEventListener('change', async e => {
  const t = e.target
  if (t.id === 'f-project') { state.filter.project = t.value; if (t.value && state.filter.product && state.projectOf[state.filter.product] !== t.value) state.filter.product = ''; render(); return reopen('filters', openFilters) }
  if (t.id === 'f-product') { state.filter.product = t.value; render(); return reopen('filters', openFilters) }
  if (t.id === 'f-kind') { state.filter.kind = t.value; render(); return reopen('filters', openFilters) }
  if (t.id === 'f-company') { state.filter.company = t.value; render(); return reopen('filters', openFilters) }
  if (t.id === 'turn') { savePrefs({ turn: t.value }); return render() }
  if (t.id === 'root') return savePrefs({ root: t.value.trim() })
  if (t.id === 'upload-files') return savePrefs({ uploadFiles: t.checked })
  return evalChange(e)
})
document.addEventListener('submit', e => { if (e.target.closest('#app [data-form]')) evalSubmit(e) })
document.addEventListener('paste', e => { if (!e.target.closest('input, textarea') || e.clipboardData?.files?.length) evalPaste(e) })
document.addEventListener('dragover', e => { if (e.target.closest('.add-event, th[data-col]')) e.preventDefault() })

// Column drag: drop a header on another to move it there.
let dragCol = null
document.addEventListener('dragstart', e => { const th = e.target.closest?.('th[data-col]'); if (th) { dragCol = th.dataset.col; th.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move' } })
document.addEventListener('dragend', () => { dragCol = null; document.querySelectorAll('th.dragging, th.drop-on').forEach(x => x.classList.remove('dragging', 'drop-on')) })
document.addEventListener('dragenter', e => { const th = e.target.closest?.('th[data-col]'); document.querySelectorAll('th.drop-on').forEach(x => x !== th && x.classList.remove('drop-on')); if (th && dragCol && th.dataset.col !== dragCol) th.classList.add('drop-on') })
document.addEventListener('drop', e => {
  if (evalDrop(e)) return
  const th = e.target.closest?.('th[data-col]')
  if (!th || !dragCol || th.dataset.col === dragCol) return
  e.preventDefault()
  const order = columnOrder().filter(x => x !== dragCol)
  order.splice(order.indexOf(th.dataset.col), 0, dragCol)
  savePrefs({ cols: order })
  dragCol = null
  render()
})

let searchTimer
document.addEventListener('input', e => {
  if (e.target.id !== 'search-input') return
  state.filter.q = e.target.value
  state.sel = -1
  clearTimeout(searchTimer)
  searchTimer = setTimeout(render, 120)
})

// ── Keyboard ──
document.addEventListener('keydown', e => {
  const typing = e.target.closest?.('input, textarea, select, [contenteditable]')
  if (e.key === 'Escape') {
    if (closeMenu() || closeTopModal()) return
    if (typing && e.target.id === 'search-input' && state.filter.q) { state.filter.q = ''; return render() }
    if (typing) return e.target.blur()
    if (state.view === 'evaluation') { location.hash = state.backHash || `${pre()}/evaluations`; return }
    return
  }
  if (!state.member || modalOpen()) return
  // Undo / redo everything done in the app (text boxes keep their own undo).
  if ((e.ctrlKey || e.metaKey) && !typing && !readOnly()) {
    const k = e.key.toLowerCase()
    if (k === 'z' && !e.shiftKey) { e.preventDefault(); return undo() }
    if ((k === 'z' && e.shiftKey) || k === 'y') { e.preventDefault(); return redo() }
  }
  if (typing || e.ctrlKey || e.metaKey || e.altKey) return
  if (e.key === '/') { e.preventDefault(); if (state.view !== 'evaluations') go('/evaluations'); return setTimeout(() => document.querySelector('#search-input')?.focus(), 30) }
  if (e.key === '1') return go('/')
  if (e.key === '2') return go('/evaluations')
  if (state.view === 'evaluations' && ['ArrowDown', 'ArrowUp', 'Enter'].includes(e.key)) {
    const rows = visibleRows()
    if (!rows.length) return
    e.preventDefault()
    if (e.key === 'Enter') { const r = rows[state.sel]; if (r) go(`/e/${r.id.slice(0, 8)}`); return }
    state.sel = Math.max(0, Math.min(rows.length - 1, state.sel + (e.key === 'ArrowDown' ? 1 : -1)))
    render()
    document.querySelector(`tr[data-i="${state.sel}"]`)?.scrollIntoView({ block: 'nearest' })
  }
})

// Coming back to the window refreshes from Supabase (a chat may have logged something).
let lastFocusLoad = Date.now()
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible' || !state.member || readOnly() || Date.now() - lastFocusLoad < 60_000) return
  lastFocusLoad = Date.now()
  load()
})

initUpdateReload({ isBusy: modalOpen })
boot()
