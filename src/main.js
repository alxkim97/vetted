import './style.css'
import './register.css'
import './apple.css'
import './evaluation.css'
import { isConfigured } from './config.js'
import { getSession, onAuthChange, isMember, fetchAll, runScan, signOut, updateEvent, fetchDoc, fetchGlossary } from './data.js'
import { state, savePrefs, setData, cacheData, restoreCache, clearCache } from './store.js'
import { esc, icon, toast, closeTopModal, modalOpen } from './ui.js'
import { renderAuth, renderNotMember, renderNoTables } from './views/auth.js'
import { renderRegister, exportCsv } from './views/register.js'
import { renderMaterials } from './views/materials.js'
import { renderWaiting, waitingCount } from './views/waiting.js'
import { renderSettings, scanSummary } from './views/settings.js'
import { renderHome, homeSummary } from './views/home.js'
import { openDetail, hooks } from './detail.js'
import { renderEvaluation } from './views/evaluation.js'
import { applyTheme, stampMark } from './theme.js'
import { initUpdateReload } from './swUpdate.js'
import { todayIso } from './model.js'

const root = document.getElementById('app')
const isDesktop = !!window.electronAPI?.isElectron

applyTheme(state.prefs.theme)

// ── Boot / auth ──────────────────────────────────────────────────────────
async function boot() {
  if (import.meta.env.MODE === 'demo') { state.member = true; return load() }
  if (!isConfigured()) { root.textContent = 'Supabase is not configured (src/config.js).'; return }
  state.session = await getSession()
  onAuthChange(session => {
    const was = state.session?.user?.id
    state.session = session
    if (session?.user?.id !== was) start()
  })
  start()
}

async function start() {
  if (!state.session) { clearCache(); state.member = null; return renderAuth(root) }
  if (restoreCache()) { state.member = true; render() }
  try {
    state.member = await isMember(state.session.user.id)
  } catch (e) {
    if (!state.loaded) { root.innerHTML = `<div class="auth"><div class="auth-card"><h2>Can't reach Supabase</h2><p class="auth-sub">${esc(e.message)}</p><button class="btn primary" onclick="location.reload()">Retry</button></div></div>`; return }
    return toast('Offline · showing saved data')
  }
  if (!state.member) { clearCache(); return renderNotMember(root, state.session.user) }
  await load()
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
  render()
}

async function scan() {
  if (state.scanning) return
  state.scanning = true
  render()
  try {
    const r = await runScan(state.prefs.root || undefined)
    toast(`Scanned ${r.evaluations} evaluations · ${r.events_added} new document folder${r.events_added === 1 ? '' : 's'}`)
    state.scanning = false
    state.docs = {}
    if (state.view === 'evaluation') loadDoc(state.evalId)
    await load()
  } catch (e) {
    state.scanning = false
    toast(e.message || 'Scan failed')
    render()
  }
}

// ── Rendering ────────────────────────────────────────────────────────────
const NAV = [
  { view: 'home', label: 'Home', icon: 'sun' },
  { view: 'register', label: 'Register', icon: 'grid' },
  { view: 'waiting', label: 'Waiting', icon: 'hourglass' },
  { view: 'materials', label: 'Materials', icon: 'layers' },
]
const TITLES = { home: 'Today', register: 'Register', waiting: 'Waiting', materials: 'Materials', settings: 'Settings' }

function content() {
  switch (state.view) {
    case 'waiting': return renderWaiting()
    case 'materials': return renderMaterials()
    case 'settings': return renderSettings()
    case 'register': return renderRegister()
    case 'evaluation': return renderEvaluation()
    default: return renderHome()
  }
}

function scanButton() {
  const run = state.data.lastRun
  const failed = run?.ok === false
  const when = run?.finished_at || run?.started_at
  const ago = when ? timeAgo(when) : null
  const text = state.scanning ? 'Scanning…' : failed ? 'Scan failed' : ago ? `Scanned ${ago}` : 'Never scanned'
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
  if (state.view === 'evaluation') return ''
  if (state.view === 'home') {
    const d = new Date(todayIso() + 'T00:00:00')
    return `<div class="page-head"><div><h1>${d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}</h1><p>${esc(homeSummary())}</p></div></div>`
  }
  return `<div class="page-head"><div><h1>${TITLES[state.view]}</h1></div>
    ${state.view === 'register' ? `<label class="search-box">${icon('search', 16)}<input type="search" id="search-input" placeholder="Search material, candidate, item code" value="${esc(state.filter.q)}" autocomplete="off"></label>` : ''}</div>`
}

function shell() {
  const waiting = waitingCount()
  return `
    <div class="shell">
      <header class="topnav">
        <div class="brand"><span class="logo">${stampMark(20)}</span><span>Vetted</span></div>
        <nav class="pills" aria-label="Pages">
          ${NAV.map(n => `<button class="pill${state.view === n.view || (state.view === 'evaluation' && state.backView === n.view) ? ' on' : ''}" data-act="nav" data-view="${n.view}">${icon(n.icon, 17)}<span>${n.label}</span>${n.view === 'waiting' && waiting ? `<b class="pill-badge">${waiting}</b>` : ''}</button>`).join('')}
        </nav>
        <div class="topnav-right">
          ${scanButton()}
          <button class="round-btn${state.view === 'settings' ? ' on' : ''}" data-act="nav" data-view="settings" aria-label="Settings" title="Settings">${icon('settings', 18)}</button>
        </div>
      </header>
      <main class="main">
        ${pageHead()}
        <div class="content view-${state.view}">${content()}</div>
        <p class="version">v${__APP_VERSION__}${import.meta.env.MODE === 'demo' ? ' · demo data' : ''}</p>
      </main>
    </div>`
}

function render() {
  if (!state.member) return
  const active = document.activeElement
  const searchFocused = active?.id === 'search-input'
  const caret = searchFocused ? active.selectionStart : null
  const sc = root.querySelector('.content')
  const scroll = sc ? [sc.scrollTop, sc.querySelector('.sheet')?.scrollLeft || 0] : null
  root.innerHTML = shell()
  const nc = root.querySelector('.content')
  if (scroll && nc) { nc.scrollTop = scroll[0]; const s = nc.querySelector('.sheet'); if (s) s.scrollLeft = scroll[1] }
  if (searchFocused) { const inp = root.querySelector('#search-input'); if (inp) { inp.focus(); inp.setSelectionRange(caret, caret) } }
}

function setView(view) {
  state.view = view
  render()
  root.querySelector('.content')?.scrollTo(0, 0)
}

// ── Full evaluation page ─────────────────────────────────────────────────
function openEvaluation(id) {
  if (state.view !== 'evaluation') state.backView = state.view
  state.evalId = id
  setView('evaluation')
  if (!state.docs[id]) loadDoc(id)
}

async function loadDoc(id) {
  try {
    const [doc, glossary] = await Promise.all([fetchDoc(id), state.glossary ?? fetchGlossary().catch(() => ({}))])
    state.glossary = glossary
    state.docs[id] = { body: doc?.body ?? null, at: doc?.updated_at ?? null }
  } catch (e) {
    const missing = /rm_eval_docs|42P01|PGRST205/.test(`${e.code} ${e.message}`)
    state.docs[id] = { error: missing ? 'The rm_eval_docs table is not set up yet. Run the v0.3.0 SQL block in supabase/SETUP.md, then scan once.' : e.message }
  }
  if (state.view === 'evaluation' && state.evalId === id) render()
}

// Scroll to a row or note; open its folded section first.
function jumpTo(elId) {
  const el = root.querySelector(`#${CSS.escape(elId)}`)
  if (!el) return
  const sec = el.closest('details')
  if (sec && !sec.open) sec.open = true
  el.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
  el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash')
}

hooks.openFull = openEvaluation
root.addEventListener('toggle', e => {
  if (e.target.matches?.('.fe-sec')) state.secOpen.set(`${state.evalId}:${e.target.dataset.sec}`, e.target.open)
}, true)

// ── Interaction ──────────────────────────────────────────────────────────
root.addEventListener('click', async e => {
  const el = e.target.closest('[data-act]')
  if (!el || !root.contains(el)) return
  const { act, id, view, value } = el.dataset
  switch (act) {
    case 'nav': return setView(view)
    case 'open': if (e.target.closest('button') && e.target.closest('button') !== el) return; return openDetail(id, render)
    case 'group': state.filter.group = value; state.filter.sub = null; return render()
    case 'sub': state.filter.sub = state.filter.sub === value ? null : value; return render()
    case 'kind': state.filter.kind = value; return render()
    case 'material': state.filter.q = value; state.filter.group = 'all'; state.filter.sub = null; return setView('register')
    case 'product': {
      const project = !state.filter.project || state.projectOf[value] === state.filter.project ? state.filter.project : ''
      state.filter = { ...state.filter, product: value, project, q: '', group: 'all', sub: null }
      return setView('register')
    }
    case 'project':
      state.filter.project = value
      if (value && state.filter.product && state.projectOf[state.filter.product] !== value) state.filter.product = ''
      return render()
    case 'export': return exportCsv()
    case 'evaluation': return openEvaluation(id)
    case 'back': return setView(state.backView || 'register')
    case 'jump': return jumpTo(value)
    case 'note': return jumpTo(`note-${value}`)
    case 'issues-only': savePrefs({ issuesOnly: value === '1' }); return render()
    case 'eval-detail': return openDetail(state.evalId, render)
    case 'eval-file': {
      const r = state.rows.find(x => x.id === state.evalId)
      return window.electronAPI?.openPath({ root: state.prefs.root, rel: `${r.folder}/${r.fileName}` })
    }
    case 'scan': return scan()
    case 'received':
      e.stopPropagation()
      try {
        const row = await updateEvent(id, { closed_on: todayIso() })
        const i = state.data.events.findIndex(x => x.id === id)
        state.data.events[i] = row
        setData(state.data); cacheData(); toast('Marked received'); render()
      } catch (err) { toast(err.message) }
      return
    case 'theme': savePrefs({ theme: value }); applyTheme(value); return render()
    case 'day': state.homeDay = state.homeDay === value ? null : value; return render()
    case 'to-register': state.filter = { ...state.filter, group: 'action', sub: value, q: '' }; return setView('register')
    case 'update': return window.electronAPI?.checkForUpdates()
    case 'signout': await signOut(); return
  }
})

root.addEventListener('keydown', e => {
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[data-act="open"],[data-act="material"]')) { e.preventDefault(); e.target.click() }
})

root.addEventListener('change', e => {
  if (e.target.id === 'company') { state.filter.company = e.target.value; render() }
  if (e.target.id === 'product') { state.filter.product = e.target.value; render() }
  if (e.target.id === 'sort') { savePrefs({ sort: e.target.value }); render() }
  if (e.target.id === 'root') savePrefs({ root: e.target.value.trim() })
  if (e.target.id === 'show-old') { savePrefs({ showOld: e.target.checked }); render() }
  if (e.target.id === 'more-cols') { savePrefs({ moreCols: e.target.checked }); render() }
})

let searchTimer
root.addEventListener('input', e => {
  if (e.target.id !== 'search-input') return
  state.filter.q = e.target.value
  clearTimeout(searchTimer)
  searchTimer = setTimeout(render, 120)
})

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    if (closeTopModal()) return
    if (state.view === 'evaluation') return setView(state.backView || 'register')
    if (state.filter.q) { state.filter.q = ''; render() }
    return
  }
  const typing = e.target.closest('input, textarea, select, [contenteditable]')
  if (typing || modalOpen() || e.ctrlKey || e.metaKey || e.altKey || !state.member) return
  const keys = {
    '1': () => setView('home'), '2': () => setView('register'), '3': () => setView('waiting'), '4': () => setView('materials'),
    '/': () => { if (state.view !== 'register') setView('register'); root.querySelector('#search-input')?.focus() },
  }
  const fn = keys[e.key]
  if (fn) { e.preventDefault(); fn() }
})

// Coming back to the window refreshes from Supabase (a chat may have logged something).
let lastFocusLoad = Date.now()
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible' || !state.member || Date.now() - lastFocusLoad < 60_000) return
  lastFocusLoad = Date.now()
  load()
})

initUpdateReload({ isBusy: modalOpen })
boot()
