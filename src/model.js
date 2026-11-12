// Turns raw rows into what the views show: effective fields (file tracker
// block over app value over scan guess), status, timeline and durations.
import { STAGE_KEYS, stampToStages, suggestStamp, toIsoDate, expiriesOf } from '../lib/parse.js'
import { toEnglish } from '../lib/doc.js'

// One status per evaluation, worked out from its stages and open requests
// (statusOf). The same words as the RM Evaluation Status List.
export const STATUS = {
  fail:         { label: 'Fail', tone: 'red', order: 0, hint: 'A stage failed; close it Not approved' },
  missing:      { label: 'Missing', tone: 'amber', order: 1, hint: 'Nothing requested yet: your move' },
  untagged:     { label: 'Not tagged', tone: 'violet', order: 2, hint: 'Has a verdict line; set the CoA result' },
  awaiting:     { label: 'No file yet', tone: 'violet', order: 2, hint: 'Documents in, no comparison file yet' },
  in_progress:  { label: 'In progress', tone: 'blue', order: 3, hint: 'Request sent; follow it up' },
  not_approved: { label: 'Not approved', tone: 'red', order: 4, hint: 'Closed: Selection Form not approved' },
  approved:     { label: 'Approved', tone: 'green', order: 5, hint: 'Closed: Selection Form approved' },
  closed:       { label: 'Closed', tone: 'ink', order: 6, hint: 'Closed without a new approval: already on the AVL, or a special case' },
  unreadable:   { label: 'Not readable', tone: 'grey', order: 7, hint: 'Verdict only in a count table (older file)' },
}

// The four stages in order, and what each value reads as. avl is rm_evaluations.avl_listed.
export const STAGES = [
  { key: 'avl', label: 'AVL check', short: 'AVL', values: [[true, 'Listed', 'grey'], [false, 'Not listed', 'green']] },
  { key: 'coa', label: 'CoA', short: 'CoA', values: [['pass', 'Pass', 'green'], ['gap', 'Missing', 'amber'], ['fail', 'Fail', 'red']] },
  { key: 'docs', label: 'Docs', short: 'Docs', values: [['pass', 'Pass', 'green'], ['gap', 'Missing', 'amber'], ['fail', 'Fail', 'red']] },
  { key: 'qc', label: 'QC sample', short: 'QC', values: [['approved', 'Approved', 'green'], ['not_approved', 'Not approved', 'red']] },
]
export const OUTCOMES = [['approved', 'Approved', 'green'], ['not_approved', 'Not approved', 'slate'], ['closed', 'Closed', 'grey']]
// [label, tone] for a stage value; not set yet reads as Pending.
export const stageWord = (key, v) => {
  const hit = STAGES.find(s => s.key === key).values.find(([x]) => x === v)
  return hit ? [hit[1], hit[2]] : ['Pending', 'none']
}

// Approved / Not approved / Closed once there's an outcome. Otherwise a failed
// stage waits for its Not-approved signature, an open data request means the
// ball is with someone else (In progress), and anything else open is Alex's
// move (Missing). A request for paperwork only (topic 'form') doesn't count.
// A failed stage normally waits for its signature. If the tracker says a request went
// out after the fail (request_sent) and it is still open, the ball is with PU instead.
export function statusOf(s, { hasFile, hasVerdictLine, openData, failOpen }) {
  if (s.outcome) return s.outcome
  if (s.coa === 'fail' || s.docs === 'fail' || s.qc === 'not_approved') return failOpen && openData ? 'in_progress' : 'fail'
  if (openData) return 'in_progress'
  if (!s.coa) return !hasFile ? 'awaiting' : hasVerdictLine ? 'untagged' : 'unreadable'
  return 'missing'
}

// What has to happen next, from the stages alone.
export function nextStep(s) {
  if (s.outcome) return null
  if (s.coa === 'fail' || s.docs === 'fail' || s.qc === 'not_approved') return 'Close it Not approved on the Selection Form'
  if (!s.coa) return 'Compare the CoA'
  if (s.coa === 'gap') return 'Get the missing CoA data'
  if (s.docs === 'gap') return 'Get the missing documents'
  if (s.docs !== 'pass') return 'Ask for GMP / MSDS and a QC sample'
  if (!s.qc) return 'QC sample test'
  return 'Close it Approved on the Selection Form'
}
export const EVENT_KINDS = {
  docs_received:  { label: 'Docs received', icon: 'inbox' },
  docs_requested: { label: 'Docs requested', icon: 'send' },
  message_sent:   { label: 'Message sent', icon: 'message' },
  verdict:        { label: 'Verdict', icon: 'check' },
  note:           { label: 'Note', icon: 'note' },
  stage:          { label: 'Stage', icon: 'flag' },
}

export const todayIso = () => new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10) // Bangkok
export const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5)

// "2026-10-08" → "08-10-26" (APm's dd-mm-yy, as on the Selection Form)
export const fmtDate = d => d ? `${d.slice(8, 10)}-${d.slice(5, 7)}-${d.slice(2, 4)}` : ''

// rm_materials.products entries read "Product · item code" or "Product · item code · grade".
// A graded entry only belongs to evaluations of that grade (PVP K30 vs K90).
export const parseProduct = s => { const [name, code = null, grade = null] = String(s).split(' · '); return { name, code, grade } }
export const productsFor = (m, grade) => (m.products || []).map(parseProduct).filter(p => !grade || !p.grade || p.grade === grade)

// Product groups (rm_products.project), in the order the filter shows them.
export const PROJECTS = { ltc: 'Lower the Cost', later: 'Added later', dev: 'In development', other: 'Not on list' }

// BOM lines of the given products that no evaluation covers yet. A line with a
// note is another code of an evaluated material ((N) customer code, other grade).
export function notEvaluated(products, materials) {
  const covered = new Set(materials.flatMap(m => (m.products || []).map(s => parseProduct(s).code)).filter(Boolean))
  const out = new Map()
  for (const p of products) for (const [code, name, note] of p.bom || []) {
    if (covered.has(code)) continue
    const it = out.get(code) || { code, name, note: null, products: [] }
    it.note ||= note || null
    if (!it.products.includes(p.name)) it.products.push(p.name)
    out.set(code, it)
  }
  return [...out.values()].sort((a, b) =>
    Number(!!a.note) - Number(!!b.note) || b.products.length - a.products.length || a.name.localeCompare(b.name))
}
export const productNames = list => [...new Set(list.map(p => p.name))]

// "Acme Co., Ltd. (บจก. แอคมี)" is Acme Co., Ltd.: a Thai name in brackets
// after an English one is the same company, so it groups and filters as one.
export const cleanSupplier = s => {
  if (!s) return null
  const t = String(s).replace(/\s*\([^)]*[\u0E00-\u0E7F][^)]*\)\s*$/, '').trim()
  return /[A-Za-z]/.test(t) ? t : String(s).trim()
}

export function buildRows({ materials, evaluations, events }) {
  const today = todayIso()
  const matById = Object.fromEntries(materials.map(m => [m.id, m]))
  const evByEval = {}
  for (const ev of events) if (ev.evaluation_id) (evByEval[ev.evaluation_id] ||= []).push(ev)

  return evaluations.filter(e => matById[e.material_id]).map(e => {
    // Tracker blocks scanned before v0.6 only carry stamp:, so spell it out as stages.
    const t = { ...stampToStages(e.tracker?.stamp), ...(e.tracker || {}) }
    const m = matById[e.material_id]
    // A request noted in the tracker block (request_sent: yymmdd, optional request_asked:
    // and request_to:) stands in for a timeline entry. It closes when documents arrive
    // after it. Same-day stage entries keep their order: AVL, CoA, Docs, QC sample, Decision.
    const evs0 = (evByEval[e.id] || []).slice()
    const reqDate = t.request_sent ? toIsoDate(t.request_sent) : null
    if (reqDate && !evs0.some(x => x.kind === 'docs_requested' && x.event_date === reqDate)) {
      const reply = evs0.filter(x => x.kind === 'docs_received' && x.event_date > reqDate).map(x => x.event_date).sort()[0] || null
      evs0.push({ id: `trk-${e.id}`, evaluation_id: e.id, kind: 'docs_requested', event_date: reqDate, party: t.request_to || 'PU', what: t.request_asked || null, note: null, topic: 'data', source: 'tracker', closed_on: reply })
    }
    const stageRank = x => x.kind === 'stage' ? 1 + ['avl', ...STAGE_KEYS].indexOf(x.what) : 0
    const evs = evs0.sort((a, b) => a.event_date.localeCompare(b.event_date) || stageRank(a) - stageRank(b))
    // File tracker block over app column; before the v0.6 SQL, the old stamp column.
    const legacy = 'coa' in e ? {} : stampToStages(e.stamp)
    const stages = { avl: t.avl_listed ?? e.avl_listed ?? null }
    for (const k of STAGE_KEYS) stages[k] = k in t ? t[k] : e[k] ?? legacy[k] ?? null
    const open = evs.filter(x => x.kind === 'docs_requested' && !x.closed_on)
    const status = statusOf(stages, { hasFile: !!e.file_name, hasVerdictLine: !!e.verdict_line, openData: open.some(x => x.topic !== 'form'), failOpen: !!reqDate })
    const received = evs.filter(x => x.kind === 'docs_received')
    const firstDocs = received[0]?.event_date ?? null
    const verdictDate = t.verdict_date || evs.find(x => x.kind === 'verdict')?.event_date || e.first_rev_date || null
    const closed = !!stages.outcome
    const messages = evs.filter(x => x.kind === 'message_sent')
    const dates = [e.rev_date, ...evs.map(x => x.event_date)].filter(Boolean).sort()
    const openData = open.filter(x => x.topic !== 'form')
    const sd = stageDates(stages, evs, { verdictDate, verdictExact: !!t.verdict_date, revDate: e.rev_date, firstDocs, last: dates[dates.length - 1] ?? null })
    const auto = autoStages(stages, e, { firstDocs })
    const stations = stationsOf(stages, sd, { hasFile: !!e.file_name, firstDocs, today, auto })
    const since = statusSince(status, sd, stations, { openData, firstDocs, revDate: e.rev_date })
    return {
      id: e.id, raw: e, material: m,
      materialName: m.name, grade: e.grade,
      // The candidate is its manufacturer; PU's distributor is the supplier.
      candidate: t.manufacturer || e.manufacturer || t.candidate || e.candidate_name || e.candidate || null,
      supplier: cleanSupplier(t.supplier || e.supplier),
      manufacturer: t.manufacturer || e.manufacturer || t.candidate || e.candidate_name || e.candidate || null,
      avl: t.avl_listed ?? e.avl_listed ?? null,
      // Set by hand, else from QA's AVL list (null while a close match waits for a yes/no).
      avlListed: stages.avl ?? e.avl_match?.listed ?? null,
      avlMatch: e.avl_match ?? null,
      itemCode: t.item_code || e.item_code || null,
      kind: t.kind || m.kind || null,
      products: productsFor(m, e.grade),
      nextAction: t.next_action || e.next_action || null,
      fromFile: new Set(Object.keys(t)),
      stages, status, nextStep: !stages.outcome && (stages.avl ?? e.avl_match?.listed) === true ? 'Already on the AVL: close the evaluation'
        : status === 'in_progress' && (stages.coa === 'fail' || stages.docs === 'fail' || stages.qc === 'not_approved') ? 'Failed, sent back to PU: follow up the reply, or close it Not approved'
        : nextStep(stages),
      // The verdict line's own word, offered as a one-click CoA result or outcome.
      suggested: stages.coa || stages.outcome ? null : suggestStamp(e.verdict_line),
      verdictLine: e.verdict_line ? toEnglish(e.verdict_line) : null,
      fileName: e.file_name, folder: e.folder, rev: e.rev, revDate: e.rev_date,
      events: evs, firstDocs, verdictDate,
      daysToVerdict: firstDocs && verdictDate && verdictDate >= firstDocs ? daysBetween(firstDocs, verdictDate) : null,
      // How long it's been open since the first documents came in (stops counting once closed)
      ageDays: firstDocs && !closed ? daysBetween(firstDocs, today) : null,
      openRequests: open.map(x => ({ ...x, days: daysBetween(x.event_date, today) })),
      waitingDays: open.length ? Math.max(...open.map(x => daysBetween(x.event_date, today))) : null,
      lastMessage: messages[messages.length - 1] ?? null,
      lastActivity: dates[dates.length - 1] ?? null,
      stageDates: sd, stations, since,
      holder: holderOf(stages, openData, since, sd),
      decisionDays: firstDocs && sd.outcome?.date >= firstDocs ? daysBetween(firstDocs, sd.outcome.date) : null,
      sample: sampleOf(evs, stages, sd, today),
      // Valid-until dates from the tracker block, days left (negative = expired).
      expiries: expiriesOf(t).map(x => ({ ...x, days: x.date ? daysBetween(today, x.date) : null })),
    }
  })
}

// Valid-until dates within `within` days, or already past, on evaluations still
// in use (not Not approved, not Closed). Soonest first.
export const expiring = (rows, within = 60) => rows.filter(r => !['not_approved', 'closed'].includes(r.status))
  .flatMap(r => r.expiries.filter(x => x.days != null && x.days <= within).map(x => ({ r, ...x })))
  .sort((a, b) => a.days - b.days)

// ── QC sample: requested from PU → received by RD → sent to QC → QC result ──
// A sample is its own request (topic 'sample'). The one to PU closes when the
// sample arrives; the one to QC (party QC) is the analysis request, closed by
// the result. The result is the QC stage and its date.
export const SAMPLE_STEPS = [['requested', 'Requested'], ['received', 'Received'], ['sent', 'Sent to QC'], ['result', 'QC result']]
export const isQcParty = p => /^qc\b/i.test(String(p || '').trim())
export function sampleOf(evs, stages, sd, today = todayIso()) {
  const reqs = evs.filter(x => x.kind === 'docs_requested' && x.topic === 'sample')
  if (!reqs.length && !stages.qc) return null
  const toQc = reqs.filter(x => isQcParty(x.party))
  const ask = reqs.filter(x => !isQcParty(x.party)).pop() ?? null
  const sent = toQc.pop() ?? null
  const result = stages.qc ? { value: stages.qc, date: sd.qc?.date ?? sent?.closed_on ?? null, est: sd.qc?.date ? !!sd.qc.est : false } : null
  const at = {
    requested: ask ? { date: ask.event_date, id: ask.id, what: ask.what, party: ask.party || 'PU' } : null,
    received: ask?.closed_on ? { date: ask.closed_on } : null,
    sent: sent ? { date: sent.event_date, id: sent.id, what: sent.what } : null,
    result: result ? { date: result.date, value: result.value, est: result.est } : null,
  }
  let prev = null
  const steps = SAMPLE_STEPS.map(([key, label]) => {
    const s = at[key]
    const st = { key, label, date: s?.date ?? null, done: !!s, days: null, ...(s || {}) }
    if (st.date && prev) st.days = daysBetween(prev, st.date)
    if (st.date) prev = st.date
    return st
  })
  // Where it is now: the first step not done (after a result, nowhere).
  const now = result ? null : steps.find(s => !s.done)?.key ?? null
  const holder = now === 'received' ? (at.requested?.party || 'PU') : now === 'sent' ? 'RD' : now === 'result' ? 'QC' : now === 'requested' ? 'RD' : null
  return { steps, now, holder, waitingDays: now && prev ? daysBetween(prev, today) : null, result: result?.value ?? null, askId: ask?.id ?? null, sentId: sent?.id ?? null, open: !!now }
}

// ── Stage dates ──────────────────────────────────────────────────────────
// From v0.7 every stage change is a 'stage' timeline entry (what = stage key,
// note = the new value). Values set before that, or never logged, get a date
// estimated from the other entries, marked est.
export function stageDates(stages, evs, b) {
  const logged = k => {
    const hit = evs.filter(x => x.kind === 'stage' && x.what === k && x.note === String(stages[k])).pop()
    return hit ? { date: hit.event_date, est: !!hit.estimated } : null
  }
  const latest = (list, from) => list.filter(d => d && (!from || d >= from)).sort().pop()
  const out = {}
  for (const k of ['avl', ...STAGE_KEYS]) out[k] = stages[k] == null ? null : logged(k)
  const coaDate = b.verdictDate || b.revDate
  if (stages.coa != null && !out.coa && coaDate) out.coa = { date: coaDate, est: !b.verdictExact }
  if (stages.avl != null && !out.avl && (out.coa || b.firstDocs)) out.avl = { date: out.coa?.date || b.firstDocs, est: true }
  const closedReqs = evs.filter(x => x.kind === 'docs_requested' && x.closed_on && x.topic !== 'form').map(x => x.closed_on)
  const received = evs.filter(x => x.kind === 'docs_received').map(x => x.event_date)
  if (stages.docs != null && !out.docs) {
    const d = latest(closedReqs, out.coa?.date) || latest(received, out.coa?.date) || b.revDate || out.coa?.date
    if (d) out.docs = { date: d, est: true }
  }
  if (stages.qc != null && !out.qc) {
    const d = latest(received, out.docs?.date) || out.docs?.date || b.last
    if (d) out.qc = { date: d, est: true }
  }
  if (stages.outcome != null && !out.outcome && b.last) out.outcome = { date: b.last, est: true }
  return out
}

// ── The line: AVL → CoA → Docs → QC sample → Decision ─────────────────────
// Station state: done (solid track behind it), now (the train is here),
// ahead (dashed), skipped (passed without a value: AVL never checked, or the
// evaluation closed early).
export const STATIONS = [['avl', 'AVL'], ['coa', 'CoA'], ['docs', 'Docs'], ['qc', 'QC sample'], ['decision', 'Decision']]
const RESULT_WORD = {
  avl: { true: ['Listed', 'grey'], false: ['Not listed', 'green'] },
  coa: { pass: ['Pass', 'green'], gap: ['Missing', 'amber'], fail: ['Fail', 'red'] },
  docs: { pass: ['Pass', 'green'], gap: ['Missing', 'amber'], fail: ['Fail', 'red'] },
  qc: { approved: ['Approved', 'green'], not_approved: ['Not approved', 'red'] },
  decision: { approved: ['Approved', 'green'], not_approved: ['Not approved', 'red'], closed: ['Closed', 'ink'] },
}
const DONE = { coa: v => v === 'pass', docs: v => v === 'pass', qc: v => v === 'approved', decision: v => v != null }

// Values the line can show without a recorded stage, each with where it came
// from: AVL from QA's list (FR-QA-PC-055), and for a closed evaluation the CoA
// from the comparison file's verdict, or Fail for a Not approved with nothing
// else to go on (most stop at the CoA).
export function autoStages(stages, e, { firstDocs } = {}) {
  const auto = {}
  const m = e.avl_match
  const asOf = m?.file_date ? `, list as of ${fmtDate(m.file_date)}` : ''
  // Three states. Listed (grey): this material from this manufacturer is already
  // on the AVL, used and passed before, so the evaluation can close. Not listed
  // (green): a new source, carry on. Not checked: grey ring.
  if (stages.avl == null && m) {
    if (m.listed === true) {
      auto.avl = { result: 'Listed', tone: 'grey', sub: 'AVL list',
        basis: `On QA's AVL (FR-QA-PC-055) as ${m.manufacturer}, ${m.material}${m.date ? `, ${fmtDate(m.date)}` : ''}${asOf}` }
    } else if (m.listed === false) {
      auto.avl = { result: 'Not listed', tone: 'green', sub: 'AVL list',
        basis: m.cancelled ? `On QA's AVL as ${m.manufacturer} but cancelled (${fmtDate(m.date)}), so not listed${asOf}` : `This material from this manufacturer is not on QA's AVL${asOf}` }
    } else if (m.review?.length) {
      auto.avl = { result: 'Not checked', tone: 'ink', sub: 'confirm in Settings', review: true,
        basis: `Close match on QA's AVL: ${m.review.map(r => `${r.manufacturer}, ${r.material}${r.active ? '' : ' (cancelled)'}`).join('; ')}. Confirm in Settings.` }
    }
  }
  if (stages.coa == null && stages.outcome != null) {
    // The verdict's CoA word, not the decision it may also mention ("FAIL … Not approved 20-07-26").
    const g = suggestStamp(String(e.verdict_line ?? '').replace(/closed\s*[—-]+\s*(not\s+)?approved|ไม่อนุมัติ|\bnot approved\b/gi, ' '))
    if (['pass', 'gap', 'fail'].includes(g)) auto.coa = { value: g, basis: `From the comparison file's verdict${e.rev != null ? ` (R.${e.rev})` : ''}` }
    else if (stages.outcome === 'not_approved') auto.coa = { value: 'fail', basis: 'Not approved with no CoA result recorded; most stop at the CoA' }
  }
  return auto
}

export function stationsOf(stages, sd, { hasFile, firstDocs, today = todayIso(), auto = {} }) {
  const val = k => k === 'decision' ? stages.outcome : stages[k]
  const dateOf = k => k === 'decision' ? sd.outcome : sd[k]
  const closed = stages.outcome != null
  // The train stops at the first of CoA / Docs / QC / Decision that isn't done.
  const nowIdx = closed ? 4 : Math.max(1, STATIONS.findIndex(([k]) => k !== 'avl' && !DONE[k](val(k))))
  let arrived = firstDocs
  return STATIONS.map(([k, label], i) => {
    const v = val(k)
    let [result, tone] = v != null ? RESULT_WORD[k][String(v)] ?? ['', 'ink']
      : k === 'coa' && i === nowIdx && !hasFile ? ['No file yet', 'ink'] : ['', 'ink']
    let d = dateOf(k)
    // Not recorded, but known from elsewhere: shown so, marked inferred, with its source.
    // An approval means CoA, Docs and QC passed, unless the verdict says otherwise.
    const a = v == null ? auto[k] : null
    let inferred = false, basis = null, sub = null, review = false
    if (a?.value) { [result, tone] = RESULT_WORD[k][a.value]; ({ basis } = a); inferred = true }
    else if (a) { ({ result, tone, basis, sub } = a); review = !!a.review; inferred = !review }
    else if (v == null && stages.outcome === 'approved' && ['coa', 'docs', 'qc'].includes(k)) {
      [result, tone] = [k === 'qc' ? 'Approved' : 'Pass', 'green']; inferred = true; basis = 'Approved, so this passed (not recorded)'
    }
    if (inferred) d = null
    const state = i === nowIdx ? 'now' : i > nowIdx ? 'ahead' : v != null || inferred ? 'done' : 'skipped'
    const st = { key: k, label, state, result, tone, filled: closed && i === nowIdx, date: d?.date ?? null, est: !!d?.est, inferred, basis, sub, review, from: arrived }
    if (state === 'done' && d?.date && !inferred) {
      st.days = arrived && d.date >= arrived ? daysBetween(arrived, d.date) : null
      arrived = d.date
    }
    if (state === 'now') {
      // Closed: the decision date. Open: counting since the train got here.
      st.since = closed ? d?.date ?? null : [arrived, d?.date].filter(Boolean).sort().pop() ?? null
      st.days = !closed && st.since ? daysBetween(st.since, today) : null
    }
    return st
  })
}

// When the current status began: the oldest open request for In progress, the
// outcome once closed, otherwise when the train reached its station.
export function statusSince(status, sd, stations, { openData, firstDocs, revDate }) {
  if (status === 'in_progress') {
    const d = openData.map(x => x.event_date).sort()[0]
    return d ? { date: d, est: false } : null
  }
  if (['approved', 'not_approved', 'closed'].includes(status)) return sd.outcome
  if (status === 'awaiting') return firstDocs ? { date: firstDocs, est: false } : null
  if (status === 'untagged' || status === 'unreadable') return revDate ? { date: revDate, est: false } : null
  const now = stations.find(s => s.state === 'now')
  if (!now?.since) return null
  const from = stations.find(s => s.date === now.since)
  return { date: now.since, est: from ? from.est : false }
}

// "In progress 12 d · since 24-10-26", for a status pill's hover.
export function sinceText(r) {
  const label = STATUS[r.status].label
  if (!r.since?.date) return label
  return `${label} ${daysBetween(r.since.date, todayIso())} d · since ${fmtDate(r.since.date)}${r.since.est ? ' (estimated)' : ''}`
}

// Who has the evaluation now: whoever an open data request went to, else RD.
function holderOf(stages, openData, since, sd) {
  if (stages.outcome) return { who: 'Closed', closed: true, since: sd.outcome?.date ?? null }
  if (openData.length) {
    const first = openData.slice().sort((a, b) => a.event_date.localeCompare(b.event_date))[0]
    return { who: first.party || 'PU', since: first.event_date, what: openData.map(x => x.what).filter(Boolean) }
  }
  return { who: 'RD', you: true, since: since?.date ?? null }
}

// Wait thresholds for the "waiting" chip: under 2 weeks fine, 2–4 weeks amber, beyond red.
export const waitTone = d => d == null ? '' : d > 28 ? 'red' : d > 14 ? 'amber' : 'ok'
