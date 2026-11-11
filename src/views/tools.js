// Two tools on Overview and Evaluations: "Reply to PU" (tick materials, get the
// Thai status reply in the golden form, copy it; nothing is sent) and "Needs a
// look" (the app checked against the files; read-only, fixing is by hand).
import { state, readOnly } from '../store.js'
import { STATUS, daysBetween, todayIso } from '../model.js'
import { esc, icon, openModal, copyText } from '../ui.js'
import { pill, pillOf, who, shortId } from '../parts.js'
import { replyGroups, puReply, DEFAULT_TOPIC } from '../reply.js'
import { healthCheck, RULES } from '../health.js'

const CLOSED = ['approved', 'not_approved', 'closed']

// ── Needs a look ──
let memo = { rows: null, files: null, list: [] }
export function healthList() {
  if (memo.rows !== state.rows || memo.files !== state.data.files) memo = { rows: state.rows, files: state.data.files, list: healthCheck(state.rows, state.data.files || []) }
  return memo.list
}
export const healthFor = id => healthList().filter(x => x.id === id)

const lookRow = x => `
  <div class="lrow look-row" data-go="${x.id}" data-act="evaluation" data-id="${x.id}" tabindex="0">
    ${pill(x.row)}
    <span class="lmain"><b>${who(x.row)}</b><em class="look-rule">${esc(x.title)}</em><span class="look-why">${esc(x.reason)}</span></span>
    <span class="look-go">${icon('right', 16)}</span>
  </div>`

export function lookButton() {
  if (readOnly()) return ''
  const n = healthList().length
  return `<button class="btn surface" data-act="health-all">${icon('eye', 15)} Needs a look${n ? ` <span class="badge amber">${n}</span>` : ''}</button>`
}

export function lookCard() {
  if (readOnly()) return ''
  const list = healthList()
  const shown = list.slice(0, 5)
  return `
    <section class="hcard lookc">
      <div class="hcard-head"><h2>${icon('eye', 18)} Needs a look <span class="count${list.length ? ' amber' : ''}">${list.length}</span></h2><span class="hsub">The app against the comparison files and Document folders</span></div>
      <div class="list">
        ${shown.length ? shown.map(lookRow).join('') : '<p class="empty">Everything matches its file.</p>'}
      </div>
      ${list.length > shown.length ? `<button class="more-link" data-act="health-all">All ${list.length} · grouped by what doesn't match</button>` : ''}
    </section>`
}

// On the evaluation page: why this one is on the list.
export function lookPanel(r) {
  if (readOnly()) return ''
  const list = healthFor(r.id)
  if (!list.length) return ''
  return `<div class="banner look-banner">${icon('eye', 16)}<div><b>Needs a look</b>${list.map(x => `<p><em>${esc(x.title)}.</em> ${esc(x.reason)}</p>`).join('')}<p class="note">Found by comparing the app with the file and its Document folders. Fix it by hand; the check changes nothing.</p></div></div>`
}

function goTo(id, m) { m.close(); location.hash = `#/e/${shortId(id)}` }

export function openHealth() {
  const list = healthList()
  const groups = Object.entries(RULES).map(([k, title]) => [k, title, list.filter(x => x.rule === k)]).filter(([, , xs]) => xs.length)
  const m = openModal(`
    <div class="modal-head"><h2>Needs a look <span class="count amber">${list.length}</span></h2><button class="icon-btn" data-close aria-label="Close">${icon('x', 18)}</button></div>
    <div class="modal-body look-all">
      <p class="note">Each evaluation in the app checked against its comparison file's tracker block and its dated Document folders. Nothing here changes the data: open the evaluation and fix it by hand.</p>
      ${groups.length ? groups.map(([k, title, xs]) => `<section class="look-group"><h3>${esc(title)} <span class="count">${xs.length}</span></h3><div class="list">${xs.map(lookRow).join('')}</div></section>`).join('')
        : '<p class="empty">Everything matches its file.</p>'}
    </div>`, { wide: true })
  m.el.classList.add('look-modal')
  m.el.addEventListener('click', e => {
    const row = e.target.closest('[data-go]')
    if (row) { e.stopPropagation(); goTo(row.dataset.go, m) }
  })
  m.el.addEventListener('keydown', e => { const row = e.target.closest('[data-go]'); if (row && e.key === 'Enter') goTo(row.dataset.go, m) })
}

// ── Reply to PU ──
export function replyButton() {
  if (readOnly()) return ''
  return `<button class="btn surface" data-act="reply-pu">${icon('message', 15)} Reply to PU</button>`
}

// Candidates ticked by default: the open ones, and any closed in the last 30 days;
// a material where none qualify takes all of them.
function defaultCands(g) {
  const recent = r => !CLOSED.includes(r.status) || (r.stageDates.outcome?.date && daysBetween(r.stageDates.outcome.date, todayIso()) <= 30)
  const pickd = g.rows.filter(recent)
  return new Set((pickd.length ? pickd : g.rows).map(r => r.id))
}

export function openReply() {
  const groups = replyGroups(state.rows)
  const ui = { on: new Map(), q: '', topic: DEFAULT_TOPIC } // group key → Set of candidate ids
  const m = openModal(`
    <div class="modal-head"><div><h2>Reply to PU</h2><p class="note">Tick the materials PU asked about. The draft follows the golden form (example 6); edit it, copy it, send it in LINE yourself.</p></div><button class="icon-btn" data-close aria-label="Close">${icon('x', 18)}</button></div>
    <div class="modal-body reply">
      <div class="rp-pick">
        <label class="search rp-search"><span class="search-ico">${icon('search', 15)}</span><input type="search" data-rp="q" placeholder="Find a material" autocomplete="off"></label>
        <div class="rp-list" data-rp="list"></div>
      </div>
      <div class="rp-draft">
        <label class="field">Subject: ตอบเรื่อง…<input data-rp="topic" value="${esc(DEFAULT_TOPIC)}"></label>
        <label class="field rp-text-field">Draft<textarea class="thai" data-rp="text" rows="16" spellcheck="false" placeholder="Tick a material on the left to start the draft."></textarea></label>
        <p class="note">Built from the statuses and the open requests as they are logged, nothing else: no prices, no new asks. Ticking again rebuilds the draft, so tick first, then edit.</p>
      </div>
    </div>
    <div class="modal-foot"><span class="muted" data-rp="count">No material ticked</span><span class="row-end"><button class="btn ghost" data-close>Close</button><button class="btn primary" data-rp="copy">${icon('copy', 15)} Copy</button></span></div>`, { wide: true })
  m.el.classList.add('reply-modal')
  const $ = k => m.el.querySelector(`[data-rp="${k}"]`)

  const draw = () => {
    const q = ui.q.trim().toLowerCase()
    const shown = groups.filter(g => !q || ui.on.has(g.key) || g.name.toLowerCase().includes(q) || g.rows.some(r => (r.candidate || '').toLowerCase().includes(q)))
    let closedHead = false
    $('list').innerHTML = shown.map(g => {
      const on = ui.on.get(g.key)
      const head = !g.open && !closedHead ? (closedHead = true, '<p class="rp-sep">All candidates closed</p>') : ''
      return `${head}<div class="rp-mat${on ? ' on' : ''}">
        <label class="rp-row"><input type="checkbox" data-g="${esc(g.key)}"${on ? ' checked' : ''}><span class="rp-name"><b>${esc(g.name)}</b><small>${g.rows.length === 1 ? esc(g.rows[0].candidate || 'candidate not set') : `${g.rows.length} candidates`}</small></span>
          <span class="rp-pills">${[...new Set(g.rows.map(r => r.status))].map(pillOf).join('')}</span></label>
        ${on && g.rows.length > 1 ? `<div class="rp-cands">${g.rows.map(r => `<label class="rp-cand"><input type="checkbox" data-g="${esc(g.key)}" data-c="${r.id}"${on.has(r.id) ? ' checked' : ''}><span>${esc(r.candidate || 'candidate not set')}</span>${pill(r)}</label>`).join('')}</div>` : ''}
      </div>`
    }).join('') || '<p class="empty">No material matches.</p>'
  }
  const build = () => {
    const picked = groups.filter(g => ui.on.get(g.key)?.size).map(g => ({ name: g.name, rows: g.rows.filter(r => ui.on.get(g.key).has(r.id)) }))
    $('text').value = picked.length ? puReply(picked, { topic: ui.topic }) : ''
    $('count').textContent = picked.length ? `${picked.length} material${picked.length === 1 ? '' : 's'} · ${picked.reduce((n, g) => n + g.rows.length, 0)} candidate${picked.reduce((n, g) => n + g.rows.length, 0) === 1 ? '' : 's'}` : 'No material ticked'
  }

  m.el.addEventListener('change', e => {
    const t = e.target
    if (!t.matches('[data-g]')) return
    const g = groups.find(x => x.key === t.dataset.g)
    if (t.dataset.c) {
      const set = ui.on.get(g.key)
      if (t.checked) set.add(t.dataset.c); else set.delete(t.dataset.c)
      if (!set.size) ui.on.delete(g.key)
    } else if (t.checked) ui.on.set(g.key, defaultCands(g))
    else ui.on.delete(g.key)
    draw(); build()
  })
  m.el.addEventListener('input', e => {
    if (e.target === $('q')) { ui.q = e.target.value; draw() }
    if (e.target === $('topic')) { ui.topic = e.target.value || DEFAULT_TOPIC; build() }
  })
  $('copy').addEventListener('click', () => {
    const text = $('text').value.trim()
    if (text) copyText(text, 'Reply copied · paste it in LINE')
  })
  draw()
  $('q').focus()
  return { el: m.el, tick: keys => { for (const k of keys) { const g = groups.find(x => x.key === k); if (g) ui.on.set(k, defaultCands(g)) } draw(); build() } }
}
