// "Needs a look": each evaluation in the app checked against its comparison
// file's tracker block and its dated Document folders. Read-only: it only
// reports; fixing is done by hand from the evaluation page or the file.
import { fmtDate } from './model.js'
import { toIsoDate } from '../lib/parse.js'

const CLOSED = ['approved', 'not_approved', 'closed']

// In the order the list shows them.
export const RULES = {
  decision_estimated: 'Decision date estimated, signed form on file',
  approved_docs_missing: 'Approved with documents missing',
  not_approved_open: 'Not approved with an open request',
  request_differs: 'Open request differs from the file',
  request_not_open: 'File says a request is out, none open',
  no_tracker: 'Comparison file has no tracker block',
}
const ORDER = Object.keys(RULES)

// A Selection Form scan that carries a decision: "Signed", "Approved",
// "Not Approved" or "Rejected" in its name, never "Unsigned".
export const isSignedForm = name => /selection form/i.test(name) && (/(?<!un)signed\b/i.test(name) || /\b(approved|rejected)\b/i.test(name))
// The form that best records this decision: its own word first (Approved, or
// Not approved / Rejected), then any signed form; the newest of the best.
const NO_WORD = /\bnot approved\b|\brejected\b/i
const YES_WORD = /(?<!not )\bapproved\b/i
export function signedFormFor(list, outcome) {
  const score = f => (outcome === 'approved' ? YES_WORD.test(f.name) && !NO_WORD.test(f.name) : outcome === 'not_approved' ? NO_WORD.test(f.name) : false) ? 2 : 1
  return list.filter(f => isSignedForm(f.name) && f.doc_date)
    .sort((a, b) => score(b) - score(a) || b.doc_date.localeCompare(a.doc_date))[0] ?? null
}

// Two request texts say the same thing when one holds the other, ignoring case and punctuation.
const norm = s => String(s ?? '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
const sameText = (a, b) => { const x = norm(a), y = norm(b); return !!x && !!y && (x === y || x.includes(y) || y.includes(x)) }
const quote = s => { const t = String(s ?? '').trim(); return `"${t.length > 90 ? t.slice(0, 87) + '…' : t}"` }
const STAGE_WORD = { gap: 'Missing', fail: 'Fail' }

export function healthCheck(rows, files = []) {
  const filesBy = {}
  for (const f of files) if (f.evaluation_id) (filesBy[f.evaluation_id] ||= []).push(f)
  const out = []
  for (const r of rows) {
    const t = r.raw?.tracker || {}
    const add = (rule, reason, fix = null) => out.push({ id: r.id, row: r, rule, title: RULES[rule], reason, fix })
    const closed = CLOSED.includes(r.status)
    const openData = r.openRequests.filter(q => q.topic !== 'form')

    // 1. The decision has only an estimated date, but the signed form is in a dated
    // folder with another date. (An estimate that already equals the form's date agrees.)
    const d = r.stageDates?.outcome
    if (r.stages.outcome && d?.est) {
      const form = signedFormFor(filesBy[r.id] || [], r.stages.outcome)
      if (form && form.doc_date !== d.date) add('decision_estimated', `The decision is dated ${fmtDate(d.date)}* (estimated from the timeline), but a signed Selection Form is in the ${fmtDate(form.doc_date)} Document folder. Date the decision from the form.`, { date: form.doc_date })
    }

    // 2. Approved while the documents stage says Missing or Fail.
    if (r.status === 'approved' && STAGE_WORD[r.stages.docs]) {
      add('approved_docs_missing', `Approved, but Docs is ${STAGE_WORD[r.stages.docs]}${r.fromFile.has('docs') ? ' in the tracker block' : ''}. Record the documents, or note why it was approved without them.`)
    }

    // 3. Closed Not approved, yet a request is still open.
    if (r.status === 'not_approved' && r.openRequests.length) {
      const fromTracker = r.openRequests.some(q => q.source === 'tracker')
      add('not_approved_open', `Closed Not approved, but ${r.openRequests.length === 1 ? 'a request is' : `${r.openRequests.length} requests are`} still open: ${r.openRequests.map(q => `${quote(q.what || 'documents')} (asked ${fmtDate(q.event_date)})`).join('; ')}${fromTracker ? '. One comes from request_sent in the tracker block' : ''}. Mark it received, delete it, or take request_sent out of the file.`)
    }

    // 4. The file's pending list (request_asked) and the open request in the app say different things.
    const appOpen = openData.filter(q => q.source !== 'tracker')
    if (!closed && t.request_asked && appOpen.length && !appOpen.some(q => sameText(q.what, t.request_asked))) {
      add('request_differs', `The tracker block asks for ${quote(t.request_asked)}; the open request in the app says ${appOpen.map(q => quote(q.what || 'documents')).join('; ')}. Make them match what was sent.`)
    }

    // 5. The file says a request is out, the app has nothing open.
    if (!closed && t.request_sent && !openData.length) {
      const sent = toIsoDate(t.request_sent)
      const req = r.events.find(x => x.kind === 'docs_requested' && x.event_date === sent)
      add('request_not_open', `The tracker block says a request went to ${t.request_to || 'PU'} on ${fmtDate(sent) || t.request_sent}, but no request is open in the app${req?.closed_on ? ` (documents on ${fmtDate(req.closed_on)} closed it)` : ''}. Update request_sent in the file, or log the new request.`)
    }

    // 6. An open evaluation whose comparison file has no tracker block.
    if (!closed && r.fileName && !Object.keys(t).length) {
      add('no_tracker', `${r.fileName} has no rm-tracker block, so its stages, request and next action live only in the app.`)
    }
  }
  return out.sort((a, b) => ORDER.indexOf(a.rule) - ORDER.indexOf(b.rule) || a.row.materialName.localeCompare(b.row.materialName))
}
