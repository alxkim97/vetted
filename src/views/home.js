// Home: four cards that each answer one question.
//   This week · Needs action · Waiting on documents · Turnaround
import { state, GROUPS, groupOf } from '../store.js'
import { STATUS, EVENT_KINDS, fmtDate, todayIso, waitTone } from '../model.js'
import { esc, icon } from '../ui.js'

const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const addDays = (iso, n) => new Date(Date.parse(iso) + n * 864e5).toISOString().slice(0, 10)
const who = r => [r.materialName, r.grade, r.candidate].filter(Boolean).map(esc).join(' · ')
const arrow = (view, label) => `<button class="go" data-act="nav" data-view="${view}" aria-label="${label}">${icon('arrowUR', 15)}</button>`

export function homeSummary() {
  const action = state.rows.filter(r => groupOf(r, 'action')).length
  const waiting = state.rows.reduce((n, r) => n + r.openRequests.length, 0)
  return `${action} need${action === 1 ? 's' : ''} action · ${waiting} waiting on documents`
}

// Everything dated in the last 7 days: timeline entries plus new comparison revisions.
function weekItems() {
  const today = todayIso(), from = addDays(today, -6)
  const items = []
  for (const r of state.rows) {
    for (const ev of r.events) if (ev.event_date >= from) items.push({ date: ev.event_date, kind: ev.kind, r, text: ev.note || ev.what, party: ev.party })
    if (r.revDate && r.revDate >= from) items.push({ date: r.revDate, kind: 'revision', r, text: r.fileName })
  }
  return items.sort((a, b) => b.date.localeCompare(a.date))
}

function weekCard() {
  const today = todayIso()
  const items = weekItems()
  const days = Array.from({ length: 7 }, (_, i) => addDays(today, i - 6))
  const pick = state.homeDay && days.includes(state.homeDay) ? state.homeDay : null
  const shown = pick ? items.filter(x => x.date === pick) : items
  const byDate = {}
  for (const it of shown) (byDate[it.date] ||= []).push(it)
  const label = k => k === 'revision' ? 'Comparison revised' : EVENT_KINDS[k].label
  return `
    <section class="hcard week">
      <div class="hcard-head"><h2>${icon('clock', 18)} This week</h2></div>
      <div class="days">
        ${days.map(d => {
          const n = items.filter(x => x.date === d).length
          const dt = new Date(d + 'T00:00:00')
          return `<button class="day${d === today ? ' today' : ''}${pick === d ? ' on' : ''}" data-act="day" data-value="${d}" aria-label="${fmtDate(d)}, ${n} entries">
            <b>${dt.getDate()}</b><span>${DAY[dt.getDay()]}</span><i class="${n ? 'has' : ''}"></i></button>`
        }).join('')}
      </div>
      <div class="agenda">
        ${shown.length ? Object.entries(byDate).map(([d, list]) => `
          <div class="ag-date">${d === today ? 'Today' : d === addDays(today, -1) ? 'Yesterday' : fmtDate(d)}</div>
          ${list.map(it => `
            <button class="ag-item k-${it.kind}" data-act="open" data-id="${it.r.id}">
              <span class="ag-dot"></span>
              <span class="ag-body">
                <span class="ag-kind">${label(it.kind)}${it.party ? ` · ${esc(it.party)}` : ''}</span>
                <span class="ag-title">${who(it.r)}</span>
                ${it.kind === 'verdict' || it.kind === 'revision' ? `<span class="chips"><span class="stamp t-${STATUS[it.r.status].tone}">${esc(STATUS[it.r.status].label)}</span>${it.r.rev != null && it.kind === 'revision' ? `<span class="chip-tag">R.${it.r.rev}</span>` : ''}</span>` : it.text ? `<span class="ag-text">${esc(it.text)}</span>` : ''}
              </span>
            </button>`).join('')}`).join('')
        : `<p class="empty">${pick ? 'Nothing on this day.' : 'Nothing in the last 7 days.'}</p>`}
      </div>
    </section>`
}

function actionCard() {
  const tile = s => {
    const n = state.rows.filter(r => groupOf(r, 'action') && r.status === s).length
    return `<button class="ntile t-${STATUS[s].tone}" data-act="to-register" data-value="${s}">
      <b>${n}</b><span>${esc(STATUS[s].label)}</span><small>${esc(STATUS[s].hint || (s === 'fail' ? 'Failed the CoA check' : 'Data missing, ask for more'))}</small></button>`
  }
  const total = state.rows.filter(r => groupOf(r, 'action')).length
  return `
    <section class="hcard action">
      <div class="hcard-head"><h2>${icon('alert', 18)} Needs action <span class="count">${total}</span></h2>${arrow('register', 'Open Register')}</div>
      <div class="ntiles">${GROUPS.action.map(tile).join('')}</div>
    </section>`
}

function waitingCard() {
  const reqs = state.rows.flatMap(r => r.openRequests.map(q => ({ r, q }))).sort((a, b) => b.q.days - a.q.days)
  return `
    <section class="hcard waiting-card">
      <div class="hcard-head"><h2>${icon('send', 18)} Waiting on documents <span class="count">${reqs.length}</span></h2>${arrow('waiting', 'Open Waiting')}</div>
      <div class="wlist">
        ${reqs.length ? reqs.slice(0, 5).map(({ r, q }) => `
          <button class="wrow" data-act="open" data-id="${r.id}">
            <span class="wmain"><b>${who(r)}</b><span>${esc(q.what || 'Documents')}${q.party ? ` · ${esc(q.party)}` : ''}</span></span>
            <span class="wait w-${waitTone(q.days)}">${q.days} d</span>
          </button>`).join('')
        : '<p class="empty">No open document requests.</p>'}
      </div>
      <button class="btn cta block" data-act="nav" data-view="waiting">See everything waiting</button>
    </section>`
}

// Median days from first documents to first comparison, by month of the verdict.
// One series, so no legend: the title names it. Latest month is the highlighted bar.
function turnaroundCard() {
  const by = {}
  for (const r of state.rows) if (r.daysToVerdict != null && r.verdictDate) (by[r.verdictDate.slice(0, 7)] ||= []).push(r.daysToVerdict)
  const months = Object.keys(by).sort().slice(-6)
  const median = a => { const s = a.slice().sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2) }
  const data = months.map(m => ({ m, v: median(by[m]), n: by[m].length }))
  const max = Math.max(1, ...data.map(d => d.v))
  const last = data[data.length - 1]
  const prev = data[data.length - 2]
  return `
    <section class="hcard turnaround">
      <div class="hcard-head"><h2>${icon('hourglass', 18)} Turnaround</h2><span class="muted small">Median days from documents in to first comparison</span></div>
      ${data.length ? `
      <div class="ta">
        <div class="ta-hero">
          <b>${last.v}<small> d</small></b>
          <span>${MONTH[+last.m.slice(5) - 1]} ${last.m.slice(0, 4)} · ${last.n} evaluation${last.n === 1 ? '' : 's'}</span>
          ${prev ? `<span class="delta ${last.v <= prev.v ? 'good' : 'bad'}">${last.v === prev.v ? 'Same as' : last.v < prev.v ? `${prev.v - last.v} d faster than` : `${last.v - prev.v} d slower than`} ${MONTH[+prev.m.slice(5) - 1]}</span>` : ''}
        </div>
        <div class="bars" role="img" aria-label="${data.map(d => `${MONTH[+d.m.slice(5) - 1]}: ${d.v} days`).join(', ')}">
          ${data.map(d => `
            <div class="bar-col${d === last ? ' latest' : ''}" tabindex="0">
              <span class="tip">${MONTH[+d.m.slice(5) - 1]}: ${d.v} d median · ${d.n} evaluation${d.n === 1 ? '' : 's'}</span>
              ${d === last ? `<span class="bar-val">${d.v} d</span>` : ''}
              <div class="bar" style="height:${Math.max(4, Math.round(d.v / max * 100))}%"></div>
              <span class="bar-lbl">${MONTH[+d.m.slice(5) - 1]}</span>
            </div>`).join('')}
        </div>
      </div>` : '<p class="empty">No evaluation has both a documents date and a comparison date yet.</p>'}
    </section>`
}

export function renderHome() {
  return `<div class="home">${weekCard()}${actionCard()}${waitingCard()}${turnaroundCard()}</div>`
}
