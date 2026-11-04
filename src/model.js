// Turns raw rows into what the views show: effective fields (file tracker
// block over app value over scan guess), status, timeline and durations.
import { STAGE_KEYS, stampToStages, suggestStamp } from '../lib/parse.js'
import { toEnglish } from '../lib/doc.js'

// One status per evaluation, worked out from its stages and open requests
// (statusOf). The same words as the RM Evaluation Status List.
export const STATUS = {
  fail:         { label: 'Fail', tone: 'red', order: 0, hint: 'A stage failed; close it Not approved' },
  missing:      { label: 'Missing', tone: 'amber', order: 1, hint: 'Nothing requested yet: your move' },
  untagged:     { label: 'Not tagged', tone: 'violet', order: 2, hint: 'Has a verdict line; set the CoA result' },
  awaiting:     { label: 'No file yet', tone: 'violet', order: 2, hint: 'Documents in, no comparison file yet' },
  in_progress:  { label: 'In progress', tone: 'blue', order: 3, hint: 'Request sent; follow it up' },
  not_approved: { label: 'Not approved', tone: 'slate', order: 4, hint: 'Closed: Selection Form not approved' },
  approved:     { label: 'Approved', tone: 'green', order: 5, hint: 'Closed: Selection Form approved' },
  closed:       { label: 'Closed', tone: 'grey', order: 6, hint: 'Closed without a new approval: already on the AVL, or a special case' },
  unreadable:   { label: 'Not readable', tone: 'grey', order: 7, hint: 'Verdict only in a count table (older file)' },
}

// The four stages in order, and what each value reads as. avl is rm_evaluations.avl_listed.
export const STAGES = [
  { key: 'avl', label: 'AVL check', short: 'AVL', values: [[true, 'Confirmed', 'green'], [false, 'Differs', 'slate']] },
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
export function statusOf(s, { hasFile, hasVerdictLine, openData }) {
  if (s.outcome) return s.outcome
  if (s.coa === 'fail' || s.docs === 'fail' || s.qc === 'not_approved') return 'fail'
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

export function buildRows({ materials, evaluations, events }) {
  const today = todayIso()
  const matById = Object.fromEntries(materials.map(m => [m.id, m]))
  const evByEval = {}
  for (const ev of events) if (ev.evaluation_id) (evByEval[ev.evaluation_id] ||= []).push(ev)

  return evaluations.filter(e => matById[e.material_id]).map(e => {
    // Tracker blocks scanned before v0.6 only carry stamp:, so spell it out as stages.
    const t = { ...stampToStages(e.tracker?.stamp), ...(e.tracker || {}) }
    const m = matById[e.material_id]
    const evs = (evByEval[e.id] || []).slice().sort((a, b) => a.event_date.localeCompare(b.event_date))
    // File tracker block over app column; before the v0.6 SQL, the old stamp column.
    const legacy = 'coa' in e ? {} : stampToStages(e.stamp)
    const stages = { avl: t.avl_listed ?? e.avl_listed ?? null }
    for (const k of STAGE_KEYS) stages[k] = k in t ? t[k] : e[k] ?? legacy[k] ?? null
    const open = evs.filter(x => x.kind === 'docs_requested' && !x.closed_on)
    const status = statusOf(stages, { hasFile: !!e.file_name, hasVerdictLine: !!e.verdict_line, openData: open.some(x => x.topic !== 'form') })
    const received = evs.filter(x => x.kind === 'docs_received')
    const firstDocs = received[0]?.event_date ?? null
    const verdictDate = t.verdict_date || evs.find(x => x.kind === 'verdict')?.event_date || e.first_rev_date || null
    const closed = !!stages.outcome
    const messages = evs.filter(x => x.kind === 'message_sent')
    const dates = [e.rev_date, ...evs.map(x => x.event_date)].filter(Boolean).sort()
    return {
      id: e.id, raw: e, material: m,
      materialName: m.name, grade: e.grade,
      candidate: t.candidate || e.candidate_name || e.candidate || null,
      supplier: t.supplier || e.supplier || null,
      manufacturer: t.manufacturer || e.manufacturer || null,
      avl: t.avl_listed ?? e.avl_listed ?? null,
      itemCode: t.item_code || e.item_code || null,
      kind: t.kind || m.kind || null,
      products: productsFor(m, e.grade),
      nextAction: t.next_action || e.next_action || null,
      fromFile: new Set(Object.keys(t)),
      stages, status, nextStep: nextStep(stages),
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
    }
  })
}

// Wait thresholds for the "waiting" chip: under 2 weeks fine, 2–4 weeks amber, beyond red.
export const waitTone = d => d == null ? '' : d > 28 ? 'red' : d > 14 ? 'amber' : 'ok'
