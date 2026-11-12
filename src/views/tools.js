// Two tools on Overview and Evaluations: "Reply to PU" (tick materials, get the
// Thai status reply in the golden form, copy it; nothing is sent) and "Needs a
// look" (the app checked against the files; read-only, fixing is by hand).
import { state, readOnly } from '../store.js'
import { daysBetween, todayIso, fmtDate, waitTone, expiring } from '../model.js'
import { esc, icon, openModal, copyText, toast } from '../ui.js'
import { pill, pillOf, who, shortId } from '../parts.js'
import { replyGroups, puReply, DEFAULT_TOPIC } from '../reply.js'
import { healthCheck, RULES } from '../health.js'
import { logSentMany } from '../edits.js'
import { dmyInput } from '../dateInput.js'

// ── Small dialogs ──
// A form in a modal: fields (HTML) and one submit button. onSubmit gets the
// FormData; a thrown error shows as a toast and leaves the dialog open.
export function formDialog({ title, sub = '', fields, submit, onSubmit }) {
  const m = openModal(`
    <form class="dlg" data-dlg>
      <div class="modal-head"><div><h2>${esc(title)}</h2>${sub ? `<p class="note">${sub}</p>` : ''}</div><button type="button" class="icon-btn" data-close aria-label="Close">${icon('x', 18)}</button></div>
      <div class="modal-body">${fields}</div>
      <div class="modal-foot"><span></span><span class="row-end"><button type="button" class="btn ghost" data-close>Cancel</button><button class="btn primary" type="submit">${esc(submit)}</button></span></div>
    </form>`)
  const form = m.el.querySelector('form')
  form.addEventListener('submit', async e => {
    e.preventDefault()
    e.stopPropagation()
    const btn = form.querySelector('[type=submit]')
    btn.disabled = true
    try { await onSubmit(new FormData(form), e.submitter); m.close() } catch (err) { toast(err.message || String(err)); btn.disabled = false }
  })
  form.querySelector('input:not([type=hidden]):not(.dmy-native), textarea')?.focus()
  return m
}
// dd-mm-yyyy whatever the PC's locale (see dateInput.js).
export const dateField = (name, label, value = todayIso()) => `<label class="field">${esc(label)}${dmyInput(name, value, { max: todayIso() })}</label>`

// "Mark as sent": the date and the LINE screenshot(s), pasted, dropped or picked.
export function sentDialog({ title, sub, submit = 'Log as sent', onSubmit }) {
  const files = []
  const m = formDialog({
    title, sub, submit,
    fields: `${dateField('date', 'Sent on')}
      <div class="field">Screenshot<div class="drop-zone sent-drop" data-drop tabindex="0">
        <span class="pend-list" data-pend></span>
        <button type="button" class="btn ghost small" data-pick>${icon('image', 15)} Add image</button>
        <span class="muted small">or paste (Ctrl+V) or drop the LINE screenshot here</span>
      </div></div>
      <input type="file" accept="image/*" multiple hidden data-file-pick>`,
    onSubmit: fd => onSubmit({ date: fd.get('date'), files: files.map(x => x.file) }),
  })
  const el = m.el
  const draw = () => {
    el.querySelector('[data-pend]').innerHTML = files.map((p, i) => `<span class="pend"><img src="${esc(p.url)}" alt=""><button type="button" class="icon-btn small" data-unpend="${i}" aria-label="Remove image">${icon('x', 13)}</button></span>`).join('')
  }
  const add = list => { for (const f of list) if (f?.type?.startsWith('image/')) files.push({ file: f, url: URL.createObjectURL(f) }); draw() }
  el.addEventListener('paste', e => {
    const imgs = [...(e.clipboardData?.items || [])].filter(x => x.kind === 'file').map(x => x.getAsFile())
    if (imgs.length) { e.preventDefault(); e.stopPropagation(); add(imgs) }
  })
  el.addEventListener('dragover', e => e.preventDefault())
  el.addEventListener('drop', e => { e.preventDefault(); e.stopPropagation(); add(e.dataTransfer?.files || []) })
  el.addEventListener('click', e => {
    if (e.target.closest('[data-pick]')) el.querySelector('[data-file-pick]').click()
    const un = e.target.closest('[data-unpend]')
    if (un) { URL.revokeObjectURL(files[+un.dataset.unpend].url); files.splice(+un.dataset.unpend, 1); draw() }
  })
  el.addEventListener('change', e => { if (e.target.matches('[data-file-pick]')) { add(e.target.files); e.target.value = '' } })
  return m
}

// ── QC samples and expiring documents (Overview cards) ──
const STEP_NOW = { requested: 'Not requested yet', received: 'Waiting for the sample', sent: 'Received, not sent to QC yet', result: 'With QC for testing' }
export function samplesCard() {
  const rows = state.rows.filter(r => r.sample?.open && !r.stages.outcome).sort((a, b) => (b.sample.waitingDays ?? -1) - (a.sample.waitingDays ?? -1))
  if (!rows.length) return ''
  return `
    <section class="hcard samplec">
      <div class="hcard-head"><h2>${icon('flask', 18)} QC samples <span class="count">${rows.length}</span></h2><span class="hsub">Requested → received → sent to QC → result</span></div>
      <div class="list">${rows.slice(0, 6).map(r => {
        const s = r.sample
        return `<div class="lrow sample-row" data-act="evaluation" data-id="${r.id}" tabindex="0">
          <span class="lmain"><b>${who(r)}</b><span>${esc(STEP_NOW[s.now])}${s.now === 'result' ? '' : s.holder && s.holder !== 'RD' ? ` · with ${esc(s.holder)}` : ' · your move'}</span></span>
          ${sampleDots(s)}
          <span class="wait w-${waitTone(s.waitingDays)}">${s.waitingDays ?? 0} d</span>
        </div>`
      }).join('')}</div>
      ${rows.length > 6 ? `<p class="ag-more">${rows.length - 6} more on their evaluation pages</p>` : ''}
    </section>`
}
export const sampleDots = s => `<span class="sdots" aria-label="${esc(s.steps.map(x => `${x.label}: ${x.date ? fmtDate(x.date) : 'not yet'}`).join(', '))}">${s.steps.map(x => `<i class="${x.done ? 'done' : x.key === s.now ? 'now' : ''}${x.key === 'result' && s.result === 'not_approved' ? ' bad' : ''}" title="${esc(`${x.label}${x.date ? ` · ${fmtDate(x.date)}` : ''}`)}"></i>`).join('')}</span>`

// Valid-until dates within 60 days (or already past) on evaluations still in use.
export const EXPIRY_WINDOW = 60
export const expiringItems = (rows = state.rows) => expiring(rows, EXPIRY_WINDOW)
export const expiryWord = d => d < 0 ? `expired ${-d} d ago` : d === 0 ? 'expires today' : `in ${d} d`
export function expiryCard() {
  const items = expiringItems()
  const tracked = state.rows.reduce((n, r) => n + r.expiries.length, 0)
  if (readOnly() && !items.length) return ''
  return `
    <section class="hcard expc">
      <div class="hcard-head"><h2>${icon('hourglass', 18)} Expiring documents <span class="count${items.length ? ' amber' : ''}">${items.length}</span></h2><span class="hsub">GMP, ISO, FSSC, quotation · next ${EXPIRY_WINDOW} days</span></div>
      <div class="list">${items.length ? items.map(x => `
        <div class="lrow exp-row" data-act="evaluation" data-id="${x.r.id}" tabindex="0">
          <span class="exp-doc">${esc(x.doc)}</span>
          <span class="lmain"><b>${who(x.r)}</b><span>valid to ${fmtDate(x.date)}</span></span>
          <span class="wait w-${x.days < 0 ? 'red' : x.days <= 30 ? 'amber' : 'ok'}">${expiryWord(x.days)}</span>
        </div>`).join('')
        : `<p class="empty">${tracked ? `Nothing expires in the next ${EXPIRY_WINDOW} days (${tracked} date${tracked === 1 ? '' : 's'} tracked).` : 'No valid-until dates yet. Chats add them to the tracker block as gmp_valid_to:, iso_valid_to:, fssc_valid_to:, quotation_valid_to:.'}</p>`}
      </div>
    </section>`
}

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
  return `<button class="btn surface" data-act="health-all" title="Needs a look">${icon('eye', 15)}<span class="lab-look"> Needs a look</span>${n ? ` <span class="badge amber">${n}</span>` : ''}</button>`
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
  // A fix you confirm with one click (the decision date from the signed form); the rest by hand.
  const fixBtn = x => x.rule === 'decision_estimated' && x.fix?.date ? ` <button class="btn soft small" data-act="decision-date" data-value="${x.fix.date}">Date it ${fmtDate(x.fix.date)}</button>` : ''
  return `<div class="banner look-banner">${icon('eye', 16)}<div><b>Needs a look</b>${list.map(x => `<p><em>${esc(x.title)}.</em> ${esc(x.reason)}${fixBtn(x)}</p>`).join('')}<p class="note">Found by comparing the app with the file and its Document folders. The check changes nothing by itself.</p></div></div>`
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
  return `<button class="btn surface" data-act="reply-pu" title="Reply to PU">${icon('message', 15)}<span class="lab"> Reply to PU</span></button>`
}

// On a phone the toolbar's buttons fold into one Tools button with this menu.
export function toolsButton() {
  const n = readOnly() ? 0 : healthList().length
  return `<button class="btn surface tb-tools" data-menu="tools" aria-label="Tools" title="Tools">${icon('sliders', 16)}${n ? ` <span class="badge amber">${n}</span>` : ''}</button>`
}
export function toolsMenuItems() {
  const n = readOnly() ? 0 : healthList().length
  return [
    ...(readOnly() ? [] : [{ label: 'Reply to PU', act: 'reply-pu' }, { label: 'Needs a look', act: 'health-all', hint: n ? `${n} to check` : 'Nothing to check' }, { sep: true }]),
    { label: 'Filters…', act: 'menu-filters' }, { label: 'View…', act: 'menu-view' }, { sep: true },
    { label: 'Status list PDF', act: 'print-list' }, { label: 'CSV for Excel', act: 'export' },
  ]
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
    <div class="modal-foot"><span class="muted" data-rp="count">No material ticked</span><span class="row-end"><button class="btn ghost" data-close>Close</button><button class="btn soft" data-rp="sent">${icon('check', 15)} Mark as sent</button><button class="btn primary" data-rp="copy">${icon('copy', 15)} Copy</button></span></div>`, { wide: true })
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
  // After sending in LINE: a Message sent entry on every ticked candidate, with the screenshot.
  $('sent').addEventListener('click', () => {
    const picked = groups.filter(g => ui.on.get(g.key)?.size)
    const rows = picked.flatMap(g => g.rows.filter(r => ui.on.get(g.key).has(r.id)))
    if (!rows.length) return toast('Tick the materials the reply covered first')
    const names = picked.map(g => g.name)
    sentDialog({
      title: 'Mark the reply as sent',
      sub: `Logs “Message sent” to PU on ${rows.length} evaluation${rows.length === 1 ? '' : 's'} (${esc(names.join(', '))}), each with its own copy of the screenshot. Ctrl+Z undoes it.`,
      onSubmit: async ({ date, files }) => {
        await logSentMany(rows, { date, files, note: `Status reply to PU's follow-up (${names.join(', ')}): ${$('text').value.trim().split('\n').find(l => /^เรื่อง/.test(l))?.replace(/^เรื่อง:\s*/, '').replace(/\*/g, '') || 'sent'}` })
        toast(`Logged on ${rows.length} evaluation${rows.length === 1 ? '' : 's'}${files.length ? ' with the screenshot' : ''}`)
        m.close()
      },
    })
  })
  draw()
  $('q').focus()
  return { el: m.el, tick: keys => { for (const k of keys) { const g = groups.find(x => x.key === k); if (g) ui.on.set(k, defaultCands(g)) } draw(); build() } }
}
