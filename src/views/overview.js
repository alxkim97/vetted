// Overview: what's yours, what's with others, what just closed, then the
// week, turnaround and projects.
import { state, YOUR_MOVE, CLOSED, readOnly } from '../store.js'
import { STATUS, EVENT_KINDS, PROJECTS, STATIONS, fmtDate, todayIso, daysBetween, waitTone, notEvaluated } from '../model.js'
import { esc, icon } from '../ui.js'
import { pill, who } from '../parts.js'
import { lookCard, replyButton } from './tools.js'

// Buttons at the right of the page head.
export const overviewActions = () => readOnly() ? '' : `<div class="ph-acts">${replyButton()}</div>`

const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const addDays = (iso, n) => new Date(Date.parse(iso) + n * 864e5).toISOString().slice(0, 10)
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`
const recentlyClosed = () => {
  const from = addDays(todayIso(), -30)
  return state.rows.filter(r => CLOSED.includes(r.status) && r.stageDates.outcome?.date >= from)
    .sort((a, b) => b.stageDates.outcome.date.localeCompare(a.stageDates.outcome.date))
}
const openRequests = () => state.rows.flatMap(r => r.openRequests.map(q => ({ r, q }))).sort((a, b) => a.q.days - b.q.days)

export function overviewSummary() {
  const mine = state.rows.filter(r => YOUR_MOVE.includes(r.status)).length
  const others = state.rows.filter(r => r.status === 'in_progress').length
  return `${mine} your move · ${others} with others · ${recentlyClosed().length} closed in the last 30 days`
}

// What Alex does next for each kind of "your move".
const MOVE_ACTION = {
  missing: ['Write PU message', 'go-pu'],
  awaiting: ['Copy chat prompt', 'copy-prompt'],
  untagged: ['Set the CoA result', 'evaluation'],
  fail: ['Close it Not approved', 'evaluation'],
}
function moveCard() {
  const rows = state.rows.filter(r => YOUR_MOVE.includes(r.status)).sort((a, b) => (a.since?.date || '9').localeCompare(b.since?.date || '9'))
  return `
    <section class="hcard move">
      <div class="hcard-head"><h2>${icon('alert', 18)} Your move <span class="count">${rows.length}</span></h2><span class="hsub">Missing, Fail, or documents with no file yet</span></div>
      <div class="list">
        ${rows.length ? rows.slice(0, 8).map(r => {
          const [label, act] = MOVE_ACTION[r.status]
          return `<div class="lrow move-row" data-act="evaluation" data-id="${r.id}" tabindex="0">
            ${pill(r)}
            <span class="lmain"><b>${who(r)}</b><span>${esc(r.nextAction || r.nextStep || STATUS[r.status].hint)}</span></span>
            ${readOnly() ? '' : `<button class="btn soft small" data-act="${act}" data-id="${r.id}">${label}</button>`}
          </div>`
        }).join('') : '<p class="empty">Nothing is waiting on you.</p>'}
      </div>
      ${rows.length > 8 ? `<button class="more-link" data-act="chip-only" data-value="missing">${rows.length - 8} more · see them all under Evaluations</button>` : ''}
    </section>`
}

function waitCard() {
  const reqs = openRequests()
  const shown = reqs.slice(0, 7)
  return `
    <section class="hcard waitc">
      <div class="hcard-head"><h2>${icon('send', 18)} Waiting on others <span class="count">${reqs.length}</span></h2><span class="hsub">Newest first · amber after 14 d, red after 28 d</span></div>
      <div class="list">
        ${shown.length ? shown.map(({ r, q }) => `
          <div class="lrow wait-row" data-act="evaluation" data-id="${r.id}" tabindex="0">
            <span class="lmain"><b>${who(r)}</b><span>${esc(q.party || 'PU')} · ${q.topic === 'form' ? 'signed form · ' : ''}${esc(q.what || 'documents')} · asked ${fmtDate(q.event_date)}</span></span>
            <span class="wait w-${waitTone(q.days)}">${q.days} d</span>
            ${readOnly() || q.source === 'tracker' ? '' : `<button class="btn soft small" data-act="received" data-id="${q.id}">Mark received</button>`}
          </div>`).join('') : '<p class="empty">No open requests. Log one from an evaluation, or from a chat with <code>rm-log requested</code>.</p>'}
      </div>
      ${reqs.length > shown.length ? `<button class="more-link" data-act="chip-only" data-value="in_progress">${reqs.length - shown.length} more · see them all under Evaluations</button>` : ''}
    </section>`
}

function closedCard() {
  const rows = recentlyClosed()
  return `
    <section class="hcard closedc">
      <div class="hcard-head"><h2>${icon('check', 18)} Recently closed <span class="count">${rows.length}</span></h2><span class="hsub">Last 30 days</span></div>
      <div class="list">
        ${rows.length ? rows.slice(0, 6).map(r => {
          const d = r.stageDates.outcome
          return `<div class="lrow closed-row" data-act="evaluation" data-id="${r.id}" tabindex="0">
            ${pill(r)}
            <span class="lmain"><b>${who(r)}</b><span>${esc(r.raw.notes || r.nextAction || r.verdictLine || '')}</span></span>
            <span class="ago" title="${d.est ? 'Date estimated from the timeline' : ''}">${daysBetween(d.date, todayIso())} d ago${d.est ? '*' : ''}</span>
          </div>`
        }).join('') : '<p class="empty">Nothing closed in the last 30 days.</p>'}
      </div>
    </section>`
}

// Everything dated in the last 7 days: timeline entries plus new comparison revisions.
function weekItems() {
  const today = todayIso(), from = addDays(today, -6)
  const items = []
  for (const r of state.rows) {
    for (const ev of r.events) if (ev.event_date >= from && !ev.estimated) items.push({ date: ev.event_date, kind: ev.kind, r, ev, text: ev.note || ev.what, party: ev.party })
    if (r.revDate && r.revDate >= from) items.push({ date: r.revDate, kind: 'revision', r, text: r.fileName })
  }
  return items.sort((a, b) => b.date.localeCompare(a.date))
}
const stageLabel = ev => `${STATIONS.find(([k]) => k === (ev.what === 'outcome' ? 'decision' : ev.what))?.[1] ?? ev.what} → ${ev.note == null ? 'cleared' : { pass: 'Pass', gap: 'Missing', fail: 'Fail', approved: 'Approved', not_approved: 'Not approved', closed: 'Closed', true: 'Listed', false: 'Not listed' }[ev.note] ?? ev.note}`

function weekCard() {
  const today = todayIso()
  const items = weekItems()
  const days = Array.from({ length: 7 }, (_, i) => addDays(today, i - 6))
  const pick = state.homeDay && days.includes(state.homeDay) ? state.homeDay : null
  // The whole week can run to dozens of entries: show the latest 6, a day shows all of its own.
  const dayItems = pick ? items.filter(x => x.date === pick) : items
  const shown = pick ? dayItems : dayItems.slice(0, 6)
  const byDate = {}
  for (const it of shown) (byDate[it.date] ||= []).push(it)
  const label = it => it.kind === 'revision' ? 'Comparison revised' : it.kind === 'stage' ? `Stage · ${stageLabel(it.ev)}` : EVENT_KINDS[it.kind].label
  return `
    <section class="hcard week">
      <div class="hcard-head"><h2>${icon('clock', 18)} This week</h2></div>
      <div class="days">
        ${days.map(d => {
          const n = items.filter(x => x.date === d).length
          const dt = new Date(d + 'T00:00:00')
          return `<button class="day${d === today ? ' today' : ''}${pick === d ? ' on' : ''}" data-act="day" data-value="${d}" aria-label="${fmtDate(d)}, ${plural(n, 'entry')}">
            <b>${dt.getDate()}</b><span>${DAY[dt.getDay()]}</span><i class="${n ? 'has' : ''}"></i></button>`
        }).join('')}
      </div>
      <p class="legend-line"><span><i></i>A dot means something was logged that day: documents, a request, a message, a stage or a verdict.</span><span>${pick ? 'Click the day again to show the whole week.' : 'Click a day to show only that day.'}</span></p>
      <div class="agenda">
        ${shown.length ? Object.entries(byDate).map(([d, list]) => `
          <div class="ag-date">${d === today ? 'Today' : d === addDays(today, -1) ? 'Yesterday' : fmtDate(d)}</div>
          ${list.map(it => `
            <button class="ag-item k-${it.kind}" data-act="evaluation" data-id="${it.r.id}">
              <span class="ag-dot"></span>
              <span class="ag-body">
                <span class="ag-kind">${esc(label(it))}${it.party ? ` · ${esc(it.party)}` : ''}</span>
                <span class="ag-title">${who(it.r)}</span>
                ${it.text && !['stage', 'revision', 'docs_received'].includes(it.kind) ? `<span class="ag-text">${esc(it.text)}</span>` : ''}
              </span>
            </button>`).join('')}`).join('')
        : `<p class="empty">${pick ? 'Nothing logged on this day.' : 'Nothing logged in the last 7 days.'}</p>`}
        ${dayItems.length > shown.length ? `<p class="ag-more">${dayItems.length - shown.length} older entries this week · click a day to see all of it</p>` : ''}
      </div>
    </section>`
}

// Median days, by the month the verdict (or decision) fell in, last 6 months.
const MEASURES = {
  verdict: { label: 'To first verdict', days: r => r.daysToVerdict, month: r => r.verdictDate, long: 'documents in → first verdict', note: 'A verdict is the comparison file\'s first CoA result.' },
  decision: { label: 'To decision', days: r => r.decisionDays, month: r => r.stageDates.outcome?.date, long: 'documents in → Approved, Not approved or Closed', note: 'Decision dates set before v0.7 are estimated from the timeline.' },
}
const median = a => { const s = a.slice().sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2) }
function series(key) {
  const M = MEASURES[key]
  const by = {}
  for (const r of state.rows) { const d = M.days(r), m = M.month(r); if (d != null && m) (by[m.slice(0, 7)] ||= []).push(d) }
  const months = Object.keys(by).sort().slice(-6)
  return months.map(m => ({ m, v: median(by[m]), n: by[m].length }))
}
const mLabel = m => MONTH[+m.slice(5) - 1]
function turnCard() {
  const key = MEASURES[state.prefs.turn] ? state.prefs.turn : 'verdict'
  const M = MEASURES[key]
  const data = series(key)
  const other = series(key === 'verdict' ? 'decision' : 'verdict')
  const last = data[data.length - 1], prev = data[data.length - 2]
  const top = Math.max(4, ...data.map(d => d.v))
  const step = top <= 8 ? 2 : top <= 20 ? 5 : top <= 40 ? 10 : 20
  const max = Math.ceil(top / step) * step
  const ticks = Array.from({ length: max / step + 1 }, (_, i) => i * step)
  return `
    <section class="hcard turn">
      <div class="hcard-head"><h2>${icon('hourglass', 18)} Turnaround</h2>
        <label class="select-box"><select id="turn" aria-label="Measure">${Object.entries(MEASURES).map(([k, v]) => `<option value="${k}"${k === key ? ' selected' : ''}>${v.label}</option>`).join('')}</select></label></div>
      ${data.length ? `
      <div class="ta">
        <div class="ta-heroes">
          <div class="ta-hero"><b>${last.v}<small> d</small></b>
            <span>Median, ${M.long}<br>${mLabel(last.m)} ${last.m.slice(0, 4)} · ${plural(last.n, 'evaluation')}</span>
            ${prev ? `<span class="delta ${last.v <= prev.v ? 'good' : 'bad'}">${last.v === prev.v ? 'Same as' : last.v < prev.v ? `${prev.v - last.v} d faster than` : `${last.v - prev.v} d slower than`} ${mLabel(prev.m)}</span>` : ''}</div>
          ${other.length ? `<div class="ta-hero second"><b>${other[other.length - 1].v}<small> d</small></b><span>${MEASURES[key === 'verdict' ? 'decision' : 'verdict'].label}, ${mLabel(other[other.length - 1].m)}</span></div>` : ''}
        </div>
        <div>
          <div class="chart" role="img" aria-label="${data.map(d => `${mLabel(d.m)}: ${d.v} days`).join(', ')}">
            ${ticks.map(t => `<div class="grid-line${t ? '' : ' base'}" style="bottom:calc(24px + (100% - 24px) * ${t / max})"><span>${t}</span></div>`).join('')}
            <div class="bars">
              ${data.map(d => `
                <div class="bar-col${d === last ? ' latest' : ''}" tabindex="0" title="${mLabel(d.m)}: ${d.v} d median · ${plural(d.n, 'evaluation')}">
                  <em>${d.v}</em><div class="bar" style="height:${(d.v / max * 100).toFixed(1)}%"></div><label>${mLabel(d.m)}</label>
                </div>`).join('')}
            </div>
          </div>
          <p class="note">Each bar is the median for evaluations whose ${key === 'verdict' ? 'first verdict' : 'decision'} fell in that month, over the last 6 months. ${M.note}</p>
        </div>
      </div>` : `<p class="empty">No evaluation has both a documents date and a ${key === 'verdict' ? 'verdict' : 'decision'} date yet.</p>`}
    </section>`
}

// Statuses per project; a bar opens those evaluations. The not-evaluated list
// (BOM lines with no evaluation) opens under the card.
const BUCKETS = [
  ['approved', 'Approved', 'green', s => s === 'approved'],
  ['progress', 'In progress', 'blue', s => s === 'in_progress'],
  ['missing', 'Missing', 'amber', s => YOUR_MOVE.includes(s) && s !== 'fail'],
  ['fail', 'Fail or not approved', 'red', s => s === 'fail' || s === 'not_approved'],
  ['closed', 'Closed', 'slate', s => s === 'closed'],
  ['none', 'Not readable', 'grey', () => true],
]
function projectsCard() {
  const prods = state.data.products || []
  if (!prods.length) return ''
  const list = Object.entries(PROJECTS).map(([k, label]) => {
    const rs = state.rows.filter(r => r.products.some(p => state.projectOf[p.name] === k))
    const c = Object.fromEntries(BUCKETS.map(([b]) => [b, 0]))
    for (const r of rs) c[BUCKETS.find(([, , , test]) => test(r.status))[0]]++
    const bom = prods.filter(p => p.project === k && p.bom?.length)
    const missing = bom.length ? notEvaluated(bom, state.data.materials).filter(x => !x.note).length : 0
    return { k, label, n: rs.length, c, missing }
  }).filter(x => x.n || x.missing)
  const open = state.showNotEval
  return `
    <section class="hcard proj">
      <div class="hcard-head"><h2>${icon('layers', 18)} By project</h2><span class="hsub">Click a bar to open those evaluations</span></div>
      <div class="pj-legend">${BUCKETS.filter(([b]) => list.some(x => x.c[b])).map(([, l, tone]) => `<span><i class="t-${tone}"></i>${l}</span>`).join('')}</div>
      <div class="pj-list">
        ${list.map(x => `
          <div class="pj">
            <button class="pj-name" data-act="to-project" data-value="${x.k}">${esc(x.label)}<small>${plural(x.n, 'evaluation')}</small></button>
            <button class="pj-bar" data-act="to-project" data-value="${x.k}" aria-label="${BUCKETS.map(([b, l]) => `${l}: ${x.c[b]}`).join(', ')}">
              ${x.n ? BUCKETS.filter(([b]) => x.c[b]).map(([b, l, tone]) => `<span class="t-${tone}" style="flex:${x.c[b]}" title="${l}: ${x.c[b]}">${x.c[b]}</span>`).join('') : '<span class="empty-bar">No evaluation yet</span>'}
            </button>
            ${x.missing ? `<button class="pj-miss${open === x.k ? ' on' : ''}" data-act="not-eval" data-value="${x.k}">${x.missing} not evaluated yet ${icon('chevDown', 14)}</button>` : '<span></span>'}
          </div>
          ${open === x.k ? notEvaluatedList(x.k) : ''}`).join('')}
      </div>
    </section>`
}

function notEvaluatedList(project) {
  const prods = (state.data.products || []).filter(p => p.project === project && p.bom?.length)
  const items = notEvaluated(prods, state.data.materials).filter(x => !x.note)
  return `
    <div class="ne-wrap"><table class="grid ne">
      <thead><tr><th class="rn"></th><th>Item code</th><th>Material</th><th>Used in</th></tr></thead>
      <tbody>${items.map((x, i) => `<tr><td class="rn">${i + 1}</td><td class="mono">${esc(x.code)}</td><td class="mat">${esc(x.name)}</td>
        <td><span class="chips">${x.products.map(n => `<span class="chip-tag">${esc(n)}</span>`).join('')}</span></td></tr>`).join('')}</tbody>
    </table></div>`
}

export function renderOverview() {
  // Two independent columns, so a long card on one side doesn't leave a hole on the other.
  return `<div class="ov"><div class="ov-col">${moveCard()}${lookCard()}${closedCard()}${turnCard()}</div><div class="ov-col">${waitCard()}${weekCard()}</div>${projectsCard()}</div>`
}
