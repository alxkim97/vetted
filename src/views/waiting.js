// What's stuck: open document requests, CoAs with no comparison yet, and
// ขาด stamps where no request has been logged.
import { state } from '../store.js'
import { fmtDate, waitTone, daysBetween, todayIso } from '../model.js'
import { esc, icon } from '../ui.js'

const label = r => [r.materialName, r.grade, r.candidate].filter(Boolean).map(esc).join(' <span class="sep">/</span> ')

export function waitingCount() {
  return state.rows.reduce((n, r) => n + r.openRequests.length + (r.status === 'awaiting' ? 1 : 0), 0)
}

export function renderWaiting() {
  const today = todayIso()
  const requests = state.rows.flatMap(r => r.openRequests.map(q => ({ r, q }))).sort((a, b) => b.q.days - a.q.days)
  const awaiting = state.rows.filter(r => r.status === 'awaiting')
  const gapNoAsk = state.rows.filter(r => r.status === 'gap' && !r.openRequests.length)
  const card = (title, ico, sub, body) => `
    <section class="card">
      <div class="card-head"><h2>${icon(ico, 18)} ${title}</h2><span class="muted small">${sub}</span></div>
      ${body}
    </section>`
  const item = (r, right, meta, act = '') => `
    <div class="w-item" data-act="open" data-id="${r.id}" tabindex="0">
      <div class="w-main"><div class="w-title">${label(r)}</div><div class="w-meta">${meta}</div></div>
      ${right}${act}
    </div>`
  return `
    <div class="waiting">
      ${card('Open document requests', 'send', `${requests.length} open`, requests.length
        ? requests.map(({ r, q }) => item(r,
            `<span class="wait big w-${waitTone(q.days)}">${q.days} d</span>`,
            `${esc(q.what || 'Documents')}${q.party ? ` · asked ${esc(q.party)}` : ''} · ${fmtDate(q.event_date)}`,
            `<button class="btn soft small" data-act="received" data-id="${q.id}">Mark received</button>`)).join('')
        : `<p class="empty">No open requests. Log one from a row's timeline, or from a chat with <code>rm-log requested</code>.</p>`)}
      ${card('Documents in, no comparison file yet', 'inbox', `${awaiting.length}`, awaiting.length
        ? awaiting.map(r => item(r, `<span class="wait big w-${waitTone(r.firstDocs ? daysBetween(r.firstDocs, today) : null)}">${r.firstDocs ? daysBetween(r.firstDocs, today) + ' d' : '—'}</span>`,
            `Documents since ${fmtDate(r.firstDocs)} · <span class="mono">${esc(r.folder)}</span>`)).join('')
        : '<p class="empty">Every candidate folder with documents has a comparison file.</p>')}
      ${card('ขาด with no request logged', 'alert', `${gapNoAsk.length}`, gapNoAsk.length
        ? gapNoAsk.map(r => item(r, r.ageDays != null ? `<span class="wait big w-${waitTone(r.ageDays)}">${r.ageDays} d</span>` : '',
            esc(r.nextAction || r.verdictLine || 'Missing data, but nothing has been asked for yet'))).join('')
        : '<p class="empty">Every ขาด has a request on file.</p>')}
    </div>`
}
